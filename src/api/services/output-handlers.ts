import { Request, Response } from "express";
import axios from "axios";
import { ClaudeRunResult } from "../../claude-runner.js";
import { GCSLoggerService, TaskLogger } from "./gcs-logger.service.js";
import { AsyncTaskResult, AsyncTaskMetadata } from "../types/async-task.types.js";
import { logger } from "../../utils/logger.js";

/**
 * OutputHandler interface
 * Defines how Claude Code output is handled (SSE stream, GCS logging, etc.)
 */
export interface OutputHandler {
  /**
   * Called for each line of JSONL output from Claude
   */
  onData(line: string): void;

  /**
   * Called when an error occurs during execution
   */
  onError(error: string): void;

  /**
   * Called when Claude execution completes
   */
  onComplete(result: ClaudeRunResult, durationMs: number): Promise<void>;

  /**
   * Cleanup resources
   */
  cleanup(): Promise<void>;
}

/**
 * SSEOutputHandler
 * Writes Claude output to Server-Sent Events (SSE) stream for synchronous requests
 */
export class SSEOutputHandler implements OutputHandler {
  private connectionClosed = false;

  constructor(
    private res: Response,
    private req?: Request
  ) {
    // Handle client disconnect
    if (this.req) {
      this.req.on("close", () => {
        logger.debug("Client disconnected, marking connection as closed");
        this.connectionClosed = true;
      });
    }
  }

  onData(line: string): void {
    if (this.connectionClosed) return;

    // Log Claude output at info level (visible without debug mode)
    if (line.trim()) {
      logger.info('[CLAUDE OUTPUT]', line);
    }

    try {
      // Try to parse as JSON
      const message = JSON.parse(line);
      this.res.write(`data: ${JSON.stringify(message)}\n\n`);
      (this.res as any).flush?.();
    } catch (e) {
      // If not JSON, send as text
      if (line.trim()) {
        this.res.write(`data: ${JSON.stringify({ type: "text", content: line })}\n\n`);
        (this.res as any).flush?.();
      }
    }
  }

  onError(error: string): void {
    if (this.connectionClosed) return;

    this.res.write(`event: error\ndata: ${JSON.stringify({ error })}\n\n`);
    (this.res as any).flush?.();
  }

  async onComplete(result: ClaudeRunResult, _durationMs: number): Promise<void> {
    if (this.connectionClosed) return;

    logger.debug(`Claude process completed with exit code: ${result.exitCode}`);

    if (result.exitCode !== 0) {
      this.res.write(`event: error\ndata: ${JSON.stringify({
        error: `Claude process exited with code ${result.exitCode}`,
        stderr: result.error
      })}\n\n`);
    }

    this.res.end();
  }

  async cleanup(): Promise<void> {
    // SSE handler doesn't need cleanup
  }

  isConnectionClosed(): boolean {
    return this.connectionClosed;
  }
}

/**
 * GCSOutputHandler
 * Writes Claude output to Google Cloud Storage and calls webhook on completion
 * Used for asynchronous background tasks
 */
export class GCSOutputHandler implements OutputHandler {
  private taskLogger: TaskLogger;
  private turnCount = 0;
  private errorCount = 0;
  private startedAt: string;

  constructor(
    private taskId: string,
    private callbackUrl: string,
    private gcsLogger: GCSLoggerService,
    private metadata?: Record<string, any>
  ) {
    this.startedAt = new Date().toISOString();
    this.taskLogger = gcsLogger.createTaskLogger(taskId);
    logger.debug(`[TASK ${taskId}] GCS output handler initialized`);

    // Save initial metadata
    const initialMetadata: AsyncTaskMetadata = {
      taskId,
      status: 'running',
      callbackUrl,
      createdAt: this.startedAt,
      startedAt: this.startedAt,
      metadata: this.metadata
    };

    this.gcsLogger.saveMetadata(taskId, initialMetadata)
      .catch(error => {
        logger.error(`[TASK ${taskId}] Failed to save initial metadata:`, error.message);
      });
  }

  onData(line: string): void {
    if (line.trim()) {
      logger.info(`[TASK ${this.taskId}] [CLAUDE OUTPUT]`, line);

      // Write to GCS
      this.taskLogger.write(line);

      // Track metrics from JSONL output
      try {
        const message = JSON.parse(line);
        if (message.type === 'turn_complete') {
          this.turnCount++;
        } else if (message.type === 'error') {
          this.errorCount++;
        }
      } catch (e) {
        // Not JSON or parsing failed - that's ok
      }
    }
  }

  onError(error: string): void {
    logger.error(`[TASK ${this.taskId}] Claude error:`, error);
    this.taskLogger.write(JSON.stringify({
      type: 'error',
      error,
      timestamp: new Date().toISOString()
    }));
    this.errorCount++;
  }

  async onComplete(result: ClaudeRunResult, durationMs: number): Promise<void> {
    logger.info(`[TASK ${this.taskId}] Claude process completed with exit code: ${result.exitCode}`);

    const completedAt = new Date().toISOString();

    // Save final metadata
    const finalMetadata: AsyncTaskMetadata = {
      taskId: this.taskId,
      status: result.exitCode === 0 ? 'completed' : 'failed',
      callbackUrl: this.callbackUrl,
      createdAt: this.startedAt,
      startedAt: this.startedAt,
      completedAt,
      error: result.error,
      metadata: this.metadata
    };

    try {
      await this.gcsLogger.saveMetadata(this.taskId, finalMetadata);
    } catch (error: any) {
      logger.error(`[TASK ${this.taskId}] Failed to save final metadata:`, error.message);
    }

    // Prepare callback payload
    const callbackPayload: AsyncTaskResult = {
      taskId: this.taskId,
      status: result.exitCode === 0 ? 'completed' : 'failed',
      exitCode: result.exitCode,
      logsPath: this.gcsLogger.getLogsPath(this.taskId),
      summary: {
        durationMs,
        turns: this.turnCount > 0 ? this.turnCount : undefined,
        errors: this.errorCount > 0 ? this.errorCount : undefined,
        startedAt: this.startedAt,
        completedAt
      },
      error: result.error,
      metadata: this.metadata
    };

    // Call webhook
    await this.callWebhook(callbackPayload);

    logger.info(`[TASK ${this.taskId}] Task completed successfully in ${durationMs}ms`);
  }

  async cleanup(): Promise<void> {
    // Close logger stream
    try {
      this.taskLogger.end();
      await new Promise((resolve, reject) => {
        this.taskLogger.on('finish', resolve);
        this.taskLogger.on('error', reject);
        setTimeout(() => reject(new Error('Timeout waiting for logger to finish')), 5000);
      });
      logger.debug(`[TASK ${this.taskId}] GCS logger closed`);
    } catch (error: any) {
      logger.error(`[TASK ${this.taskId}] Failed to close GCS logger:`, error.message);
    }
  }

  private async callWebhook(payload: AsyncTaskResult): Promise<void> {
    logger.info(`[TASK ${this.taskId}] Calling webhook: ${this.callbackUrl}`);

    try {
      const response = await axios.post(this.callbackUrl, payload, {
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'cloudrun-claude-code/async-task'
        },
        timeout: 30000, // 30 second timeout
        validateStatus: () => true // Don't throw on any status code
      });

      if (response.status >= 200 && response.status < 300) {
        logger.info(`[TASK ${this.taskId}] Webhook called successfully (status: ${response.status})`);
      } else {
        logger.warn(`[TASK ${this.taskId}] Webhook returned non-2xx status: ${response.status}`, response.data);
      }
    } catch (error: any) {
      logger.error(`[TASK ${this.taskId}] Failed to call webhook:`, error.message);
      // Don't throw - we've already completed the task, webhook failure shouldn't crash the service
    }
  }
}
