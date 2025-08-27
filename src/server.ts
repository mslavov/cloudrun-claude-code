import express from "express";
import bodyParser from "body-parser";
import { HealthController } from "./api/controllers/health.controller.js";
import { ClaudeController } from "./api/controllers/claude.controller.js";
import { SecretsController } from "./api/controllers/secrets.controller.js";

const app = express();
app.use(bodyParser.json({ limit: "2mb" }));

// Initialize controllers
const healthController = new HealthController();
const claudeController = new ClaudeController();
const secretsController = new SecretsController();

// Health routes
app.get("/", healthController.basicHealth.bind(healthController));
app.get("/health", healthController.healthCheck.bind(healthController));
app.get("/healthz", healthController.healthCheck.bind(healthController));

// Claude execution route
app.post("/run", claudeController.runClaude.bind(claudeController));

// Secret management routes
app.get("/api/secrets/list", secretsController.listSecrets.bind(secretsController));
app.get("/api/secrets/get", secretsController.getSecret.bind(secretsController));
app.post("/api/secrets/create", secretsController.createSecret.bind(secretsController));
app.put("/api/secrets/update", secretsController.updateSecret.bind(secretsController));
app.delete("/api/secrets/delete", secretsController.deleteSecret.bind(secretsController));

const port = process.env.PORT || 8080;
const host = '0.0.0.0'; // Explicitly bind to all interfaces

// Validate environment like the official action does
function validateEnvironment() {
  const hasApiKey = !!process.env.ANTHROPIC_API_KEY;
  const hasOAuthToken = !!process.env.CLAUDE_CODE_OAUTH_TOKEN;

  if (!hasApiKey && !hasOAuthToken) {
    console.warn("WARNING: Neither ANTHROPIC_API_KEY nor CLAUDE_CODE_OAUTH_TOKEN is set");
    console.warn("Authentication may fail. Please set one of these environment variables.");
  }

  if (hasOAuthToken) {
    console.log("Using OAuth token for authentication");
  } else if (hasApiKey) {
    console.log("Using API key for authentication");
  }
}

validateEnvironment();

console.log("Starting server with environment:", {
  NODE_ENV: process.env.NODE_ENV,
  PORT: port,
  hasAnthropicApiKey: !!process.env.ANTHROPIC_API_KEY,
  hasAnthropicAuthToken: !!process.env.CLAUDE_CODE_OAUTH_TOKEN,
  permissionMode: process.env.PERMISSION_MODE
});

app.listen(port as number, host, () => console.log(`Server listening on ${host}:${port}`));