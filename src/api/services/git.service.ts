import simpleGit, { SimpleGit } from "simple-git";
import { logger } from "../../utils/logger.js";

export interface GitCloneOptions {
  gitRepo: string;
  targetPath: string;
  branch?: string;
  depth?: number;
  sshKeyPath?: string;
}

export class GitService {
  private git: SimpleGit;

  constructor() {
    this.git = simpleGit({
      baseDir: '/tmp',
      binary: 'git',
      maxConcurrentProcesses: 1,
      trimmed: false,
    });
  }

  // Validate git repository URL
  isValidGitUrl(gitRepo: string): boolean {
    return !!gitRepo.match(/^(git@|https?:\/\/)/);
  }

  // Convert HTTPS GitHub URL to SSH format
  convertHttpsToSsh(httpsUrl: string): string {
    // Match: https://github.com/owner/repo or https://github.com/owner/repo.git
    const match = httpsUrl.match(/https?:\/\/github\.com\/([^\/]+)\/([^\/]+?)(\.git)?$/);
    if (match) {
      const [, owner, repo] = match;
      return `git@github.com:${owner}/${repo}.git`;
    }
    return httpsUrl;
  }

  // Clone a git repository
  async cloneRepository(options: GitCloneOptions): Promise<void> {
    const { gitRepo, targetPath, branch = 'main', depth = 1, sshKeyPath } = options;

    if (!this.isValidGitUrl(gitRepo)) {
      throw new Error("Invalid git repository URL format. Use SSH (git@...) or HTTPS format.");
    }

    const isHttps = gitRepo.startsWith('http://') || gitRepo.startsWith('https://');
    const isSsh = gitRepo.startsWith('git@');

    logger.debug(`Cloning repository: ${gitRepo} (branch: ${branch}, depth: ${depth}, protocol: ${isHttps ? 'HTTPS' : 'SSH'})`);
    if (sshKeyPath) {
      logger.debug(`Using SSH key: ${sshKeyPath}`);
    }

    try {
      // Create a fresh SimpleGit instance to avoid carrying environment state between clones
      const git = simpleGit({
        baseDir: '/tmp',
        binary: 'git',
        maxConcurrentProcesses: 1,
        trimmed: false,
      });

      // Configure SSH key if provided and using SSH protocol
      if (sshKeyPath && isSsh) {
        git.env('GIT_SSH_COMMAND', `ssh -i ${sshKeyPath} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null`);
      }

      // For HTTPS URLs, disable credential prompts to avoid hanging on auth requests
      if (isHttps) {
        git.env('GIT_TERMINAL_PROMPT', '0');
        git.env('GIT_ASKPASS', 'echo');
      }

      // Set timeout for git operations (30 seconds)
      const clonePromise = git.clone(gitRepo, targetPath, [
        '--branch', branch,
        '--depth', depth.toString(),
        '--single-branch'
      ]);

      // Add timeout wrapper
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Git clone operation timed out after 30 seconds')), 30000);
      });

      await Promise.race([clonePromise, timeoutPromise]);
      logger.debug("✓ Repository cloned successfully");
    } catch (error: any) {
      // Log the actual error for debugging
      logger.error("Git clone failed with error:", error.message);
      
      // Provide more helpful error messages
      let errorMessage = error.message;
      if (error.message.includes('Could not read from remote repository')) {
        errorMessage = 'Authentication failed or repository not accessible. Ensure SSH key is properly configured.';
      } else if (error.message.includes('Repository not found')) {
        errorMessage = 'Repository not found. Check the repository URL and access permissions.';
      } else if (error.message.includes('timed out')) {
        errorMessage = 'Git clone operation timed out. Repository may be too large or network is slow.';
      } else if (error.message.includes('Permission denied')) {
        errorMessage = 'SSH key authentication failed. Check SSH key permissions and GitHub access.';
      } else if (error.message.includes('Host key verification failed')) {
        errorMessage = 'SSH host key verification failed. This should be handled by StrictHostKeyChecking=no.';
      }
      
      throw new Error(`Failed to clone repository: ${errorMessage}`);
    }
  }
}