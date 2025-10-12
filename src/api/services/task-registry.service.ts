import { ClaudeRunner } from "../../claude-runner.js";
import { logger } from "../../utils/logger.js";

/**
 * Task information stored in the registry
 */
export interface TaskInfo {
  /** Task identifier */
  taskId: string;

  /** Claude runner instance */
  runner: ClaudeRunner;

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
 * Singleton service for tracking active Claude Code tasks.
 * Provides:
 * - Concurrency control (enforce max concurrent tasks)
 * - Task cancellation capability
 * - Active task tracking
 *
 * Thread-safe for concurrent access.
 */
export class TaskRegistry {
  private static instance: TaskRegistry;
  private tasks: Map<string, TaskInfo>;
  private readonly maxConcurrentTasks: number;

  private constructor() {
    this.tasks = new Map();
    // Security requirement: only 1 task at a time
    this.maxConcurrentTasks = parseInt(process.env.MAX_CONCURRENT_TASKS || '1', 10);
    logger.info(`TaskRegistry initialized with max concurrent tasks: ${this.maxConcurrentTasks}`);
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
   * @throws Error if max concurrent tasks reached
   */
  public register(taskId: string, runner: ClaudeRunner, type: 'sync' | 'async'): void {
    if (this.tasks.size >= this.maxConcurrentTasks) {
      const activeTasks = Array.from(this.tasks.keys());
      logger.warn(`Task registration failed: max concurrent tasks (${this.maxConcurrentTasks}) reached`, {
        requestedTaskId: taskId,
        activeTasks
      });
      throw new Error(`Maximum concurrent tasks (${this.maxConcurrentTasks}) reached. Active tasks: ${activeTasks.join(', ')}`);
    }

    if (this.tasks.has(taskId)) {
      logger.error(`Task registration failed: duplicate task ID`, { taskId });
      throw new Error(`Task ${taskId} is already registered`);
    }

    const taskInfo: TaskInfo = {
      taskId,
      runner,
      type,
      startedAt: new Date(),
      cancelling: false
    };

    this.tasks.set(taskId, taskInfo);
    logger.info(`Task registered: ${taskId} (type: ${type}, active: ${this.tasks.size}/${this.maxConcurrentTasks})`);
  }

  /**
   * Unregister a task (called when task completes/fails/cancels)
   */
  public unregister(taskId: string): void {
    const removed = this.tasks.delete(taskId);
    if (removed) {
      logger.info(`Task unregistered: ${taskId} (active: ${this.tasks.size}/${this.maxConcurrentTasks})`);
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
   * Check if registry is at capacity
   */
  public isAtCapacity(): boolean {
    return this.tasks.size >= this.maxConcurrentTasks;
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
    logger.info(`Cancelling task: ${taskId}`);

    try {
      // Kill the Claude process
      taskInfo.runner.kill();
      logger.info(`Task cancelled successfully: ${taskId}`);
      return true;
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
    max: number;
    tasks: Array<{ taskId: string; type: string; startedAt: string; cancelling: boolean }>;
  } {
    return {
      active: this.tasks.size,
      max: this.maxConcurrentTasks,
      tasks: Array.from(this.tasks.values()).map(t => ({
        taskId: t.taskId,
        type: t.type,
        startedAt: t.startedAt.toISOString(),
        cancelling: t.cancelling
      }))
    };
  }
}
