import express from "express";
import bodyParser from "body-parser";
import { HealthController } from "./api/controllers/health.controller.js";
import { ClaudeController } from "./api/controllers/claude.controller.js";
import { logger } from "./utils/logger.js";

const app = express();
app.use(bodyParser.json({ limit: "2mb" }));

// Initialize controllers
const healthController = new HealthController();
const claudeController = new ClaudeController();

// Health routes
app.get("/", healthController.basicHealth.bind(healthController));
app.get("/health", healthController.healthCheck.bind(healthController));
app.get("/healthz", healthController.healthCheck.bind(healthController));

// Claude execution route
app.post("/run", claudeController.runClaude.bind(claudeController));


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
  concurrencyMode: 'single-request-only'
});

const server = app.listen(port as number, host, () => {
  logger.info(`Server listening on ${host}:${port}`);
  logger.info(`Concurrency: 1 request at a time (Cloud Run + TCP-level protection)`);
});

// TCP-level concurrency protection (defense in depth)
server.maxConnections = 1;