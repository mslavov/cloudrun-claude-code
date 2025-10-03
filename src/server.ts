import express from "express";
import bodyParser from "body-parser";
import { execSync } from "child_process";
import fs from "fs";
import { HealthController } from "./api/controllers/health.controller.js";
import { ClaudeController } from "./api/controllers/claude.controller.js";

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

// SECURITY: Service no longer uses global tokens
// Users must provide anthropicApiKey in each request payload
function validateEnvironment() {
  console.log("Security mode: User-provided API keys via request payload");
  console.log("Service-level ANTHROPIC_API_KEY/CLAUDE_CODE_OAUTH_TOKEN are not used");
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
  permissionMode: process.env.PERMISSION_MODE,
  concurrencyMode: 'single-request-only'
});

const server = app.listen(port as number, host, () => {
  console.log(`Server listening on ${host}:${port}`);
  console.log(`Concurrency: 1 request at a time (Cloud Run + TCP-level protection)`);
});

// TCP-level concurrency protection (defense in depth)
server.maxConnections = 1;