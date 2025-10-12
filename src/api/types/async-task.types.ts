import { RunRequest } from "./request.types.js";

/**
 * Request type for async Claude Code execution
 * Extends RunRequest with callback URL and optional task ID
 */
export interface AsyncRunRequest extends RunRequest {
  /**
   * Callback URL to POST results when task completes
   * Will receive AsyncTaskResult payload
   */
  callbackUrl: string;

  /**
   * Optional task ID - will be auto-generated if not provided
   * Must be unique and URL-safe
   */
  taskId?: string;
}

/**
 * Response returned immediately from /run-async endpoint
 */
export interface AsyncRunResponse {
  /** Unique identifier for the task */
  taskId: string;

  /** Initial status (always 'pending' on creation) */
  status: 'pending';

  /** GCS path where logs will be stored */
  logsPath: string;

  /** Timestamp when task was created */
  createdAt: string;
}

/**
 * Status of an async task
 */
export type AsyncTaskStatus = 'pending' | 'running' | 'completed' | 'failed';

/**
 * Result posted to callback URL when task completes
 */
export interface AsyncTaskResult {
  /** Task identifier */
  taskId: string;

  /** Final status */
  status: 'completed' | 'failed';

  /** Exit code from Claude process */
  exitCode: number;

  /** GCS path to session logs */
  logsPath: string;

  /** Summary metrics */
  summary: {
    /** Task duration in milliseconds */
    durationMs: number;

    /** Number of conversation turns */
    turns?: number;

    /** Number of errors encountered */
    errors?: number;

    /** Start timestamp */
    startedAt: string;

    /** Completion timestamp */
    completedAt: string;
  };

  /** Error message if task failed */
  error?: string;

  /** User-provided metadata from original request */
  metadata?: Record<string, any>;
}

/**
 * Metadata stored alongside task logs in GCS
 */
export interface AsyncTaskMetadata {
  taskId: string;
  status: AsyncTaskStatus;
  callbackUrl: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  metadata?: Record<string, any>;
}
