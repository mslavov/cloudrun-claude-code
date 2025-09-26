import { Request, Response } from "express";
import { SecretsService } from "../services/secrets.service.js";
import {
  ListSecretsQuery,
  GetSecretQuery,
  CreateSecretBody,
  UpdateSecretBody,
  DeleteSecretQuery,
  SecretResponse,
  ListSecretsResponse,
  GetSecretResponse
} from "../types/secrets.types.js";

export class SecretsController {
  private secretsService: SecretsService;

  constructor() {
    this.secretsService = new SecretsService();
  }

  // ============ RESTful API Methods (new) ============

  // GET /api/secrets - List all secrets
  async list(req: Request<{}, {}, {}, ListSecretsQuery>, res: Response<ListSecretsResponse>): Promise<void> {
    try {
      const { org, repo, type } = req.query;
      const secrets = await this.secretsService.listSecrets(org, repo, type);
      res.json({ secrets });
    } catch (error: any) {
      console.error("Error listing secrets:", error);
      res.status(500).json({ secrets: [], error: error.message } as any);
    }
  }

  // GET /api/secrets/:id - Get a specific secret
  async get(req: Request<{ id: string }>, res: Response): Promise<void> {
    try {
      const { id } = req.params;

      // Parse the id to extract type, org, repo, and optionally branch
      const parts = id.split('_');
      if (parts.length < 3) {
        res.status(400).json({
          error: "Invalid secret ID format. Expected: {type}_{org}_{repo}[_{branch}]"
        });
        return;
      }

      const [type, org, ...repoParts] = parts;
      const repo = repoParts[0];
      const branch = repoParts.slice(1).join('_').replace(/__/g, '/') || undefined;

      // Validate type
      if (type !== 'env' && type !== 'ssh') {
        res.status(400).json({
          error: "Invalid type in secret ID. Must be 'env' or 'ssh'"
        });
        return;
      }

      // Construct gitRepo URL for fetching
      const gitRepo = `git@github.com:${org}/${repo}.git`;
      const secretContent = await this.secretsService.fetchSecret(gitRepo, type as 'env' | 'ssh', branch);

      if (secretContent) {
        if (type === 'env') {
          res.json({
            id,
            type,
            org,
            repo,
            branch,
            env: this.secretsService.parseEnvContent(secretContent)
          });
        } else {
          res.json({
            id,
            type,
            org,
            repo,
            secretContent
          });
        }
      } else {
        res.status(404).json({
          error: "Secret not found"
        });
      }
    } catch (error: any) {
      console.error("Error getting secret:", error);
      res.status(500).json({
        error: error.message
      });
    }
  }

  // POST /api/secrets - Create a new secret
  async create(req: Request<{}, {}, CreateSecretBody>, res: Response<SecretResponse>): Promise<void> {
    try {
      const { org, repo, branch, type = 'env', secretContent, envContent } = req.body;

      // Support backward compatibility with envContent
      const content = secretContent || envContent;

      if (!org || !repo || !content) {
        res.status(400).json({
          success: false,
          error: "org, repo, and secretContent (or envContent) are required"
        });
        return;
      }

      // Validate type
      if (type !== 'env' && type !== 'ssh') {
        res.status(400).json({
          success: false,
          error: "Invalid type. Must be 'env' or 'ssh'"
        });
        return;
      }

      const result = await this.secretsService.createSecret(org, repo, content, type, branch);

      if (result.success) {
        // Construct the resource ID for the Location header
        const resourceId = this.constructSecretId(type, org, repo, branch);
        res.status(201)
           .location(`/api/secrets/${resourceId}`)
           .json(result);
      } else {
        res.status(400).json(result);
      }
    } catch (error: any) {
      console.error("Error creating secret:", error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  // PUT /api/secrets/:id - Update a secret
  async update(req: Request<{ id: string }, {}, { secretContent?: string; envContent?: string }>, res: Response<SecretResponse>): Promise<void> {
    try {
      const { id } = req.params;
      const { secretContent, envContent } = req.body;

      // Support backward compatibility with envContent
      const content = secretContent || envContent;

      if (!content) {
        res.status(400).json({
          success: false,
          error: "secretContent (or envContent) is required"
        });
        return;
      }

      // Parse the id to extract type, org, repo, and optionally branch
      const parts = id.split('_');
      if (parts.length < 3) {
        res.status(400).json({
          success: false,
          error: "Invalid secret ID format. Expected: {type}_{org}_{repo}[_{branch}]"
        });
        return;
      }

      const [type, org, ...repoParts] = parts;
      const repo = repoParts[0];
      const branch = repoParts.slice(1).join('_').replace(/__/g, '/') || undefined;

      // Validate type
      if (type !== 'env' && type !== 'ssh') {
        res.status(400).json({
          success: false,
          error: "Invalid type in secret ID. Must be 'env' or 'ssh'"
        });
        return;
      }

      const result = await this.secretsService.updateSecret(org, repo, content, type as 'env' | 'ssh', branch);

      if (result.success) {
        res.json(result);
      } else {
        res.status(400).json(result);
      }
    } catch (error: any) {
      console.error("Error updating secret:", error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  // DELETE /api/secrets/:id - Delete a secret
  async delete(req: Request<{ id: string }>, res: Response<SecretResponse>): Promise<void> {
    try {
      const { id } = req.params;

      // Parse the id to extract type, org, repo, and optionally branch
      const parts = id.split('_');
      if (parts.length < 3) {
        res.status(400).json({
          success: false,
          error: "Invalid secret ID format. Expected: {type}_{org}_{repo}[_{branch}]"
        });
        return;
      }

      const [type, org, ...repoParts] = parts;
      const repo = repoParts[0];
      const branch = repoParts.slice(1).join('_').replace(/__/g, '/') || undefined;

      // Validate type
      if (type !== 'env' && type !== 'ssh') {
        res.status(400).json({
          success: false,
          error: "Invalid type in secret ID. Must be 'env' or 'ssh'"
        });
        return;
      }

      const result = await this.secretsService.deleteSecret(org, repo, type as 'env' | 'ssh', branch);

      if (result.success) {
        res.status(204).send(); // No content for successful deletion
      } else {
        res.status(404).json(result);
      }
    } catch (error: any) {
      console.error("Error deleting secret:", error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  // Helper method to construct secret ID
  private constructSecretId(type: string, org: string, repo: string, branch?: string): string {
    const sanitizedBranch = branch ? branch.replace(/\//g, '__') : '';
    if (branch && type === 'env' && branch !== 'main' && branch !== 'master') {
      return `${type}_${org}_${repo}_${sanitizedBranch}`;
    }
    return `${type}_${org}_${repo}`;
  }

  // ============ Legacy API Methods (backward compatibility) ============

  // List all secrets for an organization/repo
  async listSecrets(req: Request<{}, {}, {}, ListSecretsQuery>, res: Response<ListSecretsResponse>): Promise<void> {
    try {
      const { org, repo, type } = req.query;
      const secrets = await this.secretsService.listSecrets(org, repo, type);
      res.json({ secrets });
    } catch (error: any) {
      console.error("Error listing secrets:", error);
      res.status(500).json({ secrets: [], error: error.message } as any);
    }
  }

  // Get environment variables or SSH key for a repo
  async getSecret(req: Request<{}, {}, {}, GetSecretQuery>, res: Response<GetSecretResponse>): Promise<void> {
    try {
      const { gitRepo, gitBranch, type = 'env' } = req.query;

      if (!gitRepo) {
        res.status(400).json({
          exists: false,
          error: "gitRepo query parameter is required"
        });
        return;
      }

      const secretContent = await this.secretsService.fetchSecret(gitRepo, type, gitBranch);

      if (secretContent) {
        const parsed = this.secretsService.parseGitRepo(gitRepo);
        const prefix = type === 'ssh' ? 'ssh' : 'env';
        const sanitizedBranch = gitBranch ? gitBranch.replace(/\//g, '__') : '';
        const secretName = type === 'env' && gitBranch && gitBranch !== 'main' && gitBranch !== 'master'
          ? `${prefix}_${parsed?.org}_${parsed?.repo}_${sanitizedBranch}`
          : `${prefix}_${parsed?.org}_${parsed?.repo}`;

        res.json({
          exists: true,
          secretName,
          env: type === 'env' ? this.secretsService.parseEnvContent(secretContent) : undefined,
          secretContent: type === 'ssh' ? secretContent : undefined
        } as any);
      } else {
        res.json({
          exists: false,
          error: "Secret not found"
        });
      }
    } catch (error: any) {
      console.error("Error getting secret:", error);
      res.status(500).json({
        exists: false,
        error: error.message
      });
    }
  }

  // Create a new secret
  async createSecret(req: Request<{}, {}, CreateSecretBody>, res: Response<SecretResponse>): Promise<void> {
    try {
      const { org, repo, branch, type = 'env', secretContent, envContent } = req.body;

      // Support backward compatibility with envContent
      const content = secretContent || envContent;

      if (!org || !repo || !content) {
        res.status(400).json({
          success: false,
          error: "org, repo, and secretContent (or envContent) are required"
        });
        return;
      }

      // Validate type
      if (type !== 'env' && type !== 'ssh') {
        res.status(400).json({
          success: false,
          error: "Invalid type. Must be 'env' or 'ssh'"
        });
        return;
      }

      const result = await this.secretsService.createSecret(org, repo, content, type, branch);

      if (result.success) {
        res.status(201).json(result);
      } else {
        res.status(400).json(result);
      }
    } catch (error: any) {
      console.error("Error creating secret:", error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  // Update an existing secret
  async updateSecret(req: Request<{}, {}, UpdateSecretBody>, res: Response<SecretResponse>): Promise<void> {
    try {
      const { org, repo, branch, type = 'env', secretContent, envContent } = req.body;

      // Support backward compatibility with envContent
      const content = secretContent || envContent;

      if (!org || !repo || !content) {
        res.status(400).json({
          success: false,
          error: "org, repo, and secretContent (or envContent) are required"
        });
        return;
      }

      // Validate type
      if (type !== 'env' && type !== 'ssh') {
        res.status(400).json({
          success: false,
          error: "Invalid type. Must be 'env' or 'ssh'"
        });
        return;
      }

      const result = await this.secretsService.updateSecret(org, repo, content, type, branch);

      if (result.success) {
        res.json(result);
      } else {
        res.status(400).json(result);
      }
    } catch (error: any) {
      console.error("Error updating secret:", error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  // Delete a secret
  async deleteSecret(req: Request<{}, {}, {}, DeleteSecretQuery>, res: Response<SecretResponse>): Promise<void> {
    try {
      const { org, repo, branch, type = 'env' } = req.query;

      if (!org || !repo) {
        res.status(400).json({
          success: false,
          error: "org and repo query parameters are required"
        });
        return;
      }

      // Validate type
      if (type !== 'env' && type !== 'ssh') {
        res.status(400).json({
          success: false,
          error: "Invalid type. Must be 'env' or 'ssh'"
        });
        return;
      }

      const result = await this.secretsService.deleteSecret(org, repo, type, branch);

      if (result.success) {
        res.json(result);
      } else {
        res.status(400).json(result);
      }
    } catch (error: any) {
      console.error("Error deleting secret:", error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
}