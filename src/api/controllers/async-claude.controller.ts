import { Request, Response } from "express";
import crypto from "crypto";
import { TaskService } from "../services/task.service.js";
import { GCSOutputHandler } from "../services/output-handlers.js";
import { GCSLoggerService } from "../services/gcs-logger.service.js";
import { AsyncRunRequest, AsyncRunResponse } from "../types/async-task.types.js";
import { logger } from "../../utils/logger.js";

/**
 * Async Claude Controller
 * Handles async task creation and background execution
 */
export class AsyncClaudeController {
  private taskService: TaskService;
  private gcsLogger: GCSLoggerService;

  constructor() {
    this.taskService = new TaskService();
    this.gcsLogger = new GCSLoggerService();
  }

  /**
   * POST /run-async
   * Create and execute an async Claude Code task
   *
   * Returns immediately with task ID while execution continues in background
   */
  async runAsync(req: Request<{}, {}, AsyncRunRequest>, res: Response): Promise<void> {
    logger.debug("POST /run-async - Request received");

    const {
      prompt,
      callbackUrl,
      taskId: requestedTaskId,
      anthropicApiKey,
      anthropicOAuthToken,
      maxTurns = 6,
      allowedTools,
      systemPrompt,
      useNamedPipe = true,
      gitRepo,
      gitBranch = "main",
      environmentSecrets = {},
      sshKey,
      metadata
    } = req.body || {};

    logger.debug("Request body:", {
      prompt: prompt?.substring(0, 50) + "...",
      hasCallbackUrl: !!callbackUrl,
      requestedTaskId,
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

    // Validate required fields
    if (!prompt) {
      logger.error("Missing prompt in request");
      res.status(400).json({ error: "prompt is required" });
      return;
    }

    if (!callbackUrl) {
      logger.error("Missing callbackUrl in request");
      res.status(400).json({ error: "callbackUrl is required for async tasks" });
      return;
    }

    if (!anthropicApiKey && !anthropicOAuthToken) {
      logger.error("Missing authentication - need either anthropicApiKey or anthropicOAuthToken");
      res.status(400).json({
        error: "Either anthropicApiKey or anthropicOAuthToken is required"
      });
      return;
    }

    // Validate callback URL format
    try {
      const url = new URL(callbackUrl);
      if (!['http:', 'https:'].includes(url.protocol)) {
        logger.error(`Invalid callback URL protocol: ${url.protocol}`);
        res.status(400).json({ error: "callbackUrl must use http or https protocol" });
        return;
      }
    } catch (error) {
      logger.error("Invalid callback URL:", error);
      res.status(400).json({ error: "callbackUrl is not a valid URL" });
      return;
    }

    // Generate or validate task ID
    let taskId: string;
    if (requestedTaskId) {
      // Validate provided task ID (must be URL-safe)
      if (!/^[a-zA-Z0-9_-]+$/.test(requestedTaskId)) {
        logger.error(`Invalid task ID format: ${requestedTaskId}`);
        res.status(400).json({ error: "taskId must be URL-safe (alphanumeric, underscore, hyphen only)" });
        return;
      }
      taskId = requestedTaskId;
      logger.debug(`Using provided task ID: ${taskId}`);
    } else {
      // Generate unique task ID
      taskId = crypto.randomUUID();
      logger.debug(`Generated task ID: ${taskId}`);
    }

    const createdAt = new Date().toISOString();

    // Check for GCS configuration
    if (!process.env.GCS_LOGS_BUCKET) {
      logger.error("GCS_LOGS_BUCKET environment variable not configured");
      res.status(500).json({ error: "Async task support not configured (missing GCS_LOGS_BUCKET)" });
      return;
    }

    try {
      // Calculate logs path (before starting execution)
      const logsPath = this.gcsLogger.getLogsPath(taskId);

      // Return immediately with task info
      const response: AsyncRunResponse = {
        taskId,
        status: 'pending',
        logsPath,
        createdAt
      };

      logger.info(`[TASK ${taskId}] Task created, returning 202 Accepted`);
      res.status(202).json(response);

      // Start async execution in background
      // IMPORTANT: This requires Cloud Run to have CPU always allocated!
      // Otherwise the container will be throttled after returning the response.
      logger.info(`[TASK ${taskId}] Starting background execution`);

      // Create GCS output handler
      const outputHandler = new GCSOutputHandler(
        taskId,
        callbackUrl,
        this.gcsLogger,
        metadata
      );

      // Execute in background (fire-and-forget)
      // Node.js will keep the event loop alive while this promise is pending
      this.taskService.executeTask(req.body, outputHandler, taskId)
        .catch(error => {
          // Log error but don't crash the service
          logger.error(`[TASK ${taskId}] Unhandled error in background execution:`, error);
        });

      logger.info(`[TASK ${taskId}] Background execution started`);

    } catch (error: any) {
      logger.error("Error creating async task:", error.message, error.stack);

      // If headers not sent yet, send error response
      if (!res.headersSent) {
        res.status(500).json({ error: error.message });
      }
    }
  }
}
