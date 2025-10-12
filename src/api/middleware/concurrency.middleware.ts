import { Request, Response, NextFunction } from "express";
import { TaskRegistry } from "../services/task-registry.service.js";
import { logger } from "../../utils/logger.js";

/**
 * Concurrency Control Middleware
 *
 * Enforces maximum concurrent task limit before accepting /run or /run-async requests.
 * Returns 503 Service Unavailable with Retry-After header when at capacity.
 *
 * Health check endpoints are always allowed to pass through.
 */
export function concurrencyControlMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Allow health checks to always pass through
  const healthCheckPaths = ['/', '/health', '/healthz'];
  if (healthCheckPaths.includes(req.path)) {
    return next();
  }

  // Only apply to task execution endpoints
  const taskEndpoints = ['/run', '/run-async'];
  if (!taskEndpoints.includes(req.path)) {
    return next();
  }

  // Check capacity
  const registry = TaskRegistry.getInstance();

  if (registry.isAtCapacity()) {
    const activeTasks = registry.getActiveTaskIds();
    const stats = registry.getStats();

    logger.warn(`Request rejected: server at capacity (${stats.active}/${stats.max} tasks active)`, {
      path: req.path,
      method: req.method,
      activeTasks
    });

    // Return 503 with Retry-After header
    res.status(503).json({
      error: 'Server busy processing another task',
      message: `Maximum concurrent tasks (${stats.max}) reached. Please retry later.`,
      retryAfter: 60, // seconds
      activeTasks: stats.active
    });

    res.setHeader('Retry-After', '60');
    return;
  }

  // Capacity available, proceed
  next();
}
