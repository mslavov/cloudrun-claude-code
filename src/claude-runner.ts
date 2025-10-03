import { spawn, ChildProcess } from "child_process";
import { exec } from "child_process";
import { promisify } from "util";
import { unlink, writeFile, access } from "fs/promises";
import { createWriteStream } from "fs";
import { constants } from "fs";
import path from "path";
import { logger } from "./utils/logger.js";

const execAsync = promisify(exec);

export type ClaudeOptions = {
  allowedTools?: string[];
  disallowedTools?: string[];
  maxTurns?: number;
  systemPrompt?: string;
  appendSystemPrompt?: string;
  claudeEnv?: Record<string, string>;
  fallbackModel?: string;
  model?: string;
  permissionMode?: string;
  timeoutMinutes?: number;
  dangerouslySkipPermissions?: boolean;
  debug?: boolean;
};

export type ClaudeRunResult = {
  exitCode: number;
  output: string;
  error?: string;
};

const BASE_ARGS = ["-p", "--verbose", "--output-format", "stream-json"];

export class ClaudeRunner {
  private process?: ChildProcess;
  private pipePath: string;
  private promptPath: string;

  constructor(private workspaceRoot: string) {
    this.pipePath = path.join(workspaceRoot, "claude_prompt_pipe");
    this.promptPath = path.join(workspaceRoot, "prompt.txt");
  }

  private async createNamedPipe(): Promise<void> {
    // Remove existing pipe if it exists
    try {
      await unlink(this.pipePath);
    } catch (e) {
      // Ignore if file doesn't exist
    }

    // Create the named pipe
    await execAsync(`mkfifo "${this.pipePath}"`);
  }

  private async buildArgs(options: ClaudeOptions): Promise<string[]> {
    const claudeArgs = [...BASE_ARGS];

    if (options.dangerouslySkipPermissions) {
      claudeArgs.push("--dangerously-skip-permissions");
    } else {
      if (options.allowedTools && options.allowedTools.length > 0) {
        claudeArgs.push("--allowedTools", options.allowedTools.join(","));
      }
      if (options.disallowedTools && options.disallowedTools.length > 0) {
        claudeArgs.push("--disallowedTools", options.disallowedTools.join(","));
      }
    }
    if (options.debug) {
      claudeArgs.push("--debug");
    }

    if (options.maxTurns) {
      claudeArgs.push("--max-turns", options.maxTurns.toString());
    }
    if (options.systemPrompt) {
      claudeArgs.push("--system-prompt", options.systemPrompt);
    }
    if (options.appendSystemPrompt) {
      claudeArgs.push("--append-system-prompt", options.appendSystemPrompt);
    }
    if (options.fallbackModel) {
      claudeArgs.push("--fallback-model", options.fallbackModel);
    }
    if (options.model) {
      claudeArgs.push("--model", options.model);
    }
    if (options.permissionMode) {
      claudeArgs.push("--permission-mode", options.permissionMode);
    }

    // Check if .mcp.json exists in the workspace
    // This allows repositories to define their own MCP servers
    const mcpConfigPath = path.join(this.workspaceRoot, ".mcp.json");
    try {
      await access(mcpConfigPath, constants.R_OK);
      claudeArgs.push("--mcp-config", ".mcp.json");
      logger.debug("✓ Found .mcp.json in workspace, loading MCP configuration");
    } catch {
      // .mcp.json doesn't exist or isn't readable - that's fine
      logger.debug("No .mcp.json found in workspace, skipping MCP configuration");
    }

    return claudeArgs;
  }

  async runWithPipe(
    prompt: string,
    options: ClaudeOptions,
    onData: (data: string) => void,
    onError: (error: string) => void
  ): Promise<ClaudeRunResult> {
    // Write prompt to file
    await writeFile(this.promptPath, prompt);

    // Create named pipe
    await this.createNamedPipe();

    const claudeArgs = await this.buildArgs(options);
    logger.debug("Starting Claude with args:", claudeArgs);

    // Build environment - SECURITY: Only pass explicitly defined variables
    // DO NOT spread process.env to prevent token leakage
    const claudeEnv = {
      ...options.claudeEnv, // User-controlled environment (includes proxy config)
      // Minimal required environment variables
      HOME: process.env.HOME || '/root',
      PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
      // Claude-specific flags
      CLAUDE_CODE_ACTION: '1',
      CLAUDE_CODE_ENTRYPOINT: 'cli',
      CLAUDECODE: '1',
    };

    // Start sending prompt to pipe in background
    const catProcess = spawn("cat", [this.promptPath], {
      stdio: ["ignore", "pipe", "inherit"],
    });
    const pipeStream = createWriteStream(this.pipePath);
    catProcess.stdout?.pipe(pipeStream);

    catProcess.on("error", (error) => {
      logger.error("Error reading prompt file:", error);
      pipeStream.destroy();
    });

    // Spawn Claude process (runs as same user - claudeuser)
    // Security isolation relies on:
    // 1. Cloud Run's gVisor/microVM layer
    // 2. File permissions (/app owned by serveruser, not readable by claudeuser)
    // 3. Ephemeral workspaces in /tmp
    this.process = spawn("claude", claudeArgs, {
      stdio: ["pipe", "pipe", "pipe"],
      env: claudeEnv,
      cwd: this.workspaceRoot,
    });

    // Handle process errors
    this.process.on("error", (error) => {
      logger.error("Error spawning Claude process:", error);
      pipeStream.destroy();
      onError(`Failed to start Claude CLI: ${error.message}`);
    });

    // Capture output
    let output = "";
    let errorOutput = "";

    this.process.stdout?.on("data", (data) => {
      const text = data.toString();
      output += text;

      // Process line by line for JSON streaming
      const lines = text.split("\n");
      lines.forEach((line: string) => {
        if (line.trim() === "") return;
        onData(line);
      });
    });

    this.process.stderr?.on("data", (data) => {
      errorOutput += data.toString();
      logger.error("Claude stderr:", data.toString());
    });

    // Pipe from named pipe to Claude
    const pipeProcess = spawn("cat", [this.pipePath]);
    pipeProcess.stdout?.pipe(this.process.stdin!);

    pipeProcess.on("error", (error) => {
      logger.error("Error reading from named pipe:", error);
      this.kill();
    });

    // Wait for completion with timeout
    const timeoutMs = (options.timeoutMinutes || 55) * 60 * 1000;

    return new Promise((resolve) => {
      let resolved = false;

      const timeoutId = setTimeout(() => {
        if (!resolved) {
          logger.error(`Claude process timed out after ${timeoutMs / 1000} seconds`);
          this.kill();
          resolved = true;
          resolve({
            exitCode: 124,
            output,
            error: "Process timed out"
          });
        }
      }, timeoutMs);

      this.process!.on("close", (code) => {
        if (!resolved) {
          clearTimeout(timeoutId);
          resolved = true;

          // Clean up processes
          try {
            catProcess.kill("SIGTERM");
            pipeProcess.kill("SIGTERM");
          } catch (e) {
            // Processes may already be dead
          }

          // Clean up pipe file
          unlink(this.pipePath).catch(() => { });

          resolve({
            exitCode: code || 0,
            output,
            error: errorOutput || undefined
          });
        }
      });

      this.process!.on("error", (error) => {
        if (!resolved) {
          clearTimeout(timeoutId);
          resolved = true;
          resolve({
            exitCode: 1,
            output,
            error: error.message
          });
        }
      });
    });
  }

  async runDirect(
    prompt: string,
    options: ClaudeOptions,
    onData: (data: string) => void,
    onError: (error: string) => void
  ): Promise<ClaudeRunResult> {
    const claudeArgs = await this.buildArgs(options);
    logger.debug("Starting Claude with args:", claudeArgs);

    // Build environment - SECURITY: Only pass explicitly defined variables
    // DO NOT spread process.env to prevent token leakage
    const claudeEnv = {
      ...options.claudeEnv, // User-controlled environment (includes proxy config)
      // Minimal required environment variables
      HOME: process.env.HOME || '/root',
      PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
      // Claude-specific flags
      CLAUDE_CODE_ACTION: '1',
      CLAUDE_CODE_ENTRYPOINT: 'cli',
      CLAUDECODE: '1',
    };

    // Spawn Claude process (runs as same user - claudeuser)
    // Security isolation relies on:
    // 1. Cloud Run's gVisor/microVM layer
    // 2. File permissions (/app owned by serveruser, not readable by claudeuser)
    // 3. Ephemeral workspaces in /tmp
    this.process = spawn("claude", claudeArgs, {
      stdio: ["pipe", "pipe", "pipe"],
      env: claudeEnv,
      cwd: this.workspaceRoot,
    });

    // Send prompt to stdin
    this.process.stdin?.write(prompt);
    this.process.stdin?.end();

    // Handle process errors
    this.process.on("error", (error) => {
      logger.error("Error spawning Claude process:", error);
      onError(`Failed to start Claude CLI: ${error.message}`);
    });

    // Capture output
    let output = "";
    let errorOutput = "";

    this.process.stdout?.on("data", (data) => {
      const text = data.toString();
      output += text;

      // Process line by line for JSON streaming
      const lines = text.split("\n");
      lines.forEach((line: string) => {
        if (line.trim() === "") return;
        onData(line);
      });
    });

    this.process.stderr?.on("data", (data) => {
      errorOutput += data.toString();
      logger.error("Claude stderr:", data.toString());
    });

    // Wait for completion with timeout
    const timeoutMs = (options.timeoutMinutes || 55) * 60 * 1000;

    return new Promise((resolve) => {
      let resolved = false;

      const timeoutId = setTimeout(() => {
        if (!resolved) {
          logger.error(`Claude process timed out after ${timeoutMs / 1000} seconds`);
          this.kill();
          resolved = true;
          resolve({
            exitCode: 124,
            output,
            error: "Process timed out"
          });
        }
      }, timeoutMs);

      this.process!.on("close", (code) => {
        if (!resolved) {
          clearTimeout(timeoutId);
          resolved = true;
          resolve({
            exitCode: code || 0,
            output,
            error: errorOutput || undefined
          });
        }
      });

      this.process!.on("error", (error) => {
        if (!resolved) {
          clearTimeout(timeoutId);
          resolved = true;
          resolve({
            exitCode: 1,
            output,
            error: error.message
          });
        }
      });
    });
  }

  kill(): void {
    if (this.process) {
      this.process.kill("SIGTERM");
      // Force kill after 5 seconds if it doesn't terminate
      setTimeout(() => {
        try {
          this.process?.kill("SIGKILL");
        } catch (e) {
          // Process may already be dead
        }
      }, 5000);
    }
  }
}