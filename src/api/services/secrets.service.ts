import { SecretManagerServiceClient } from "@google-cloud/secret-manager";

export interface ParsedRepo {
  org: string;
  repo: string;
}

export type SecretType = 'env' | 'ssh';

export class SecretsService {
  private client: SecretManagerServiceClient;

  constructor() {
    this.client = new SecretManagerServiceClient();
  }

  // Sanitize branch name for use in secret names (replace / with __)
  private sanitizeBranchName(branch: string): string {
    return branch.replace(/\//g, '__');
  }

  // Build hierarchy of secret names to try, from most specific to least
  private buildSecretName(org: string, repo: string, type: SecretType = 'env', branch?: string): string[] {
    const secrets: string[] = [];
    const prefix = type === 'ssh' ? 'ssh' : 'env';

    // SSH secrets don't support branch hierarchy
    if (type === 'ssh') {
      secrets.push(`${prefix}_${org}_${repo}`);
      return secrets;
    }

    // Environment secrets support branch hierarchy
    if (branch && branch !== 'main' && branch !== 'master') {
      const sanitizedBranch = this.sanitizeBranchName(branch);
      secrets.push(`${prefix}_${org}_${repo}_${sanitizedBranch}`);

      // Add hierarchical paths for branches with slashes
      if (branch.includes('/')) {
        const parts = branch.split('/');
        for (let i = parts.length - 1; i > 0; i--) {
          const partialBranch = parts.slice(0, i).join('__');
          secrets.push(`${prefix}_${org}_${repo}_${partialBranch}`);
        }
      }
    }

    // Add repo default
    secrets.push(`${prefix}_${org}_${repo}`);

    return secrets;
  }

  // Parse git repository URL to extract org and repo name
  parseGitRepo(gitRepo: string): ParsedRepo | null {
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

  // Generic method to fetch secrets based on type
  async fetchSecret(gitRepo: string, type: SecretType = 'env', branch?: string): Promise<string | null> {
    const parsed = this.parseGitRepo(gitRepo);
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

    // Build hierarchical list of secret names to try
    const secretNames = this.buildSecretName(org, repo, type, branch);

    const secretTypeLabel = type === 'ssh' ? 'SSH key' : 'environment secret';
    console.log(`Attempting to fetch ${secretTypeLabel} for ${org}/${repo}${branch && type === 'env' ? ` (${branch})` : ''}`);
    console.log(`Secret hierarchy: ${secretNames.join(' -> ')}`);

    for (const secretName of secretNames) {
      try {
        const name = `projects/${projectId}/secrets/${secretName}/versions/latest`;
        console.log(`Trying secret: ${secretName}`);

        const [version] = await this.client.accessSecretVersion({ name });
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

    console.log(`No ${secretTypeLabel} found for ${org}/${repo}`);
    return null;
  }

  // Backward compatibility wrapper for environment secrets
  async fetchEnvSecret(gitRepo: string, branch?: string): Promise<string | null> {
    return this.fetchSecret(gitRepo, 'env', branch);
  }

  // Fetch SSH deployment key for a repository
  async fetchDeployKey(gitRepo: string): Promise<string | null> {
    return this.fetchSecret(gitRepo, 'ssh');
  }

  // List all secrets for an organization/repo
  async listSecrets(org?: string, repo?: string, type?: SecretType): Promise<string[]> {
    const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.PROJECT_ID;
    
    if (!projectId) {
      throw new Error("PROJECT_ID not set, cannot list secrets");
    }

    const parent = `projects/${projectId}`;
    const [secrets] = await this.client.listSecrets({ parent });
    
    const secretNames: string[] = [];
    for (const secret of secrets) {
      const name = secret.name?.split('/').pop();
      if (!name) continue;
      
      // Filter by type, org, and repo if provided
      const isEnvSecret = name.startsWith('env_');
      const isSshSecret = name.startsWith('ssh_');

      if (!isEnvSecret && !isSshSecret) continue;

      // Filter by type if specified
      if (type === 'env' && !isEnvSecret) continue;
      if (type === 'ssh' && !isSshSecret) continue;

      // Filter by org/repo
      const prefix = isEnvSecret ? 'env_' : 'ssh_';
      if (org && !name.includes(`${prefix}${org}_`)) continue;
      if (repo && !name.includes(`_${repo}`)) continue;

      secretNames.push(name);
    }
    
    return secretNames;
  }

  // Create a new secret
  async createSecret(org: string, repo: string, secretContent: string, type: SecretType = 'env', branch?: string): Promise<{ success: boolean; secretName: string; error?: string }> {
    const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.PROJECT_ID;
    
    if (!projectId) {
      return { success: false, secretName: '', error: 'PROJECT_ID not set' };
    }

    const prefix = type === 'ssh' ? 'ssh' : 'env';
    const secretName = type === 'env' && branch && branch !== 'main' && branch !== 'master'
      ? `${prefix}_${org}_${repo}_${this.sanitizeBranchName(branch)}`
      : `${prefix}_${org}_${repo}`;

    try {
      const parent = `projects/${projectId}`;
      
      // Check if secret already exists
      try {
        const secretPath = `${parent}/secrets/${secretName}`;
        await this.client.getSecret({ name: secretPath });
        return { success: false, secretName, error: 'Secret already exists. Use update instead.' };
      } catch (e: any) {
        // Secret doesn't exist, proceed with creation
        if (e.code !== 5) { // 5 = NOT_FOUND
          throw e;
        }
      }
      
      // Create the secret
      const [secret] = await this.client.createSecret({
        parent,
        secretId: secretName,
        secret: {
          replication: {
            automatic: {},
          },
        },
      });

      // Add the secret version with the content
      await this.client.addSecretVersion({
        parent: secret.name,
        payload: {
          data: Buffer.from(secretContent, 'utf8'),
        },
      });

      console.log(`✓ Created secret: ${secretName}`);
      return { success: true, secretName };
    } catch (error: any) {
      console.error(`Failed to create secret: ${error.message}`);
      return { success: false, secretName, error: error.message };
    }
  }

  // Update an existing secret
  async updateSecret(org: string, repo: string, secretContent: string, type: SecretType = 'env', branch?: string): Promise<{ success: boolean; version?: string; error?: string }> {
    const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.PROJECT_ID;
    
    if (!projectId) {
      return { success: false, error: 'PROJECT_ID not set' };
    }

    const prefix = type === 'ssh' ? 'ssh' : 'env';
    const secretName = type === 'env' && branch && branch !== 'main' && branch !== 'master'
      ? `${prefix}_${org}_${repo}_${this.sanitizeBranchName(branch)}`
      : `${prefix}_${org}_${repo}`;

    try {
      const secretPath = `projects/${projectId}/secrets/${secretName}`;

      // Check if secret exists
      await this.client.getSecret({ name: secretPath });
      
      // Add new version
      const [version] = await this.client.addSecretVersion({
        parent: secretPath,
        payload: {
          data: Buffer.from(secretContent, 'utf8'),
        },
      });

      const versionName = version.name?.split('/').pop();
      console.log(`✓ Updated secret: ${secretName} (version: ${versionName})`);
      return { success: true, version: versionName };
    } catch (error: any) {
      console.error(`Failed to update secret: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  // Delete a secret
  async deleteSecret(org: string, repo: string, type: SecretType = 'env', branch?: string): Promise<{ success: boolean; error?: string }> {
    const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.PROJECT_ID;
    
    if (!projectId) {
      return { success: false, error: 'PROJECT_ID not set' };
    }

    const prefix = type === 'ssh' ? 'ssh' : 'env';
    const secretName = type === 'env' && branch && branch !== 'main' && branch !== 'master'
      ? `${prefix}_${org}_${repo}_${this.sanitizeBranchName(branch)}`
      : `${prefix}_${org}_${repo}`;

    try {
      const name = `projects/${projectId}/secrets/${secretName}`;
      await this.client.deleteSecret({ name });
      
      console.log(`✓ Deleted secret: ${secretName}`);
      return { success: true };
    } catch (error: any) {
      console.error(`Failed to delete secret: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  // Parse environment content into key-value pairs
  parseEnvContent(envContent: string): Record<string, string> {
    const env: Record<string, string> = {};
    const lines = envContent.split('\n');
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const [key, ...valueParts] = trimmed.split('=');
        if (key) {
          const value = valueParts.join('=').replace(/^["']|["']$/g, '');
          env[key] = value;
        }
      }
    }
    
    return env;
  }
}