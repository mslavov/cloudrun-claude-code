import simpleGit from "simple-git";
import { logger } from "../../utils/logger.js";
import * as fs from "fs";
import * as path from "path";

export interface GitCloneOptions {
  gitRepo: string;
  targetPath: string;
  branch?: string;
  depth?: number;
  sshKeyPath?: string;
}

export class GitService {
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

  /**
   * Configure git user identity for commits
   * Must be called before any git operations that require author info (commit, merge, etc.)
   *
   * Reads identity from .gitconfig in repository root if available, otherwise uses defaults
   */
  async configureIdentity(
    workspacePath: string,
    name?: string,
    email?: string
  ): Promise<void> {
    try {
      // Try to read from .gitconfig in repository root if name/email not explicitly provided
      if (!name || !email) {
        const gitConfigPath = path.join(workspacePath, '.gitconfig');

        if (fs.existsSync(gitConfigPath)) {
          try {
            const configContent = fs.readFileSync(gitConfigPath, 'utf-8');

            // Parse [user] section for name and email
            // Regex matches:  name = Value  or  name=Value
            const nameMatch = configContent.match(/\[user\][\s\S]*?\bname\s*=\s*(.+)/);
            const emailMatch = configContent.match(/\[user\][\s\S]*?\bemail\s*=\s*(.+)/);

            if (nameMatch && !name) {
              name = nameMatch[1].trim();
            }
            if (emailMatch && !email) {
              email = emailMatch[1].trim();
            }

            if (nameMatch || emailMatch) {
              logger.debug(`Read git identity from .gitconfig: ${name || '(default)'} <${email || '(default)'}>`);
            }
          } catch (readError: any) {
            logger.debug(`Could not read .gitconfig: ${readError.message}`);
          }
        }
      }

      // Use defaults if still not set
      name = name || 'Claude Code';
      email = email || 'noreply@anthropic.com';

      const git = simpleGit(workspacePath);

      // Set local git config for this repository
      await git.addConfig('user.name', name, false, 'local');
      await git.addConfig('user.email', email, false, 'local');

      logger.debug(`✓ Git identity configured: ${name} <${email}>`);
    } catch (error: any) {
      logger.error('Failed to configure git identity:', error.message);
      throw new Error(`Failed to configure git identity: ${error.message}`);
    }
  }

  /**
   * Check if workspace has uncommitted changes
   */
  async hasChanges(workspacePath: string): Promise<boolean> {
    try {
      const git = simpleGit(workspacePath);
      const status = await git.status();

      // Check for modified, added, deleted, or untracked files
      const hasChanges = status.files.length > 0;

      if (hasChanges) {
        logger.debug(`Workspace has ${status.files.length} changed files`);
      } else {
        logger.debug('Workspace has no changes');
      }

      return hasChanges;
    } catch (error: any) {
      logger.error('Failed to check git status:', error.message);
      throw new Error(`Failed to check for changes: ${error.message}`);
    }
  }

  /**
   * Commit changes in workspace
   * Optionally specify files to commit (defaults to all changes)
   */
  async commit(
    workspacePath: string,
    message: string,
    files?: string[],
    sshKeyPath?: string
  ): Promise<{ sha: string; message: string }> {
    try {
      // Configure git identity BEFORE any git operations
      await this.configureIdentity(workspacePath);

      const git = simpleGit(workspacePath);

      // Configure SSH key if provided
      if (sshKeyPath) {
        git.env('GIT_SSH_COMMAND', `ssh -i ${sshKeyPath} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null`);
      }

      // Stage files
      if (files && files.length > 0) {
        logger.debug(`Staging specific files: ${files.join(', ')}`);
        await git.add(files);
      } else {
        logger.debug('Staging all changes');
        await git.add('-A');
      }

      // Check if there's anything to commit after staging
      const status = await git.status();
      if (status.staged.length === 0) {
        logger.debug('No changes staged for commit');
        throw new Error('No changes to commit after staging');
      }

      // Create commit
      logger.debug(`Creating commit with ${status.staged.length} staged files`);
      const commitResult = await git.commit(message);

      logger.debug(`✓ Commit created: ${commitResult.commit}`);

      return {
        sha: commitResult.commit,
        message: message
      };
    } catch (error: any) {
      logger.error('Failed to commit changes:', error.message);
      throw new Error(`Failed to commit: ${error.message}`);
    }
  }

  /**
   * Push commits to remote repository
   */
  async push(
    workspacePath: string,
    branch: string = 'main',
    sshKeyPath?: string,
    force: boolean = false
  ): Promise<void> {
    try {
      const git = simpleGit(workspacePath);

      // Configure SSH key if provided
      if (sshKeyPath) {
        git.env('GIT_SSH_COMMAND', `ssh -i ${sshKeyPath} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null`);
      }

      logger.debug(`Pushing to remote (branch: ${branch}, force: ${force})`);

      const pushOptions = force ? ['--force'] : [];

      // Push with timeout
      const pushPromise = git.push('origin', branch, pushOptions);
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Git push operation timed out after 30 seconds')), 30000);
      });

      await Promise.race([pushPromise, timeoutPromise]);

      logger.debug('✓ Push completed successfully');
    } catch (error: any) {
      logger.error('Failed to push changes:', error.message);

      // Provide helpful error messages
      let errorMessage = error.message;
      if (error.message.includes('Could not read from remote repository')) {
        errorMessage = 'Authentication failed. Ensure SSH key has write access to the repository.';
      } else if (error.message.includes('Permission denied')) {
        errorMessage = 'SSH key authentication failed or insufficient permissions.';
      } else if (error.message.includes('rejected')) {
        errorMessage = 'Push rejected. Remote has changes that are not in local branch. Consider fetching first.';
      }

      throw new Error(`Failed to push: ${errorMessage}`);
    }
  }

  /**
   * Commit and push changes in one operation
   * Convenience method that combines commit + push
   */
  async commitAndPush(
    workspacePath: string,
    message: string,
    options: {
      files?: string[];
      branch?: string;
      sshKeyPath?: string;
      force?: boolean;
    } = {}
  ): Promise<{ sha: string; message: string; pushed: boolean }> {
    const { files, branch = 'main', sshKeyPath, force = false } = options;

    // Check if there are changes
    const hasChanges = await this.hasChanges(workspacePath);
    if (!hasChanges) {
      logger.info('No changes to commit and push');
      throw new Error('No changes to commit');
    }

    // Commit
    const commitResult = await this.commit(workspacePath, message, files, sshKeyPath);

    // Push
    await this.push(workspacePath, branch, sshKeyPath, force);

    return {
      ...commitResult,
      pushed: true
    };
  }
}