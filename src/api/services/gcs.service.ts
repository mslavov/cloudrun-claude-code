import { Storage, Bucket, File } from "@google-cloud/storage";
import { logger } from "../../utils/logger.js";
import { Writable } from "stream";
import { glob } from "glob";
import * as fs from "fs";
import * as path from "path";

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

  /**
   * Read task metadata from GCS
   * Returns null if metadata doesn't exist yet
   */
  async readMetadata(taskId: string): Promise<any | null> {
    const metadataPath = `sessions/${taskId}/metadata.json`;
    const file = this.bucket.file(metadataPath);

    try {
      const [contents] = await file.download();
      return JSON.parse(contents.toString('utf-8'));
    } catch (error: any) {
      if (error.code === 404) {
        logger.debug(`Metadata not found for task ${taskId} (task may not have started yet)`);
        return null;
      }
      logger.error(`Failed to read metadata for task ${taskId}:`, error.message);
      throw error;
    }
  }

  /**
   * Poll for new log chunks and stream lines via callback
   * Returns the index of the last chunk processed
   *
   * @param taskId - Task identifier
   * @param lastChunkIndex - Index of last chunk already processed (0 for start)
   * @param onData - Callback for each log line
   * @returns Index of last chunk processed
   */
  async pollNewLogs(
    taskId: string,
    lastChunkIndex: number,
    onData: (line: string) => void
  ): Promise<number> {
    const chunks = await this.listLogChunks(taskId);

    if (chunks.length === 0) {
      logger.debug(`[TASK ${taskId}] No log chunks found yet`);
      return lastChunkIndex;
    }

    // Filter chunks we haven't processed yet
    const newChunks = chunks.filter(chunkName => {
      // Extract chunk number from filename (format: 001-20250112-103045.jsonl)
      const match = chunkName.match(/\/(\d+)-/);
      if (!match) return false;
      const chunkNum = parseInt(match[1], 10);
      return chunkNum > lastChunkIndex;
    }).sort();

    if (newChunks.length === 0) {
      logger.debug(`[TASK ${taskId}] No new chunks since index ${lastChunkIndex}`);
      return lastChunkIndex;
    }

    logger.debug(`[TASK ${taskId}] Processing ${newChunks.length} new chunks`);

    let maxChunkIndex = lastChunkIndex;

    // Read and process each new chunk
    for (const chunkName of newChunks) {
      try {
        const file = this.bucket.file(chunkName);
        const [contents] = await file.download();
        const lines = contents.toString('utf-8').split('\n').filter(line => line.trim());

        // Call onData for each line
        for (const line of lines) {
          onData(line);
        }

        // Update max chunk index
        const match = chunkName.match(/\/(\d+)-/);
        if (match) {
          const chunkNum = parseInt(match[1], 10);
          maxChunkIndex = Math.max(maxChunkIndex, chunkNum);
        }

        logger.debug(`[TASK ${taskId}] Processed chunk: ${chunkName} (${lines.length} lines)`);
      } catch (error: any) {
        logger.error(`[TASK ${taskId}] Failed to read chunk ${chunkName}:`, error.message);
        // Continue with other chunks even if one fails
      }
    }

    return maxChunkIndex;
  }

  /**
   * Wait for task completion by polling metadata and streaming logs
   *
   * @param taskId - Task identifier
   * @param onData - Callback for each log line
   * @param timeoutMs - Maximum time to wait (default: 3600000 = 1 hour)
   * @param pollIntervalMs - Polling interval (default: 2000 = 2 seconds)
   * @returns Final metadata when task completes
   * @throws Error if timeout exceeded or task fails
   */
  async waitForCompletion(
    taskId: string,
    onData: (line: string) => void,
    timeoutMs: number = 3600000,
    pollIntervalMs: number = 2000
  ): Promise<any> {
    const startTime = Date.now();
    let lastChunkIndex = 0;
    let metadata: any = null;

    logger.info(`[TASK ${taskId}] Waiting for job completion (timeout: ${timeoutMs}ms, poll interval: ${pollIntervalMs}ms)`);

    while (Date.now() - startTime < timeoutMs) {
      try {
        // Poll for new logs
        lastChunkIndex = await this.pollNewLogs(taskId, lastChunkIndex, onData);

        // Check metadata for completion status
        metadata = await this.readMetadata(taskId);

        if (metadata) {
          const status = metadata.status;
          logger.debug(`[TASK ${taskId}] Current status: ${status}`);

          if (status === 'completed' || status === 'failed' || status === 'cancelled') {
            logger.info(`[TASK ${taskId}] Job ${status}`);

            // Do one final poll for any remaining logs
            await this.pollNewLogs(taskId, lastChunkIndex, onData);

            return metadata;
          }
        }

        // Wait before next poll
        await new Promise(resolve => setTimeout(resolve, pollIntervalMs));

      } catch (error: any) {
        logger.error(`[TASK ${taskId}] Error during polling:`, error.message);
        // Continue polling even if there's an error
        await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
      }
    }

    // Timeout exceeded
    throw new Error(`Timeout waiting for task ${taskId} to complete (${timeoutMs}ms exceeded)`);
  }

  /**
   * Upload a single file to GCS
   * @param taskId - Task identifier for organizing uploads
   * @param filePath - Absolute path to file to upload
   * @param gcsPrefix - Optional prefix in bucket (default: files/{taskId})
   * @returns GCS path of uploaded file
   */
  async uploadFile(
    taskId: string,
    filePath: string,
    gcsPrefix?: string
  ): Promise<string> {
    const fileName = path.basename(filePath);
    const prefix = gcsPrefix || `files/${taskId}`;
    const gcsPath = `${prefix}/${fileName}`;
    const file = this.bucket.file(gcsPath);

    try {
      const fileContents = await fs.promises.readFile(filePath);
      const stats = await fs.promises.stat(filePath);

      await file.save(fileContents, {
        metadata: {
          metadata: {
            taskId,
            originalPath: filePath,
            uploadedAt: new Date().toISOString(),
            sizeBytes: stats.size.toString()
          }
        }
      });

      const fullGcsPath = `gs://${this.bucketName}/${gcsPath}`;
      logger.info(`✓ Uploaded file: ${filePath} → ${fullGcsPath} (${stats.size} bytes)`);

      return fullGcsPath;
    } catch (error: any) {
      logger.error(`Failed to upload file ${filePath}:`, error.message);
      throw error;
    }
  }

  /**
   * Upload files matching glob patterns to GCS
   * @param taskId - Task identifier
   * @param workspacePath - Root directory to search from
   * @param globPatterns - Array of glob patterns (e.g., [".playwright/**\/*.webm"])
   * @param gcsPrefix - Optional prefix in bucket
   * @returns Array of upload results with original path and GCS path
   */
  async uploadFilesByGlob(
    taskId: string,
    workspacePath: string,
    globPatterns: string[],
    gcsPrefix?: string
  ): Promise<Array<{ originalPath: string; gcsPath: string; sizeBytes: number }>> {
    const results: Array<{ originalPath: string; gcsPath: string; sizeBytes: number }> = [];

    logger.info(`[TASK ${taskId}] Starting file upload for patterns: ${globPatterns.join(', ')}`);
    logger.info(`[TASK ${taskId}] Searching from workspace: ${workspacePath}`);

    for (const pattern of globPatterns) {
      try {
        logger.debug(`[TASK ${taskId}] Searching for pattern: ${pattern}`);

        // Find files matching pattern
        const matches = await glob(pattern, {
          cwd: workspacePath,
          absolute: true,
          nodir: true,
          ignore: ['**/node_modules/**', '**/.git/**']
        });

        if (matches.length === 0) {
          logger.warn(`[TASK ${taskId}] No files found matching pattern: ${pattern} in ${workspacePath}`);
          continue;
        }

        logger.info(`[TASK ${taskId}] Found ${matches.length} files matching pattern: ${pattern}`);
        logger.debug(`[TASK ${taskId}] Matched files: ${matches.map(f => path.basename(f)).join(', ')}`);

        // Upload each matched file
        for (const filePath of matches) {
          try {
            const stats = await fs.promises.stat(filePath);
            const gcsPath = await this.uploadFile(taskId, filePath, gcsPrefix);

            results.push({
              originalPath: filePath,
              gcsPath,
              sizeBytes: stats.size
            });
          } catch (fileError: any) {
            logger.error(`[TASK ${taskId}] Failed to upload file ${filePath}:`, fileError.message);
            // Continue with other files even if one fails
          }
        }
      } catch (patternError: any) {
        logger.error(`[TASK ${taskId}] Failed to process glob pattern ${pattern}:`, patternError.message);
        // Continue with other patterns
      }
    }

    if (results.length > 0) {
      const totalBytes = results.reduce((sum, r) => sum + r.sizeBytes, 0);
      logger.info(`[TASK ${taskId}] ✓ Successfully uploaded ${results.length} files to GCS (total: ${(totalBytes / 1024).toFixed(2)} KB)`);
    } else {
      logger.warn(`[TASK ${taskId}] No files were uploaded - no matches found for any patterns`);
    }

    return results;
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
