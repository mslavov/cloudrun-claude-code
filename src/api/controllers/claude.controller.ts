import { Request, Response } from "express";
import { TaskService } from "../services/task.service.js";
import { SSEOutputHandler } from "../services/output-handlers.js";
import { RunRequest } from "../types/request.types.js";
import { logger } from "../../utils/logger.js";

/**
 * Claude Controller
 * Handles synchronous Claude Code execution with Server-Sent Events (SSE) streaming
 */
export class ClaudeController {
  private taskService: TaskService;

  constructor() {
    this.taskService = new TaskService();
  }

  async runClaude(req: Request<{}, {}, RunRequest>, res: Response): Promise<void> {
    logger.debug("POST /run - Request received");

    const {
      prompt,
      anthropicApiKey,
      anthropicOAuthToken,
      maxTurns = 6,
      allowedTools,
      systemPrompt,
      useNamedPipe = true,
      gitRepo,
      gitBranch = "main",
      environmentSecrets = {},
      sshKey,
      metadata
    } = req.body || {};

    logger.debug("Request body:", {
      prompt: prompt?.substring(0, 50) + "...",
      maxTurns,
      allowedTools,
      hasSystemPrompt: !!systemPrompt,
      useNamedPipe,
      gitRepo,
      gitBranch,
      hasEnvironmentSecrets: Object.keys(environmentSecrets).length > 0,
      hasSshKey: !!sshKey,
      hasMetadata: !!metadata,
      hasAnthropicApiKey: !!anthropicApiKey,
      hasAnthropicOAuthToken: !!anthropicOAuthToken
    });

    // Validate required fields
    if (!prompt) {
      logger.error("Missing prompt in request");
      res.status(400).json({ error: "prompt is required" });
      return;
    }

    if (!anthropicApiKey && !anthropicOAuthToken) {
      logger.error("Missing authentication - need either anthropicApiKey or anthropicOAuthToken");
      res.status(400).json({
        error: "Either anthropicApiKey or anthropicOAuthToken is required"
      });
      return;
    }

    try {
      // Set up SSE headers
      logger.debug("Setting up SSE headers");
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      // Create SSE output handler
      const outputHandler = new SSEOutputHandler(res, req);

      // Handle client disconnect
      req.on("close", () => {
        logger.debug("Client disconnected");
      });

      logger.debug(`Starting Claude CLI (${useNamedPipe ? 'with named pipe' : 'direct stdin'})`);

      // Execute task with SSE output handler
      await this.taskService.executeTask(req.body, outputHandler);

    } catch (err: any) {
      logger.error("Error:", err.message, err.stack);

      // If headers not sent yet, send error response
      if (!res.headersSent) {
        res.status(500).json({ error: err.message });
      } else {
        res.write(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`);
        res.end();
      }
    }
  }
}
