import { Request, Response } from "express";
import path from "path";
import { ClaudeRunner, ClaudeOptions } from "../../claude-runner.js";
import { GitService } from "../services/git.service.js";
import { WorkspaceService } from "../services/workspace.service.js";
import { SimpleAnthropicProxy } from "../services/simple-proxy.js";
import { RunRequest } from "../types/request.types.js";
import { logger } from "../../utils/logger.js";

export class ClaudeController {
  private gitService: GitService;
  private workspaceService: WorkspaceService;

  constructor() {
    this.gitService = new GitService();
    this.workspaceService = new WorkspaceService();
  }

  async runClaude(req: Request<{}, {}, RunRequest>, res: Response): Promise<void> {
    logger.debug("POST /run - Request received");
    const {
      prompt,
      anthropicApiKey,
      anthropicOAuthToken,
      systemPrompt,
      appendSystemPrompt,
      allowedTools,
      disallowedTools,
      permissionMode,
      maxTurns = 6,
      model,
      fallbackModel,
      cwdRelative = ".",
      useNamedPipe = true,
      gitRepo,
      gitBranch = "main",
      gitDepth = 1,
      timeoutMinutes,
      environmentSecrets = {},
      sshKey,
      metadata
    } = req.body || {};

    logger.debug("Request body:", {
      prompt: prompt?.substring(0, 50) + "...",
      maxTurns,
      allowedTools,
      hasSystemPrompt: !!systemPrompt,
      useNamedPipe,
      gitRepo,
      gitBranch,
      hasEnvironmentSecrets: Object.keys(environmentSecrets).length > 0,
      hasSshKey: !!sshKey,
      hasMetadata: !!metadata,
      hasAnthropicApiKey: !!anthropicApiKey,
      hasAnthropicOAuthToken: !!anthropicOAuthToken
    });

    if (!prompt) {
      logger.error("Missing prompt in request");
      res.status(400).json({ error: "prompt is required" });
      return;
    }

    if (!anthropicApiKey && !anthropicOAuthToken) {
      logger.error("Missing authentication - need either anthropicApiKey or anthropicOAuthToken");
      res.status(400).json({
        error: "Either anthropicApiKey or anthropicOAuthToken is required"
      });
      return;
    }

    let workspaceRoot: string | undefined;
    let proxy: SimpleAnthropicProxy | undefined;
    let cleanedUp = false;

    try {
      // Start token proxy - SECURITY: Prevents Claude from accessing real credentials
      proxy = new SimpleAnthropicProxy(anthropicApiKey, anthropicOAuthToken);
      await proxy.start();
      const proxyPort = proxy.getPort();
      logger.debug(`✓ Token proxy started on 127.0.0.1:${proxyPort}`);

      // Small delay to ensure proxy is fully ready to accept connections
      await new Promise(resolve => setTimeout(resolve, 100));

      // Create workspace
      workspaceRoot = await this.workspaceService.createWorkspace();

      // Track SSH key path for Claude's git commands
      let sshKeyPath: string | undefined;

      // Write SSH key if provided (for both git clone and Claude's git commands)
      if (sshKey) {
        logger.debug(`✓ SSH key provided in payload (${sshKey.length} bytes)`);

        try {
          sshKeyPath = await this.workspaceService.writeSshKeyFile(workspaceRoot, sshKey);
          logger.debug(`✓ SSH key written to: ${sshKeyPath}`);
        } catch (error: any) {
          logger.error(`Failed to write SSH key: ${error.message}`);
          throw error;
        }
      }

      // Clone repository if provided
      if (gitRepo) {
        let repoUrlToUse = gitRepo;

        if (sshKey) {
          // Convert HTTPS URLs to SSH format if we have an SSH key
          if (gitRepo.startsWith('http://') || gitRepo.startsWith('https://')) {
            repoUrlToUse = this.gitService.convertHttpsToSsh(gitRepo);
            logger.debug(`✓ Converted HTTPS URL to SSH format: ${gitRepo} -> ${repoUrlToUse}`);
          }
        } else {
          logger.debug(`No SSH key provided in payload`);

          // For SSH URLs without a key, this will fail
          if (gitRepo.startsWith('git@')) {
            logger.debug(`SSH URL requires authentication but no SSH key available`);
          } else {
            logger.debug(`Attempting public HTTPS clone`);
          }
        }

        // Clone into 'repo' subdirectory to avoid conflict with existing workspace directory
        const repoPath = path.join(workspaceRoot, 'repo');

        await this.gitService.cloneRepository({
          gitRepo: repoUrlToUse,
          targetPath: repoPath,
          branch: gitBranch,
          depth: gitDepth,
          sshKeyPath
        });

        // Update workspaceRoot to point to cloned repository for Claude execution
        workspaceRoot = repoPath;
      }

      await this.workspaceService.createSubdirectory(workspaceRoot, cwdRelative);

      // Use environment secrets from payload (provided by Agent Forge)
      if (Object.keys(environmentSecrets).length > 0) {
        logger.debug(`✓ Using ${Object.keys(environmentSecrets).length} environment secrets from payload`);

        // Optionally write to .env file for applications that expect it
        const envContent = Object.entries(environmentSecrets)
          .map(([key, value]) => `${key}=${value}`)
          .join('\n');
        await this.workspaceService.writeEnvFile(workspaceRoot, envContent);
      }

      // Detect credential type and set appropriate dummy env var
      // This ensures Claude sends the right header type that the proxy expects
      const claudeEnv: Record<string, string> = {
        // Proxy configuration - use ANTHROPIC_BASE_URL to only intercept Anthropic API traffic
        // This prevents proxying git, npm, and other non-Anthropic traffic
        ANTHROPIC_BASE_URL: `http://127.0.0.1:${proxyPort}`,
        // User-provided environment secrets (intentionally accessible)
        ...environmentSecrets
      };

      // SECURITY: Pass dummy credential that matches the type we have
      // Proxy will replace it with the real credential
      if (anthropicApiKey) {
        // API key: Claude will send x-api-key header
        claudeEnv.ANTHROPIC_API_KEY = 'dummy-api-key-proxy-will-replace';
      } else if (anthropicOAuthToken) {
        // OAuth token: Claude will send authorization Bearer header
        claudeEnv.CLAUDE_CODE_OAUTH_TOKEN = 'dummy-oauth-token-proxy-will-replace';
      }

      // Configure Git to use per-request SSH key for Claude's git commands
      if (sshKeyPath) {
        claudeEnv.GIT_SSH_COMMAND = `ssh -i ${sshKeyPath} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null`;
        logger.debug(`✓ GIT_SSH_COMMAND configured for Claude: ${sshKeyPath}`);
      }

      // Build options for Claude runner
      const options: ClaudeOptions = {
        allowedTools,
        disallowedTools,
        maxTurns,
        systemPrompt,
        appendSystemPrompt,
        permissionMode,
        timeoutMinutes: timeoutMinutes || 55,
        model,
        fallbackModel,
        dangerouslySkipPermissions: process.env.DANGEROUSLY_SKIP_PERMISSIONS === 'true',
        debug: process.env.CLAUDE_DEBUG === 'true',
        claudeEnv
      };

      logger.debug("Setting up SSE headers");
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      const runner = new ClaudeRunner(workspaceRoot);
      let connectionClosed = false;

      // Handle client disconnect
      req.on("close", () => {
        logger.debug("Client disconnected, killing Claude process");
        connectionClosed = true;
        runner.kill();
      });

      logger.debug(`Starting Claude CLI (${useNamedPipe ? 'with named pipe' : 'direct stdin'})`);

      // Data handler for streaming
      const onData = (line: string) => {
        if (connectionClosed) return;

        // Log Claude output at info level (visible without debug mode)
        if (line.trim()) {
          logger.info('[CLAUDE OUTPUT]', line);
        }

        try {
          // Try to parse as JSON
          const message = JSON.parse(line);
          res.write(`data: ${JSON.stringify(message)}\n\n`);
          (res as any).flush?.();
        } catch (e) {
          // If not JSON, send as text
          if (line.trim()) {
            res.write(`data: ${JSON.stringify({ type: "text", content: line })}\n\n`);
            (res as any).flush?.();
          }
        }
      };

      // Error handler
      const onError = (error: string) => {
        if (connectionClosed) return;

        res.write(`event: error\ndata: ${JSON.stringify({ error })}\n\n`);
        (res as any).flush?.();
      };

      // Run Claude with appropriate method
      const result = useNamedPipe
        ? await runner.runWithPipe(prompt, options, onData, onError)
        : await runner.runDirect(prompt, options, onData, onError);

      logger.debug(`Claude process completed with exit code: ${result.exitCode}`);

      if (result.exitCode !== 0) {
        res.write(`event: error\ndata: ${JSON.stringify({
          error: `Claude process exited with code ${result.exitCode}`,
          stderr: result.error
        })}\n\n`);
      }

      res.end();

    } catch (err: any) {
      logger.error("Error:", err.message, err.stack);

      // If headers not sent yet, send error response
      if (!res.headersSent) {
        res.status(500).json({ error: err.message });
      } else {
        res.write(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`);
        res.end();
      }

      // Clean up workspace immediately on error
      if (workspaceRoot) {
        await this.workspaceService.cleanupWorkspaceNow(workspaceRoot);
        cleanedUp = true;
      }
    } finally {
      // Stop proxy
      if (proxy) {
        await proxy.stop();
      }

      // Only schedule delayed cleanup if not already cleaned up
      if (workspaceRoot && !cleanedUp) {
        this.workspaceService.cleanupWorkspace(workspaceRoot, 5000);
      }
    }
  }
}