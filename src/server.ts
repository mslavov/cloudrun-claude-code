import express from "express";
import bodyParser from "body-parser";
import { HealthController } from "./api/controllers/health.controller.js";
import { ClaudeController } from "./api/controllers/claude.controller.js";
import { AsyncClaudeController } from "./api/controllers/async-claude.controller.js";
import { CancelController } from "./api/controllers/cancel.controller.js";
import { concurrencyControlMiddleware } from "./api/middleware/concurrency.middleware.js";
import { logger } from "./utils/logger.js";

const app = express();
app.use(bodyParser.json({ limit: "2mb" }));

// Apply concurrency control middleware before route handlers
app.use(concurrencyControlMiddleware);

// Initialize controllers
const healthController = new HealthController();
const claudeController = new ClaudeController();
const asyncClaudeController = new AsyncClaudeController();
const cancelController = new CancelController();

// Health routes
app.get("/", healthController.basicHealth.bind(healthController));
app.get("/health", healthController.healthCheck.bind(healthController));
app.get("/healthz", healthController.healthCheck.bind(healthController));

// Claude execution routes
app.post("/run", claudeController.runClaude.bind(claudeController));
app.post("/run-async", asyncClaudeController.runAsync.bind(asyncClaudeController));

// Task management routes
app.post("/cancel/:taskId", cancelController.cancelTask.bind(cancelController));
app.get("/tasks/status", cancelController.getTasksStatus.bind(cancelController));


const port = process.env.PORT || 8080;
const host = '0.0.0.0'; // Explicitly bind to all interfaces

// SECURITY: Payload-based authentication and SSH keys
function validateEnvironment() {
  logger.info("Security mode: Payload-based authentication");
  logger.info("  - API keys/OAuth tokens: Passed in request payload");
  logger.info("  - SSH keys: Passed in request payload (per-request isolation)");
  logger.info("  - Service-level secrets: Not used for authentication or SSH");
}

validateEnvironment();

logger.info("Starting server with environment:", {
  NODE_ENV: process.env.NODE_ENV,
  PORT: port,
  permissionMode: process.env.PERMISSION_MODE,
  maxConcurrentTasks: process.env.MAX_CONCURRENT_TASKS || '1'
});

app.listen(port as number, host, () => {
  logger.info(`Server listening on ${host}:${port}`);
  logger.info(`Concurrency: Application-level enforcement (max ${process.env.MAX_CONCURRENT_TASKS || '1'} task at a time)`);
  logger.info(`Endpoints: /run, /run-async, /cancel/:taskId, /tasks/status, /health`);
});