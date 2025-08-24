import express from "express";
import bodyParser from "body-parser";
import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import { spawn } from "child_process";
import { ClaudeRunner, ClaudeOptions } from "./claude-runner.js";

const app = express();
app.use(bodyParser.json({ limit: "2mb" }));

app.get("/", (_, res) => res.status(200).send("Claude Code Agent is running"));

// Unified health check endpoint
app.get(["/health", "/healthz"], async (req, res) => {
  const verbose = req.query.verbose === 'true';

  if (!verbose) {
    // Simple health check for basic monitoring
    res.status(200).send("ok");
    return;
  }

  // Verbose health check with configuration details
  const healthStatus: any = {
    status: "healthy",
    server: "running",
    auth: {
      hasApiKey: !!process.env.ANTHROPIC_API_KEY,
      hasAuthToken: !!process.env.CLAUDE_CODE_OAUTH_TOKEN,
      tokenLength: process.env.CLAUDE_CODE_OAUTH_TOKEN?.length || 0
    },
    claude: {
      cliAvailable: await checkClaudeCLI()
    }
  };

  res.status(200).json(healthStatus);
});

// Check if Claude CLI is available
async function checkClaudeCLI(): Promise<boolean> {
  return new Promise((resolve) => {
    const checkProcess = spawn("claude", ["--version"], {
      stdio: ["ignore", "pipe", "ignore"],
      env: {
        ...process.env,
        CLAUDE_CODE_OAUTH_TOKEN: process.env.CLAUDE_CODE_OAUTH_TOKEN,
      }
    });

    checkProcess.on("error", () => resolve(false));
    checkProcess.on("exit", (code) => resolve(code === 0));
  });
}


app.post("/run", async (req, res) => {
  console.log("POST /run - Request received");
  const {
    prompt,
    systemPrompt,
    allowedTools,
    permissionMode,
    mcpConfigJson,
    maxTurns = 6,
    cwdRelative = ".",
    useNamedPipe = true  // Option to use named pipe method (like GitHub Action)
  } = req.body || {};

  console.log("Request body:", {
    prompt: prompt?.substring(0, 50) + "...",
    maxTurns,
    allowedTools,
    hasSystemPrompt: !!systemPrompt,
    hasMcpConfig: !!mcpConfigJson,
    useNamedPipe
  });

  if (!prompt) {
    console.error("Missing prompt in request");
    res.status(400).json({ error: "prompt is required" });
    return;
  }

  const requestId = crypto.randomBytes(8).toString("hex");
  const workspaceRoot = path.join("/tmp", `ws-${requestId}`);
  await fs.mkdir(workspaceRoot, { recursive: true });
  const cwd = path.join(workspaceRoot, cwdRelative);
  await fs.mkdir(cwd, { recursive: true });

  // Write MCP config if provided
  let mcpConfigPath: string | undefined;
  if (mcpConfigJson) {
    mcpConfigPath = path.join(workspaceRoot, "mcp.json");
    await fs.writeFile(mcpConfigPath, JSON.stringify(mcpConfigJson));
  }

  // Build options for Claude runner
  const options: ClaudeOptions = {
    allowedTools: allowedTools,
    maxTurns: maxTurns,
    systemPrompt: systemPrompt,
    permissionMode: permissionMode,
    mcpConfig: mcpConfigPath,
    timeoutMinutes: 10,
    claudeEnv: {
      // Pass any additional environment variables
      CLAUDE_CODE_OAUTH_TOKEN: process.env.CLAUDE_CODE_OAUTH_TOKEN || "",
    }
  };

  console.log("Setting up SSE headers");
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  console.log("Auth check:", {
    hasApiKey: !!process.env.ANTHROPIC_API_KEY,
    hasAuthToken: !!process.env.CLAUDE_CODE_OAUTH_TOKEN,
    tokenLength: process.env.CLAUDE_CODE_OAUTH_TOKEN?.length || 0
  });

  const runner = new ClaudeRunner(workspaceRoot);
  let connectionClosed = false;

  // Handle client disconnect
  req.on("close", () => {
    console.log("Client disconnected, killing Claude process");
    connectionClosed = true;
    runner.kill();
  });

  try {
    console.log(`Starting Claude CLI (${useNamedPipe ? 'with named pipe' : 'direct stdin'})`);

    // Data handler for streaming
    const onData = (line: string) => {
      if (connectionClosed) return;

      try {
        // Try to parse as JSON
        const message = JSON.parse(line);
        res.write(`data: ${JSON.stringify(message)}\n\n`);
        (res as any).flush?.();
      } catch (e) {
        // If not JSON, send as text
        if (line.trim()) {
          res.write(`data: ${JSON.stringify({ type: "text", content: line })}\n\n`);
          (res as any).flush?.();
        }
      }
    };

    // Error handler
    const onError = (error: string) => {
      if (connectionClosed) return;

      res.write(`event: error\ndata: ${JSON.stringify({ error })}\n\n`);
      (res as any).flush?.();
    };

    // Run Claude with appropriate method
    const result = useNamedPipe
      ? await runner.runWithPipe(prompt, options, onData, onError)
      : await runner.runDirect(prompt, options, onData, onError);

    console.log(`Claude process completed with exit code: ${result.exitCode}`);

    if (result.exitCode !== 0) {
      res.write(`event: error\ndata: ${JSON.stringify({
        error: `Claude process exited with code ${result.exitCode}`,
        stderr: result.error
      })}\n\n`);
    }

    res.end();

  } catch (err: any) {
    console.error("Error:", err.message, err.stack);
    if (!connectionClosed) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`);
      res.end();
    }
  } finally {
    // Clean up workspace after a delay
    setTimeout(() => {
      fs.rm(workspaceRoot, { recursive: true, force: true }).catch(() => { });
    }, 5000);
  }
});

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