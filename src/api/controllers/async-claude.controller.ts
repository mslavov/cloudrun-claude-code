import { Request, Response } from "express";
import crypto from "crypto";
import { GCSLoggerService } from "../services/gcs.service.js";
import { EncryptionService } from "../services/encryption.service.js";
import { JobTriggerService } from "../services/job-trigger.service.js";
import { TaskRegistry } from "../services/task-registry.service.js";
import { AsyncRunRequest, AsyncRunResponse } from "../types/async-task.types.js";
import { logger } from "../../utils/logger.js";

/**
 * Async Claude Controller
 * Handles async task creation and Cloud Run Job execution
 */
export class AsyncClaudeController {
  private gcsLogger: GCSLoggerService;
  private encryptionService: EncryptionService;
  private jobTrigger: JobTriggerService;
  private registry: TaskRegistry;

  constructor() {
    this.gcsLogger = new GCSLoggerService();
    this.encryptionService = new EncryptionService();
    this.jobTrigger = new JobTriggerService();
    this.registry = TaskRegistry.getInstance();
  }

  /**
   * POST /run-async
   * Create and execute an async Claude Code task via Cloud Run Job
   *
   * Returns immediately with task ID while execution continues in separate job container
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
      // 1. Encrypt the entire payload (contains secrets)
      logger.info(`[TASK ${taskId}] Encrypting payload with Cloud KMS`);
      const encryptedPayload = await this.encryptionService.encryptPayload(req.body);
      logger.debug(`[TASK ${taskId}] Payload encrypted (${encryptedPayload.length} bytes)`);

      // 2. Store encrypted payload in GCS
      const payloadPath = await this.gcsLogger.storeEncryptedPayload(
        taskId,
        encryptedPayload
      );
      logger.info(`[TASK ${taskId}] Encrypted payload stored at: ${payloadPath}`);

      // 3. Save non-sensitive metadata
      await this.gcsLogger.saveMetadata(taskId, {
        taskId,
        status: 'pending',
        callbackUrl,
        createdAt,
        encryptedPayloadPath: payloadPath,
        metadata: metadata || {}
      });
      logger.debug(`[TASK ${taskId}] Metadata saved`);

      // 4. Trigger Cloud Run Job (only pass task ID and path)
      logger.info(`[TASK ${taskId}] Triggering Cloud Run Job`);
      const executionName = await this.jobTrigger.triggerJobExecution(
        taskId,
        payloadPath
      );
      logger.info(`[TASK ${taskId}] Job execution triggered: ${executionName}`);

      // 5. Register task in registry for cancellation support
      try {
        this.registry.register(taskId, executionName, 'async');
        logger.debug(`[TASK ${taskId}] Task registered in registry`);
      } catch (error: any) {
        logger.error(`[TASK ${taskId}] Failed to register task:`, error.message);
        // Continue anyway - registration is for cancellation only
      }

      // 6. Return immediately to client
      const logsPath = this.gcsLogger.getLogsPath(taskId);
      const response: AsyncRunResponse = {
        taskId,
        status: 'pending',
        logsPath,
        createdAt,
        executionName // Optional: for tracking job execution
      };

      logger.info(`[TASK ${taskId}] Task created, returning 202 Accepted`);
      res.status(202).json(response);

    } catch (error: any) {
      logger.error(`[TASK ${taskId}] Error creating async task:`, error.message, error.stack);

      // If headers not sent yet, send error response
      if (!res.headersSent) {
        res.status(500).json({ error: error.message });
      }
    }
  }
}
