import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import { constants } from "fs";

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

  // Write SSH key file to workspace
  async writeSshKeyFile(workspaceRoot: string, key: string): Promise<string> {
    const sshDir = path.join(workspaceRoot, '.ssh');
    const keyPath = path.join(sshDir, 'deploy_key');

    // Create .ssh directory with restricted permissions
    await fs.mkdir(sshDir, { recursive: true, mode: 0o700 });

    // Trim any extra whitespace and ensure proper format
    let keyContent = key.trim();

    // Validate SSH key format
    if (!keyContent.includes('BEGIN') || !keyContent.includes('PRIVATE KEY')) {
      throw new Error('Invalid SSH key format: Missing BEGIN/PRIVATE KEY markers');
    }

    // Ensure proper line endings (replace any \r\n or \r with \n)
    keyContent = keyContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    // Ensure the key ends with a newline
    if (!keyContent.endsWith('\n')) {
      keyContent += '\n';
    }

    // Write the key file with restricted permissions
    await fs.writeFile(keyPath, keyContent, { mode: 0o600 });

    console.log(`✓ SSH key written to ${keyPath} (${keyContent.length} bytes)`);
    return keyPath;
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