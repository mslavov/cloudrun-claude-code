import simpleGit, { SimpleGit } from "simple-git";

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

  // Clone a git repository
  async cloneRepository(options: GitCloneOptions): Promise<void> {
    const { gitRepo, targetPath, branch = 'main', depth = 1, sshKeyPath } = options;

    if (!this.isValidGitUrl(gitRepo)) {
      throw new Error("Invalid git repository URL format. Use SSH (git@...) or HTTPS format.");
    }

    console.log(`Cloning repository: ${gitRepo} (branch: ${branch}, depth: ${depth})`);
    if (sshKeyPath) {
      console.log(`Using SSH key: ${sshKeyPath}`);
    }

    try {
      // Create a fresh SimpleGit instance to avoid carrying environment state between clones
      const git = simpleGit({
        baseDir: '/tmp',
        binary: 'git',
        maxConcurrentProcesses: 1,
        trimmed: false,
      });

      // Configure SSH key if provided
      if (sshKeyPath) {
        git.env('GIT_SSH_COMMAND', `ssh -i ${sshKeyPath} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null`);
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
      console.log("✓ Repository cloned successfully");
    } catch (error: any) {
      // Log the actual error for debugging
      console.error("Git clone failed with error:", error.message);
      
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