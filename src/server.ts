import express from "express";
import bodyParser from "body-parser";
import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import { spawn } from "child_process";
import simpleGit from "simple-git";
import { SecretManagerServiceClient } from "@google-cloud/secret-manager";
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

// Parse git repository URL to extract org and repo name
function parseGitRepo(gitRepo: string): { org: string; repo: string } | null {
  // Handle SSH format: git@github.com:org/repo.git
  // Handle HTTPS format: https://github.com/org/repo.git
  const patterns = [
    /git@[^:]+:([^/]+)\/([^/\.]+)(\.git)?$/,
    /https?:\/\/[^/]+\/([^/]+)\/([^/\.]+)(\.git)?$/
  ];
  
  for (const pattern of patterns) {
    const match = gitRepo.match(pattern);
    if (match) {
      return {
        org: match[1].toLowerCase(),
        repo: match[2].toLowerCase()
      };
    }
  }
  
  return null;
}

// Fetch environment secret dynamically based on repository
async function fetchEnvSecret(gitRepo: string, branch?: string): Promise<string | null> {
  const parsed = parseGitRepo(gitRepo);
  if (!parsed) {
    console.warn(`Could not parse repository URL: ${gitRepo}`);
    return null;
  }
  
  const { org, repo } = parsed;
  const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.PROJECT_ID;
  
  if (!projectId) {
    console.warn("PROJECT_ID not set, cannot fetch secrets");
    return null;
  }
  
  const client = new SecretManagerServiceClient();
  
  // Build list of secret names to try (most specific to least specific)
  const secretNames: string[] = [];
  if (branch && branch !== 'main' && branch !== 'master') {
    secretNames.push(`env-${org}-${repo}-${branch}`);
  }
  secretNames.push(`env-${org}-${repo}`);
  
  console.log(`Attempting to fetch environment secret for ${org}/${repo}${branch ? ` (${branch})` : ''}`);
  
  for (const secretName of secretNames) {
    try {
      const name = `projects/${projectId}/secrets/${secretName}/versions/latest`;
      console.log(`Trying secret: ${secretName}`);
      
      const [version] = await client.accessSecretVersion({ name });
      const payload = version.payload?.data;
      
      if (payload) {
        console.log(`✓ Successfully fetched secret: ${secretName}`);
        return payload.toString();
      }
    } catch (error: any) {
      // Secret doesn't exist or no access, try next one
      if (error.code !== 5) { // 5 = NOT_FOUND
        console.log(`Secret ${secretName} error: ${error.message}`);
      }
      continue;
    }
  }
  
  console.log(`No environment secrets found for ${org}/${repo}`);
  return null;
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
    useNamedPipe = true,  // Option to use named pipe method (like GitHub Action)
    gitRepo,
    gitBranch = "main",
    gitDepth = 1
  } = req.body || {};

  console.log("Request body:", {
    prompt: prompt?.substring(0, 50) + "...",
    maxTurns,
    allowedTools,
    hasSystemPrompt: !!systemPrompt,
    hasMcpConfig: !!mcpConfigJson,
    useNamedPipe,
    gitRepo,
    gitBranch
  });

  if (!prompt) {
    console.error("Missing prompt in request");
    res.status(400).json({ error: "prompt is required" });
    return;
  }

  const requestId = crypto.randomBytes(8).toString("hex");
  const workspaceRoot = path.join("/tmp", `ws-${requestId}`);
  
  // Clone git repository if specified
  if (gitRepo) {
    console.log(`Cloning repository: ${gitRepo} (branch: ${gitBranch}, depth: ${gitDepth})`);
    
    // Validate git repository URL (basic check for SSH format)
    if (!gitRepo.match(/^(git@|https?:\/\/)/)) {
      console.error("Invalid git repository URL format");
      res.status(400).json({ error: "Invalid git repository URL format. Use SSH (git@...) or HTTPS format." });
      return;
    }
    
    try {
      const git = simpleGit({
        baseDir: '/tmp',
        binary: 'git',
        maxConcurrentProcesses: 1,
        trimmed: false,
      });
      
      // Set timeout for git operations (30 seconds)
      const clonePromise = git.clone(gitRepo, workspaceRoot, [
        '--branch', gitBranch,
        '--depth', gitDepth.toString(),
        '--single-branch'
      ]);
      
      // Add timeout wrapper
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Git clone operation timed out after 30 seconds')), 30000);
      });
      
      await Promise.race([clonePromise, timeoutPromise]);
      console.log("✓ Repository cloned successfully");
    } catch (error: any) {
      console.error("Failed to clone repository:", error.message);
      
      // Provide more helpful error messages
      let errorMessage = error.message;
      if (error.message.includes('Could not read from remote repository')) {
        errorMessage = 'Authentication failed or repository not accessible. Ensure SSH key is properly configured.';
      } else if (error.message.includes('Repository not found')) {
        errorMessage = 'Repository not found. Check the repository URL and access permissions.';
      } else if (error.message.includes('timed out')) {
        errorMessage = 'Git clone operation timed out. Repository may be too large or network is slow.';
      }
      
      res.status(500).json({ error: `Failed to clone repository: ${errorMessage}` });
      
      // Clean up workspace if it was partially created
      try {
        await fs.rm(workspaceRoot, { recursive: true, force: true });
      } catch (cleanupError) {
        console.error("Failed to clean up workspace:", cleanupError);
      }
      
      return;
    }
  } else {
    await fs.mkdir(workspaceRoot, { recursive: true });
  }
  
  const cwd = path.join(workspaceRoot, cwdRelative);
  await fs.mkdir(cwd, { recursive: true });

  // Write MCP config if provided
  let mcpConfigPath: string | undefined;
  if (mcpConfigJson) {
    mcpConfigPath = path.join(workspaceRoot, "mcp.json");
    await fs.writeFile(mcpConfigPath, JSON.stringify(mcpConfigJson));
  }

  // Load environment secrets dynamically if gitRepo is provided
  let additionalEnv: Record<string, string> = {};
  if (gitRepo) {
    const envContent = await fetchEnvSecret(gitRepo, gitBranch);
    
    if (envContent) {
      // Write to workspace as .env file
      await fs.writeFile(path.join(workspaceRoot, '.env'), envContent);
      
      // Parse environment variables
      const lines = envContent.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          const [key, ...valueParts] = trimmed.split('=');
          if (key) {
            const value = valueParts.join('=').replace(/^["']|["']$/g, '');
            additionalEnv[key] = value;
          }
        }
      }
      console.log(`✓ Loaded ${Object.keys(additionalEnv).length} environment variables`);
    }
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
      ...additionalEnv
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