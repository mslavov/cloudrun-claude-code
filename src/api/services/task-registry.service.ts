import { logger } from "../../utils/logger.js";
import { JobTriggerService } from "./job-trigger.service.js";

/**
 * Task information stored in the registry
 */
export interface TaskInfo {
  /** Task identifier */
  taskId: string;

  /** Cloud Run Job execution name */
  executionName: string;

  /** Task type (sync or async) */
  type: 'sync' | 'async';

  /** When task was started */
  startedAt: Date;

  /** Task is being cancelled */
  cancelling: boolean;
}

/**
 * TaskRegistry Service
 *
 * Singleton service for tracking active Cloud Run Job executions.
 * Provides:
 * - Task cancellation capability
 * - Active task tracking
 * - Job execution status monitoring
 *
 * Thread-safe for concurrent access.
 */
export class TaskRegistry {
  private static instance: TaskRegistry;
  private tasks: Map<string, TaskInfo>;
  private jobTrigger: JobTriggerService;

  private constructor() {
    this.tasks = new Map();
    this.jobTrigger = new JobTriggerService();
    logger.info(`TaskRegistry initialized (job-based execution mode)`);
  }

  /**
   * Get singleton instance
   */
  public static getInstance(): TaskRegistry {
    if (!TaskRegistry.instance) {
      TaskRegistry.instance = new TaskRegistry();
    }
    return TaskRegistry.instance;
  }

  /**
   * Register a new task
   * @throws Error if duplicate task ID
   */
  public register(taskId: string, executionName: string, type: 'sync' | 'async'): void {
    if (this.tasks.has(taskId)) {
      logger.error(`Task registration failed: duplicate task ID`, { taskId });
      throw new Error(`Task ${taskId} is already registered`);
    }

    const taskInfo: TaskInfo = {
      taskId,
      executionName,
      type,
      startedAt: new Date(),
      cancelling: false
    };

    this.tasks.set(taskId, taskInfo);
    logger.info(`Task registered: ${taskId} (type: ${type}, execution: ${executionName}, active: ${this.tasks.size})`);
  }

  /**
   * Unregister a task (called when task completes/fails/cancels)
   */
  public unregister(taskId: string): void {
    const removed = this.tasks.delete(taskId);
    if (removed) {
      logger.info(`Task unregistered: ${taskId} (active: ${this.tasks.size})`);
    } else {
      logger.warn(`Task unregister failed: task not found`, { taskId });
    }
  }

  /**
   * Get number of active tasks
   */
  public getActiveCount(): number {
    return this.tasks.size;
  }

  /**
   * Get list of active task IDs
   */
  public getActiveTaskIds(): string[] {
    return Array.from(this.tasks.keys());
  }

  /**
   * Get task info by ID
   */
  public getTask(taskId: string): TaskInfo | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * Cancel a task by ID
   * @returns true if task was found and cancelled, false if not found or already completing
   */
  public async cancelTask(taskId: string): Promise<boolean> {
    const taskInfo = this.tasks.get(taskId);

    if (!taskInfo) {
      logger.warn(`Cancel failed: task not found`, { taskId });
      return false;
    }

    if (taskInfo.cancelling) {
      logger.warn(`Cancel failed: task already being cancelled`, { taskId });
      return false;
    }

    // Mark as cancelling
    taskInfo.cancelling = true;
    logger.info(`Cancelling task: ${taskId} (execution: ${taskInfo.executionName})`);

    try {
      // Cancel the Cloud Run Job execution
      const cancelled = await this.jobTrigger.cancelJobExecution(taskInfo.executionName);

      if (cancelled) {
        logger.info(`Task cancelled successfully: ${taskId}`);
        return true;
      } else {
        logger.warn(`Failed to cancel job execution for task ${taskId} (may have already completed)`);
        return false;
      }
    } catch (error: any) {
      logger.error(`Error cancelling task ${taskId}:`, error.message);
      return false;
    }
  }

  /**
   * Check if a task is being cancelled
   */
  public isCancelling(taskId: string): boolean {
    const taskInfo = this.tasks.get(taskId);
    return taskInfo?.cancelling || false;
  }

  /**
   * Get registry statistics
   */
  public getStats(): {
    active: number;
    tasks: Array<{ taskId: string; type: string; executionName: string; startedAt: string; cancelling: boolean }>;
  } {
    return {
      active: this.tasks.size,
      tasks: Array.from(this.tasks.values()).map(t => ({
        taskId: t.taskId,
        type: t.type,
        executionName: t.executionName,
        startedAt: t.startedAt.toISOString(),
        cancelling: t.cancelling
      }))
    };
  }
}
