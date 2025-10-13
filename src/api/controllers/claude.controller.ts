import { Request, Response } from "express";
import crypto from "crypto";
import { GCSLoggerService } from "../services/gcs.service.js";
import { EncryptionService } from "../services/encryption.service.js";
import { JobTriggerService } from "../services/job-trigger.service.js";
import { TaskRegistry } from "../services/task-registry.service.js";
import { RunRequest } from "../types/request.types.js";
import { logger } from "../../utils/logger.js";

/**
 * Claude Controller
 * Handles synchronous Claude Code execution via Cloud Run Jobs with Server-Sent Events (SSE) streaming
 *
 * Flow:
 * 1. Encrypt payload and store in GCS
 * 2. Trigger Cloud Run Job
 * 3. Poll GCS logs and stream to client via SSE
 * 4. Wait for completion and close SSE connection
 */
export class ClaudeController {
  private gcsService: GCSLoggerService;
  private encryptionService: EncryptionService;
  private jobTrigger: JobTriggerService;
  private registry: TaskRegistry;

  constructor() {
    this.gcsService = new GCSLoggerService();
    this.encryptionService = new EncryptionService();
    this.jobTrigger = new JobTriggerService();
    this.registry = TaskRegistry.getInstance();
  }

  async runClaude(req: Request<{}, {}, RunRequest>, res: Response): Promise<void> {
    logger.debug("POST /run - Request received");

    const {
      prompt,
      anthropicApiKey,
      anthropicOAuthToken
    } = req.body || {};

    logger.debug("Request body:", {
      prompt: prompt?.substring(0, 50) + "...",
      hasAnthropicApiKey: !!anthropicApiKey,
      hasAnthropicOAuthToken: !!anthropicOAuthToken
    });

    // Validate required fields
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

    // Check for GCS configuration
    if (!process.env.GCS_LOGS_BUCKET) {
      logger.error("GCS_LOGS_BUCKET environment variable not configured");
      res.status(500).json({ error: "Job-based execution not configured (missing GCS_LOGS_BUCKET)" });
      return;
    }

    // Generate task ID for sync request
    const taskId = `sync-${crypto.randomUUID()}`;
    const logPrefix = `[TASK ${taskId}]`;

    logger.info(`${logPrefix} Starting sync job-based execution`);

    let executionName: string | undefined;
    let registered = false;

    try {
      // Set up SSE headers
      logger.debug(`${logPrefix} Setting up SSE headers`);
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      // Handle client disconnect
      let clientDisconnected = false;
      req.on("close", () => {
        logger.debug(`${logPrefix} Client disconnected`);
        clientDisconnected = true;

        // Try to cancel the job if client disconnects
        if (registered && executionName) {
          this.registry.cancelTask(taskId)
            .catch(error => logger.error(`${logPrefix} Failed to cancel on disconnect:`, error.message));
        }
      });

      // 1. Encrypt payload
      logger.info(`${logPrefix} Encrypting payload with Cloud KMS`);
      const encryptedPayload = await this.encryptionService.encryptPayload(req.body);
      logger.debug(`${logPrefix} Payload encrypted (${encryptedPayload.length} bytes)`);

      // 2. Store encrypted payload in GCS
      const payloadPath = await this.gcsService.storeEncryptedPayload(taskId, encryptedPayload);
      logger.info(`${logPrefix} Encrypted payload stored at: ${payloadPath}`);

      // 3. Save initial metadata
      await this.gcsService.saveMetadata(taskId, {
        taskId,
        status: 'pending',
        createdAt: new Date().toISOString(),
        encryptedPayloadPath: payloadPath,
        executionMode: 'sync' // Mark as sync execution
      });

      // 4. Trigger Cloud Run Job
      logger.info(`${logPrefix} Triggering Cloud Run Job`);
      executionName = await this.jobTrigger.triggerJobExecution(taskId, payloadPath);
      logger.info(`${logPrefix} Job execution triggered: ${executionName}`);

      // 5. Register task in registry for cancellation support
      try {
        this.registry.register(taskId, executionName, 'sync');
        registered = true;
        logger.debug(`${logPrefix} Task registered in registry`);
      } catch (error: any) {
        logger.error(`${logPrefix} Failed to register task:`, error.message);
        // Continue anyway - registration is for cancellation only
      }

      // 6. Poll GCS logs and stream to SSE
      logger.info(`${logPrefix} Starting log polling and SSE streaming`);

      const onData = (line: string) => {
        if (clientDisconnected) return;

        // Log Claude output
        if (line.trim()) {
          logger.info(`${logPrefix} [CLAUDE OUTPUT]`, line);
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

      // 7. Wait for job completion (with 55 minute timeout)
      const metadata = await this.gcsService.waitForCompletion(
        taskId,
        onData,
        55 * 60 * 1000, // 55 minutes (Cloud Run max is 60)
        2000 // Poll every 2 seconds
      );

      logger.info(`${logPrefix} Job completed with status: ${metadata.status}`);

      // Check if cancelled
      if (registered && this.registry.isCancelling(taskId)) {
        logger.info(`${logPrefix} Task was cancelled by user`);
        res.write(`event: cancelled\ndata: ${JSON.stringify({ message: 'Task cancelled by user' })}\n\n`);
      } else if (metadata.status === 'failed') {
        logger.error(`${logPrefix} Task failed: ${metadata.error}`);
        res.write(`event: error\ndata: ${JSON.stringify({ error: metadata.error || 'Task failed' })}\n\n`);
      }

      // End SSE stream
      res.end();

    } catch (err: any) {
      logger.error(`${logPrefix} Error:`, err.message, err.stack);

      // If headers not sent yet, send error response
      if (!res.headersSent) {
        res.status(500).json({ error: err.message });
      } else {
        res.write(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`);
        res.end();
      }
    } finally {
      // Unregister task from registry
      if (registered) {
        this.registry.unregister(taskId);
        logger.debug(`${logPrefix} Task unregistered from registry`);
      }

      logger.info(`${logPrefix} Sync request completed`);
    }
  }
}
