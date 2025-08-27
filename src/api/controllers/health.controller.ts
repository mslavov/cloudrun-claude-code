import { Request, Response } from "express";
import { spawn } from "child_process";

export class HealthController {
  // Check if Claude CLI is available
  private async checkClaudeCLI(): Promise<boolean> {
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

  // Basic health check
  async basicHealth(req: Request, res: Response): Promise<void> {
    res.status(200).send("Claude Code Agent is running");
  }

  // Health check endpoint - unified for /health and /healthz
  async healthCheck(req: Request, res: Response): Promise<void> {
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
        cliAvailable: await this.checkClaudeCLI()
      }
    };

    res.status(200).json(healthStatus);
  }
}