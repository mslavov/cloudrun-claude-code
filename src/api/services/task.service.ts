import path from "path";
import crypto from "crypto";
import { ClaudeRunner, ClaudeOptions } from "../../claude-runner.js";
import { GitService } from "./git.service.js";
import { WorkspaceService } from "./workspace.service.js";
import { SimpleAnthropicProxy } from "./simple-proxy.js";
import { OutputHandler } from "./output-handlers.js";
import { RunRequest } from "../types/request.types.js";
import { TaskRegistry } from "./task-registry.service.js";
import { logger } from "../../utils/logger.js";

/**
 * TaskService
 * Unified service for executing Claude Code tasks (both sync and async)
 * Uses OutputHandler strategy pattern to handle different output modes
 */
export class TaskService {
  private gitService: GitService;
  private workspaceService: WorkspaceService;
  private registry: TaskRegistry;

  constructor() {
    this.gitService = new GitService();
    this.workspaceService = new WorkspaceService();
    this.registry = TaskRegistry.getInstance();
  }

  /**
   * Execute a Claude Code task with the given output handler
   * This method orchestrates the full execution flow and works for both sync and async modes
   */
  async executeTask(
    request: RunRequest,
    outputHandler: OutputHandler,
    taskId?: string
  ): Promise<void> {
    const startTime = Date.now();

    // Generate task ID for sync requests (async requests already have one)
    const effectiveTaskId = taskId || `sync-${crypto.randomUUID()}`;
    const taskType = taskId ? 'async' : 'sync';
    const logPrefix = `[TASK ${effectiveTaskId}]`;

    logger.info(`${logPrefix} Starting task execution (type: ${taskType})`);

    let workspaceRoot: string | undefined;
    let proxy: SimpleAnthropicProxy | undefined;
    let runner: ClaudeRunner | undefined;
    let cleanedUp = false;
    let registered = false;

    try {
      // Setup proxy
      const { proxy: proxyInstance, proxyPort } = await this.setupProxy(
        request.anthropicApiKey,
        request.anthropicOAuthToken,
        logPrefix
      );
      proxy = proxyInstance;

      // Setup workspace (create, SSH keys, git clone)
      const { workspaceRoot: workspace, sshKeyPath } = await this.setupWorkspace(
        request.gitRepo,
        request.sshKey,
        request.gitBranch,
        request.gitDepth,
        logPrefix
      );
      workspaceRoot = workspace;

      // Create subdirectory if needed
      await this.workspaceService.createSubdirectory(workspaceRoot, request.cwdRelative || '.');

      // Setup environment (secrets, proxy config, SSH)
      const claudeEnv = await this.setupEnvironment(
        workspaceRoot,
        request.environmentSecrets || {},
        proxyPort,
        request.anthropicApiKey,
        request.anthropicOAuthToken,
        sshKeyPath,
        logPrefix
      );

      // Build Claude options
      const options = this.buildClaudeOptions(request, claudeEnv);

      // Create Claude runner
      runner = new ClaudeRunner(workspaceRoot);

      // Register task in registry BEFORE starting execution
      try {
        this.registry.register(effectiveTaskId, runner, taskType);
        registered = true;
        logger.debug(`${logPrefix} Task registered in registry`);
      } catch (error: any) {
        logger.error(`${logPrefix} Failed to register task:`, error.message);
        throw new Error(`Cannot start task: ${error.message}`);
      }

      // Create data and error handlers
      const onData = (line: string) => {
        // Check for cancellation before processing output
        if (this.registry.isCancelling(effectiveTaskId)) {
          logger.debug(`${logPrefix} Skipping output (task is cancelling)`);
          return;
        }
        outputHandler.onData(line);
      };

      const onError = (error: string) => {
        outputHandler.onError(error);
      };

      logger.info(`${logPrefix} Starting Claude CLI`);

      // Run Claude (this will block until completion or cancellation)
      const result = request.useNamedPipe !== false
        ? await runner.runWithPipe(request.prompt, options, onData, onError)
        : await runner.runDirect(request.prompt, options, onData, onError);

      // Calculate duration
      const durationMs = Date.now() - startTime;

      // Check if task was cancelled
      if (this.registry.isCancelling(effectiveTaskId)) {
        logger.info(`${logPrefix} Task was cancelled during execution`);
        await outputHandler.onCancel(durationMs);
      } else {
        // Normal completion
        await outputHandler.onComplete(result, durationMs);
        logger.info(`${logPrefix} Task completed successfully in ${durationMs}ms`);
      }

    } catch (error: any) {
      logger.error(`${logPrefix} Task failed:`, error.message, error.stack);

      // Check if this was a cancellation
      const wasCancelled = registered && this.registry.isCancelling(effectiveTaskId);

      if (wasCancelled) {
        logger.info(`${logPrefix} Task failed due to cancellation`);
        // Cancellation was already handled above, just log
      } else {
        // Normal error handling
        outputHandler.onError(error.message);

        // Try to complete with error status
        try {
          await outputHandler.onComplete(
            { exitCode: 1, output: '', error: error.message },
            Date.now() - startTime
          );
        } catch (completeError: any) {
          logger.error(`${logPrefix} Failed to notify completion:`, completeError.message);
        }
      }

      // Clean up workspace immediately on error
      if (workspaceRoot) {
        await this.workspaceService.cleanupWorkspaceNow(workspaceRoot);
        cleanedUp = true;
      }

      // Re-throw to let controller handle
      throw error;

    } finally {
      // Unregister task from registry
      if (registered) {
        this.registry.unregister(effectiveTaskId);
        logger.debug(`${logPrefix} Task unregistered from registry`);
      }
      // Cleanup output handler
      try {
        await outputHandler.cleanup();
      } catch (cleanupError: any) {
        logger.error(`${logPrefix} Failed to cleanup output handler:`, cleanupError.message);
      }

      // Stop proxy
      if (proxy) {
        await proxy.stop();
        logger.debug(`${logPrefix} Proxy stopped`);
      }

      // Clean up workspace (delayed for sync, immediate for async)
      if (workspaceRoot && !cleanedUp) {
        if (taskType === 'async') {
          // Async task: immediate cleanup
          await this.workspaceService.cleanupWorkspaceNow(workspaceRoot);
          logger.debug(`${logPrefix} Workspace cleaned up`);
        } else {
          // Sync task: delayed cleanup (5 seconds)
          this.workspaceService.cleanupWorkspace(workspaceRoot, 5000);
        }
      }

      logger.info(`${logPrefix} Task execution finished`);
    }
  }

  /**
   * Setup and start the authentication proxy
   */
  private async setupProxy(
    anthropicApiKey?: string,
    anthropicOAuthToken?: string,
    logPrefix: string = ''
  ): Promise<{ proxy: SimpleAnthropicProxy; proxyPort: number }> {
    logger.debug(`${logPrefix} Starting token proxy`);

    const proxy = new SimpleAnthropicProxy(anthropicApiKey, anthropicOAuthToken);
    await proxy.start();
    const proxyPort = proxy.getPort();

    logger.debug(`${logPrefix} Token proxy started on 127.0.0.1:${proxyPort}`);

    // Small delay to ensure proxy is fully ready
    await new Promise(resolve => setTimeout(resolve, 100));

    return { proxy, proxyPort };
  }

  /**
   * Setup workspace: create, write SSH keys, clone git repo
   */
  private async setupWorkspace(
    gitRepo?: string,
    sshKey?: string,
    gitBranch: string = 'main',
    gitDepth: number = 1,
    logPrefix: string = ''
  ): Promise<{ workspaceRoot: string; sshKeyPath?: string }> {
    // Create workspace
    let workspaceRoot = await this.workspaceService.createWorkspace();
    logger.debug(`${logPrefix} Workspace created: ${workspaceRoot}`);

    let sshKeyPath: string | undefined;

    // Write SSH key if provided
    if (sshKey) {
      logger.debug(`${logPrefix} Writing SSH key (${sshKey.length} bytes)`);
      try {
        sshKeyPath = await this.workspaceService.writeSshKeyFile(workspaceRoot, sshKey);
        logger.debug(`${logPrefix} SSH key written to: ${sshKeyPath}`);
      } catch (error: any) {
        logger.error(`${logPrefix} Failed to write SSH key:`, error.message);
        throw error;
      }
    }

    // Clone repository if provided
    if (gitRepo) {
      let repoUrlToUse = gitRepo;

      // Convert HTTPS URLs to SSH format if we have an SSH key
      if (sshKey) {
        if (gitRepo.startsWith('http://') || gitRepo.startsWith('https://')) {
          repoUrlToUse = this.gitService.convertHttpsToSsh(gitRepo);
          logger.debug(`${logPrefix} Converted HTTPS URL to SSH format: ${gitRepo} -> ${repoUrlToUse}`);
        }
      } else {
        logger.debug(`${logPrefix} No SSH key provided`);

        if (gitRepo.startsWith('git@')) {
          logger.debug(`${logPrefix} SSH URL requires authentication but no SSH key available`);
        } else {
          logger.debug(`${logPrefix} Attempting public HTTPS clone`);
        }
      }

      // Clone into 'repo' subdirectory
      const repoPath = path.join(workspaceRoot, 'repo');

      await this.gitService.cloneRepository({
        gitRepo: repoUrlToUse,
        targetPath: repoPath,
        branch: gitBranch,
        depth: gitDepth,
        sshKeyPath
      });

      // Update workspaceRoot to point to cloned repository
      workspaceRoot = repoPath;
      logger.debug(`${logPrefix} Repository cloned to: ${workspaceRoot}`);
    }

    return { workspaceRoot, sshKeyPath };
  }

  /**
   * Setup environment variables for Claude execution
   */
  private async setupEnvironment(
    workspaceRoot: string,
    environmentSecrets: Record<string, string>,
    proxyPort: number,
    anthropicApiKey?: string,
    anthropicOAuthToken?: string,
    sshKeyPath?: string,
    logPrefix: string = ''
  ): Promise<Record<string, string>> {
    // Write environment secrets to .env file
    if (Object.keys(environmentSecrets).length > 0) {
      logger.debug(`${logPrefix} Writing ${Object.keys(environmentSecrets).length} environment secrets`);
      const envContent = Object.entries(environmentSecrets)
        .map(([key, value]) => `${key}=${value}`)
        .join('\n');
      await this.workspaceService.writeEnvFile(workspaceRoot, envContent);
    }

    // Build Claude environment
    const claudeEnv: Record<string, string> = {
      // Proxy configuration - use ANTHROPIC_BASE_URL to only intercept Anthropic API traffic
      ANTHROPIC_BASE_URL: `http://127.0.0.1:${proxyPort}`,
      // User-provided environment secrets (intentionally accessible)
      ...environmentSecrets
    };

    // SECURITY: Pass dummy credential that matches the type we have
    // Proxy will replace it with the real credential
    if (anthropicApiKey) {
      claudeEnv.ANTHROPIC_API_KEY = 'dummy-api-key-proxy-will-replace';
    } else if (anthropicOAuthToken) {
      claudeEnv.CLAUDE_CODE_OAUTH_TOKEN = 'dummy-oauth-token-proxy-will-replace';
    }

    // Configure Git to use per-request SSH key for Claude's git commands
    if (sshKeyPath) {
      claudeEnv.GIT_SSH_COMMAND = `ssh -i ${sshKeyPath} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null`;
      logger.debug(`${logPrefix} GIT_SSH_COMMAND configured`);
    }

    return claudeEnv;
  }

  /**
   * Build Claude options from request
   */
  private buildClaudeOptions(
    request: RunRequest,
    claudeEnv: Record<string, string>
  ): ClaudeOptions {
    return {
      allowedTools: request.allowedTools,
      disallowedTools: request.disallowedTools,
      maxTurns: request.maxTurns,
      systemPrompt: request.systemPrompt,
      appendSystemPrompt: request.appendSystemPrompt,
      permissionMode: request.permissionMode,
      timeoutMinutes: request.timeoutMinutes || 55,
      model: request.model,
      fallbackModel: request.fallbackModel,
      dangerouslySkipPermissions: process.env.DANGEROUSLY_SKIP_PERMISSIONS === 'true',
      debug: process.env.CLAUDE_DEBUG === 'true',
      claudeEnv
    };
  }
}
