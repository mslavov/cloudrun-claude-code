import { Storage, Bucket, File } from "@google-cloud/storage";
import { logger } from "../../utils/logger.js";
import { Writable } from "stream";

/**
 * GCS Logger Service
 * Handles streaming Claude Code JSONL output to Google Cloud Storage
 *
 * Strategy: Since GCS doesn't support true append operations, we use a chunked approach
 * where logs are written in batches to separate chunk files that can be read sequentially.
 */
export class GCSLoggerService {
  private storage: Storage;
  private bucket: Bucket;
  private bucketName: string;

  constructor() {
    const bucketName = process.env.GCS_LOGS_BUCKET;
    const projectId = process.env.GCS_PROJECT_ID;

    if (!bucketName) {
      throw new Error("GCS_LOGS_BUCKET environment variable is required");
    }

    // Initialize storage client
    // Uses Application Default Credentials (ADC) which works in Cloud Run
    this.storage = projectId
      ? new Storage({ projectId })
      : new Storage();

    this.bucketName = bucketName;
    this.bucket = this.storage.bucket(bucketName);

    logger.debug(`GCS Logger initialized for bucket: ${bucketName}`);
  }

  /**
   * Create a streaming logger for a task
   * Returns a writable stream that buffers and writes JSONL chunks to GCS
   */
  createTaskLogger(taskId: string): TaskLogger {
    return new TaskLogger(this.bucket, taskId);
  }

  /**
   * Save task metadata to GCS
   */
  async saveMetadata(taskId: string, metadata: any): Promise<void> {
    const metadataPath = `sessions/${taskId}/metadata.json`;
    const file = this.bucket.file(metadataPath);

    try {
      await file.save(JSON.stringify(metadata, null, 2), {
        contentType: "application/json",
        metadata: {
          taskId,
          createdAt: new Date().toISOString()
        }
      });
      logger.debug(`✓ Metadata saved for task ${taskId}`);
    } catch (error: any) {
      logger.error(`Failed to save metadata for task ${taskId}:`, error.message);
      throw error;
    }
  }

  /**
   * Get logs path for a task
   */
  getLogsPath(taskId: string): string {
    return `gs://${this.bucketName}/sessions/${taskId}/`;
  }

  /**
   * List all log chunks for a task (for retrieval)
   */
  async listLogChunks(taskId: string): Promise<string[]> {
    const prefix = `sessions/${taskId}/`;
    const [files] = await this.bucket.getFiles({ prefix });

    return files
      .filter(file => file.name.endsWith('.jsonl'))
      .map(file => file.name)
      .sort(); // Chunks are named with timestamps, so sorting gives chronological order
  }

  /**
   * Store encrypted task payload in GCS
   * Path: tasks/{taskId}/payload.enc
   */
  async storeEncryptedPayload(
    taskId: string,
    encryptedData: Buffer
  ): Promise<string> {
    const filePath = `tasks/${taskId}/payload.enc`;
    const file = this.bucket.file(filePath);

    try {
      await file.save(encryptedData, {
        contentType: 'application/octet-stream',
        metadata: {
          metadata: {
            taskId,
            encrypted: 'true',
            encryptedAt: new Date().toISOString()
          }
        }
      });

      const gcsPath = `gs://${this.bucketName}/${filePath}`;
      logger.debug(`✓ Encrypted payload stored for task ${taskId} at ${gcsPath}`);
      return gcsPath;
    } catch (error: any) {
      logger.error(`Failed to store encrypted payload for task ${taskId}:`, error.message);
      throw error;
    }
  }

  /**
   * Read encrypted payload from GCS
   */
  async readEncryptedPayload(taskId: string): Promise<Buffer> {
    const filePath = `tasks/${taskId}/payload.enc`;
    const file = this.bucket.file(filePath);

    try {
      const [contents] = await file.download();
      logger.debug(`✓ Encrypted payload read for task ${taskId} (${contents.length} bytes)`);
      return contents;
    } catch (error: any) {
      logger.error(`Failed to read encrypted payload for task ${taskId}:`, error.message);
      throw error;
    }
  }

  /**
   * Delete encrypted payload from GCS (cleanup after job completion)
   * Idempotent - doesn't fail if file doesn't exist
   */
  async deleteEncryptedPayload(taskId: string): Promise<void> {
    const filePath = `tasks/${taskId}/payload.enc`;
    const file = this.bucket.file(filePath);

    try {
      await file.delete();
      logger.info(`[TASK ${taskId}] Deleted encrypted payload`);
    } catch (error: any) {
      // Don't fail if already deleted (idempotent)
      if (error.code === 404) {
        logger.debug(`Encrypted payload for task ${taskId} already deleted or doesn't exist`);
      } else {
        logger.error(`Failed to delete encrypted payload for task ${taskId}:`, error.message);
        throw error;
      }
    }
  }

  /**
   * Get encrypted payload GCS path
   */
  getEncryptedPayloadPath(taskId: string): string {
    return `gs://${this.bucketName}/tasks/${taskId}/payload.enc`;
  }
}

/**
 * TaskLogger handles streaming writes for a single task
 * Buffers lines and writes them in chunks to avoid excessive GCS operations
 */
export class TaskLogger extends Writable {
  private bucket: Bucket;
  private taskId: string;
  private buffer: string[] = [];
  private chunkIndex = 0;
  private readonly CHUNK_SIZE = 100; // Lines per chunk
  private readonly FLUSH_INTERVAL_MS = 2000; // Flush every 2 seconds
  private writePromises: Promise<void>[] = [];
  private flushTimer?: NodeJS.Timeout;

  constructor(bucket: Bucket, taskId: string) {
    super({ objectMode: true });
    this.bucket = bucket;
    this.taskId = taskId;

    logger.debug(`TaskLogger created for task: ${taskId}`);
  }

  /**
   * Write a single JSONL line to the logger
   */
  _write(line: string, encoding: string, callback: (error?: Error | null) => void): void {
    try {
      // Add line to buffer
      this.buffer.push(line);

      // If buffer reaches chunk size, flush it immediately
      if (this.buffer.length >= this.CHUNK_SIZE) {
        this.clearFlushTimer();
        this.flushBuffer()
          .then(() => {
            this.startFlushTimer();
            callback();
          })
          .catch(error => callback(error));
      } else {
        // Start/restart timer to flush after interval
        this.startFlushTimer();
        callback();
      }
    } catch (error: any) {
      logger.error(`Error writing line to task logger:`, error);
      callback(error);
    }
  }

  /**
   * Final flush when stream is closed
   */
  _final(callback: (error?: Error | null) => void): void {
    // Clear timer first
    this.clearFlushTimer();

    // Flush any remaining buffered lines
    this.flushBuffer()
      .then(() => {
        // Wait for all pending writes to complete
        return Promise.all(this.writePromises);
      })
      .then(() => {
        logger.debug(`✓ TaskLogger finalized for task ${this.taskId}, ${this.chunkIndex} chunks written`);
        callback();
      })
      .catch(error => {
        logger.error(`Error finalizing task logger:`, error);
        callback(error);
      });
  }

  /**
   * Start or restart the flush timer
   */
  private startFlushTimer(): void {
    // Clear existing timer
    this.clearFlushTimer();

    // Only start timer if there's data in the buffer
    if (this.buffer.length > 0) {
      this.flushTimer = setTimeout(() => {
        logger.debug(`Time-based flush triggered for task ${this.taskId} (${this.buffer.length} lines)`);
        this.flushBuffer().catch(error => {
          logger.error(`Error in time-based flush for task ${this.taskId}:`, error);
        });
      }, this.FLUSH_INTERVAL_MS);
    }
  }

  /**
   * Clear the flush timer
   */
  private clearFlushTimer(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }
  }

  /**
   * Flush buffered lines to a new GCS chunk file
   */
  private async flushBuffer(): Promise<void> {
    if (this.buffer.length === 0) {
      return;
    }

    const lines = [...this.buffer];
    this.buffer = [];
    this.chunkIndex++;

    // Create chunk filename with timestamp and index
    // Format: 001-20250112-103045.jsonl
    const timestamp = new Date().toISOString().replace(/[-:T]/g, '').split('.')[0];
    const chunkNumber = String(this.chunkIndex).padStart(3, '0');
    const chunkName = `sessions/${this.taskId}/${chunkNumber}-${timestamp}.jsonl`;

    logger.debug(`Writing chunk ${chunkNumber} for task ${this.taskId} (${lines.length} lines)`);

    // Create write promise
    const writePromise = this.writeChunk(chunkName, lines);
    this.writePromises.push(writePromise);

    return writePromise;
  }

  /**
   * Write a chunk to GCS
   */
  private async writeChunk(chunkName: string, lines: string[]): Promise<void> {
    const file = this.bucket.file(chunkName);
    const content = lines.join('\n') + '\n';

    try {
      await file.save(content, {
        contentType: "application/x-ndjson",
        metadata: {
          taskId: this.taskId,
          chunkIndex: this.chunkIndex,
          lineCount: lines.length,
          createdAt: new Date().toISOString()
        }
      });

      logger.debug(`✓ Chunk ${chunkName} written successfully (${lines.length} lines, ${content.length} bytes)`);
    } catch (error: any) {
      logger.error(`Failed to write chunk ${chunkName}:`, error.message);
      throw error;
    }
  }

  /**
   * Get the current logs path
   */
  getLogsPath(): string {
    return `gs://${this.bucket.name}/sessions/${this.taskId}/`;
  }
}
