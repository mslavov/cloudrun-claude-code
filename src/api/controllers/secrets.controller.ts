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