import express from "express";
import bodyParser from "body-parser";
import { execSync } from "child_process";
import fs from "fs";
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

// RESTful Secret management routes (new)
app.get("/api/secrets", secretsController.list.bind(secretsController));
app.get("/api/secrets/:id", secretsController.get.bind(secretsController));
app.post("/api/secrets", secretsController.create.bind(secretsController));
app.put("/api/secrets/:id", secretsController.update.bind(secretsController));
app.delete("/api/secrets/:id", secretsController.delete.bind(secretsController));

// Legacy Secret management routes (backward compatibility - not documented)
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

// Setup global SSH key if mounted (optional - per-repository keys are preferred)
function fixSshKeyPermissions() {
  const mountedKeyPath = "/home/appuser/.ssh/id_rsa";
  const writableKeyPath = "/tmp/ssh_key";

  try {
    if (fs.existsSync(mountedKeyPath)) {
      console.log(`Found global SSH key mounted at ${mountedKeyPath}`);

      // Copy the key to a writable location
      const keyContent = fs.readFileSync(mountedKeyPath, 'utf8');
      fs.writeFileSync(writableKeyPath, keyContent, { mode: 0o600 });
      console.log(`✓ Global SSH key copied to ${writableKeyPath} with correct permissions`);

      // Update Git SSH command to use the writable key
      execSync(`git config --global core.sshCommand "ssh -i ${writableKeyPath} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null"`, { stdio: 'pipe' });
      console.log("✓ Git configured to use global SSH key");
    } else {
      console.log("ℹ No global SSH key mounted - using per-repository SSH keys");
    }
  } catch (error) {
    console.error("Warning: Could not setup global SSH key:", error);
  }
}

validateEnvironment();
fixSshKeyPermissions();

console.log("Starting server with environment:", {
  NODE_ENV: process.env.NODE_ENV,
  PORT: port,
  hasAnthropicApiKey: !!process.env.ANTHROPIC_API_KEY,
  hasAnthropicAuthToken: !!process.env.CLAUDE_CODE_OAUTH_TOKEN,
  permissionMode: process.env.PERMISSION_MODE
});

app.listen(port as number, host, () => console.log(`Server listening on ${host}:${port}`));