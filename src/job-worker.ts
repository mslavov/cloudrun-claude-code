#!/usr/bin/env node
/**
 * Cloud Run Job Worker
 * Executes a single async Claude Code task and exits
 *
 * This worker is the entrypoint for Cloud Run Jobs.
 * It reads an encrypted task payload from GCS, decrypts it using KMS,
 * executes the task, and sends results via webhook.
 *
 * Environment variables:
 * - TASK_ID: Unique task identifier
 * - ENCRYPTED_PAYLOAD_PATH: GCS path to encrypted payload
 */

import { TaskService } from './api/services/task.service.js';
import { GCSOutputHandler } from './api/services/output-handlers.js';
import { GCSLoggerService } from './api/services/gcs-logger.service.js';
import { EncryptionService } from './api/services/encryption.service.js';
import { logger } from './utils/logger.js';

async function main() {
  const taskId = process.env.TASK_ID;
  const encryptedPayloadPath = process.env.ENCRYPTED_PAYLOAD_PATH;

  // Validate required environment variables
  if (!taskId || !encryptedPayloadPath) {
    logger.error('Missing required environment variables');
    logger.error('Required: TASK_ID, ENCRYPTED_PAYLOAD_PATH');
    logger.error('Provided:', {
      TASK_ID: taskId ? 'present' : 'missing',
      ENCRYPTED_PAYLOAD_PATH: encryptedPayloadPath ? 'present' : 'missing'
    });
    process.exit(1);
  }

  logger.info(`[TASK ${taskId}] Job worker started`);
  logger.info(`[TASK ${taskId}] Encrypted payload path: ${encryptedPayloadPath}`);

  // Initialize services
  const gcsLogger = new GCSLoggerService();
  const encryptionService = new EncryptionService();
  const taskService = new TaskService();

  try {
    // 1. Read encrypted payload from GCS
    logger.info(`[TASK ${taskId}] Reading encrypted payload from GCS`);
    const encryptedData = await gcsLogger.readEncryptedPayload(taskId);
    logger.debug(`[TASK ${taskId}] Encrypted payload read (${encryptedData.length} bytes)`);

    // 2. Decrypt payload using KMS
    logger.info(`[TASK ${taskId}] Decrypting payload with Cloud KMS`);
    const payload = await encryptionService.decryptPayload(encryptedData);
    logger.info(`[TASK ${taskId}] Payload decrypted successfully`);

    // 3. Extract callback URL from decrypted payload
    const callbackUrl = payload.callbackUrl;
    if (!callbackUrl) {
      throw new Error('Decrypted payload missing callbackUrl');
    }
    logger.debug(`[TASK ${taskId}] Callback URL: ${callbackUrl}`);

    // 4. Create output handler (will stream to GCS and call webhook on completion)
    logger.info(`[TASK ${taskId}] Creating GCS output handler`);
    const outputHandler = new GCSOutputHandler(
      taskId,
      callbackUrl,
      gcsLogger,
      payload.metadata
    );

    // 5. Execute task with decrypted payload
    logger.info(`[TASK ${taskId}] Starting task execution`);
    await taskService.executeTask(payload, outputHandler, taskId);

    // 6. Cleanup: Delete encrypted payload from GCS
    // This ensures we don't accumulate sensitive data in storage
    logger.info(`[TASK ${taskId}] Cleaning up encrypted payload`);
    try {
      await gcsLogger.deleteEncryptedPayload(taskId);
      logger.info(`[TASK ${taskId}] Encrypted payload deleted`);
    } catch (cleanupError: any) {
      // Log but don't fail - lifecycle policy will clean up eventually
      logger.warn(`[TASK ${taskId}] Failed to delete encrypted payload:`, cleanupError.message);
    }

    logger.info(`[TASK ${taskId}] Job completed successfully`);
    process.exit(0);

  } catch (error: any) {
    logger.error(`[TASK ${taskId}] Job failed:`, error.message);
    logger.error(`[TASK ${taskId}] Stack trace:`, error.stack);

    // Try to delete encrypted payload even on failure
    try {
      logger.info(`[TASK ${taskId}] Attempting to cleanup encrypted payload after failure`);
      await gcsLogger.deleteEncryptedPayload(taskId);
      logger.info(`[TASK ${taskId}] Encrypted payload deleted (failure cleanup)`);
    } catch (cleanupError: any) {
      logger.error(`[TASK ${taskId}] Failed to cleanup encrypted payload:`, cleanupError.message);
    }

    // Exit with error code
    process.exit(1);
  }
}

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception in job worker:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled rejection in job worker:', reason);
  process.exit(1);
});

// Run main function
main();
