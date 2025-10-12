import { Request, Response } from "express";
import { TaskRegistry } from "../services/task-registry.service.js";
import { logger } from "../../utils/logger.js";

/**
 * Cancel Controller
 * Handles task cancellation requests
 */
export class CancelController {
  private registry: TaskRegistry;

  constructor() {
    this.registry = TaskRegistry.getInstance();
  }

  /**
   * POST /cancel/:taskId
   * Cancel a running async task
   *
   * Returns:
   * - 200: Task cancelled successfully
   * - 404: Task not found (not running or doesn't exist)
   * - 400: Invalid task ID
   * - 500: Internal error
   */
  async cancelTask(req: Request, res: Response): Promise<void> {
    const { taskId } = req.params;

    if (!taskId) {
      logger.warn('Cancel request missing taskId parameter');
      res.status(400).json({
        error: 'taskId parameter is required'
      });
      return;
    }

    // Validate task ID format (URL-safe characters only)
    if (!/^[a-zA-Z0-9_-]+$/.test(taskId)) {
      logger.warn(`Cancel request with invalid taskId format: ${taskId}`);
      res.status(400).json({
        error: 'Invalid taskId format. Must be alphanumeric with underscores and hyphens only.'
      });
      return;
    }

    try {
      logger.info(`Cancellation requested for task: ${taskId}`);

      // Check if task exists in registry
      const taskInfo = this.registry.getTask(taskId);

      if (!taskInfo) {
        logger.warn(`Task not found or already completed: ${taskId}`);
        res.status(404).json({
          error: 'Task not found',
          message: `Task ${taskId} is not currently running or has already completed`,
          taskId
        });
        return;
      }

      // Check if already cancelling
      if (taskInfo.cancelling) {
        logger.info(`Task already being cancelled: ${taskId}`);
        res.status(200).json({
          message: 'Task is already being cancelled',
          taskId,
          status: 'cancelling'
        });
        return;
      }

      // Cancel the task
      const cancelled = await this.registry.cancelTask(taskId);

      if (cancelled) {
        logger.info(`Task cancelled successfully: ${taskId}`);
        res.status(200).json({
          message: 'Task cancelled successfully',
          taskId,
          status: 'cancelled'
        });
      } else {
        logger.error(`Failed to cancel task: ${taskId}`);
        res.status(500).json({
          error: 'Failed to cancel task',
          message: 'Task cancellation initiated but encountered an error',
          taskId
        });
      }
    } catch (error: any) {
      logger.error(`Error cancelling task ${taskId}:`, error.message, error.stack);
      res.status(500).json({
        error: 'Internal server error',
        message: error.message,
        taskId
      });
    }
  }

  /**
   * GET /tasks/status
   * Get status of all active tasks (for debugging/monitoring)
   */
  async getTasksStatus(req: Request, res: Response): Promise<void> {
    try {
      const stats = this.registry.getStats();
      logger.debug('Task status requested', stats);

      res.status(200).json(stats);
    } catch (error: any) {
      logger.error('Error getting task status:', error.message);
      res.status(500).json({
        error: 'Internal server error',
        message: error.message
      });
    }
  }
}
