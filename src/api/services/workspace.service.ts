import fs from "fs/promises";
import path from "path";
import crypto from "crypto";

export class WorkspaceService {
  // Create a new workspace directory
  async createWorkspace(baseDir: string = "/tmp"): Promise<string> {
    const requestId = crypto.randomBytes(8).toString("hex");
    const workspaceRoot = path.join(baseDir, `ws-${requestId}`);
    await fs.mkdir(workspaceRoot, { recursive: true });
    return workspaceRoot;
  }

  // Create a subdirectory within workspace
  async createSubdirectory(workspaceRoot: string, relativePath: string): Promise<string> {
    const fullPath = path.join(workspaceRoot, relativePath);
    await fs.mkdir(fullPath, { recursive: true });
    return fullPath;
  }

  // Write environment file to workspace
  async writeEnvFile(workspaceRoot: string, envContent: string): Promise<void> {
    await fs.writeFile(path.join(workspaceRoot, '.env'), envContent);
  }

  // Clean up workspace with delay
  cleanupWorkspace(workspaceRoot: string, delayMs: number = 5000): void {
    setTimeout(() => {
      fs.rm(workspaceRoot, { recursive: true, force: true }).catch((err) => {
        console.error(`Failed to clean up workspace ${workspaceRoot}:`, err);
      });
    }, delayMs);
  }

  // Clean up workspace immediately
  async cleanupWorkspaceNow(workspaceRoot: string): Promise<void> {
    try {
      await fs.rm(workspaceRoot, { recursive: true, force: true });
    } catch (err) {
      console.error(`Failed to clean up workspace ${workspaceRoot}:`, err);
    }
  }
}