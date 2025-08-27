import { Request, Response } from "express";
import { ClaudeRunner, ClaudeOptions } from "../../claude-runner.js";
import { GitService } from "../services/git.service.js";
import { SecretsService } from "../services/secrets.service.js";
import { WorkspaceService } from "../services/workspace.service.js";
import { RunRequest } from "../types/request.types.js";

export class ClaudeController {
  private gitService: GitService;
  private secretsService: SecretsService;
  private workspaceService: WorkspaceService;

  constructor() {
    this.gitService = new GitService();
    this.secretsService = new SecretsService();
    this.workspaceService = new WorkspaceService();
  }

  async runClaude(req: Request<{}, {}, RunRequest>, res: Response): Promise<void> {
    console.log("POST /run - Request received");
    const {
      prompt,
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
      timeoutMinutes
    } = req.body || {};

    console.log("Request body:", {
      prompt: prompt?.substring(0, 50) + "...",
      maxTurns,
      allowedTools,
      hasSystemPrompt: !!systemPrompt,
      useNamedPipe,
      gitRepo,
      gitBranch
    });

    if (!prompt) {
      console.error("Missing prompt in request");
      res.status(400).json({ error: "prompt is required" });
      return;
    }

    let workspaceRoot: string;
    
    try {
      // Create workspace or clone repository
      if (gitRepo) {
        workspaceRoot = await this.workspaceService.createWorkspace();
        await this.gitService.cloneRepository({
          gitRepo,
          targetPath: workspaceRoot,
          branch: gitBranch,
          depth: gitDepth
        });
      } else {
        workspaceRoot = await this.workspaceService.createWorkspace();
      }

      await this.workspaceService.createSubdirectory(workspaceRoot, cwdRelative);

      // Load environment secrets dynamically if gitRepo is provided
      let additionalEnv: Record<string, string> = {};
      if (gitRepo) {
        const envContent = await this.secretsService.fetchEnvSecret(gitRepo, gitBranch);
        
        if (envContent) {
          // Write to workspace as .env file
          await this.workspaceService.writeEnvFile(workspaceRoot, envContent);
          
          // Parse environment variables
          additionalEnv = this.secretsService.parseEnvContent(envContent);
          console.log(`✓ Loaded ${Object.keys(additionalEnv).length} environment variables`);
        }
      }

      // Build options for Claude runner
      const options: ClaudeOptions = {
        allowedTools,
        disallowedTools,
        maxTurns,
        systemPrompt,
        appendSystemPrompt,
        permissionMode,
        timeoutMinutes: timeoutMinutes || 10,
        model,
        fallbackModel,
        claudeEnv: {
          // Pass any additional environment variables
          CLAUDE_CODE_OAUTH_TOKEN: process.env.CLAUDE_CODE_OAUTH_TOKEN || "",
          ...additionalEnv
        }
      };

      console.log("Setting up SSE headers");
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      console.log("Auth check:", {
        hasApiKey: !!process.env.ANTHROPIC_API_KEY,
        hasAuthToken: !!process.env.CLAUDE_CODE_OAUTH_TOKEN,
        tokenLength: process.env.CLAUDE_CODE_OAUTH_TOKEN?.length || 0
      });

      const runner = new ClaudeRunner(workspaceRoot);
      let connectionClosed = false;

      // Handle client disconnect
      req.on("close", () => {
        console.log("Client disconnected, killing Claude process");
        connectionClosed = true;
        runner.kill();
      });

      console.log(`Starting Claude CLI (${useNamedPipe ? 'with named pipe' : 'direct stdin'})`);

      // Data handler for streaming
      const onData = (line: string) => {
        if (connectionClosed) return;

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

      console.log(`Claude process completed with exit code: ${result.exitCode}`);

      if (result.exitCode !== 0) {
        res.write(`event: error\ndata: ${JSON.stringify({
          error: `Claude process exited with code ${result.exitCode}`,
          stderr: result.error
        })}\n\n`);
      }

      res.end();

    } catch (err: any) {
      console.error("Error:", err.message, err.stack);
      
      // If headers not sent yet, send error response
      if (!res.headersSent) {
        res.status(500).json({ error: err.message });
      } else {
        res.write(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`);
        res.end();
      }
      
      // Clean up workspace if it was created
      if (workspaceRoot!) {
        await this.workspaceService.cleanupWorkspaceNow(workspaceRoot);
      }
    } finally {
      // Clean up workspace after a delay for successful runs
      if (workspaceRoot!) {
        this.workspaceService.cleanupWorkspace(workspaceRoot, 5000);
      }
    }
  }
}