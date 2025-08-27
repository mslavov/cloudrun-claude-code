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
      const { org, repo } = req.query;
      const secrets = await this.secretsService.listSecrets(org, repo);
      res.json({ secrets });
    } catch (error: any) {
      console.error("Error listing secrets:", error);
      res.status(500).json({ secrets: [], error: error.message } as any);
    }
  }

  // Get environment variables for a repo
  async getSecret(req: Request<{}, {}, {}, GetSecretQuery>, res: Response<GetSecretResponse>): Promise<void> {
    try {
      const { gitRepo, gitBranch } = req.query;
      
      if (!gitRepo) {
        res.status(400).json({
          exists: false,
          error: "gitRepo query parameter is required"
        });
        return;
      }

      const envContent = await this.secretsService.fetchEnvSecret(gitRepo, gitBranch);
      
      if (envContent) {
        const parsed = this.secretsService.parseGitRepo(gitRepo);
        const sanitizedBranch = gitBranch ? gitBranch.replace(/\//g, '__') : '';
        const secretName = gitBranch && gitBranch !== 'main' && gitBranch !== 'master'
          ? `env_${parsed?.org}_${parsed?.repo}_${sanitizedBranch}`
          : `env_${parsed?.org}_${parsed?.repo}`;
        
        res.json({
          exists: true,
          secretName,
          env: this.secretsService.parseEnvContent(envContent)
        });
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
      const { org, repo, branch, envContent } = req.body;
      
      if (!org || !repo || !envContent) {
        res.status(400).json({
          success: false,
          error: "org, repo, and envContent are required"
        });
        return;
      }

      const result = await this.secretsService.createSecret(org, repo, envContent, branch);
      
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
      const { org, repo, branch, envContent } = req.body;
      
      if (!org || !repo || !envContent) {
        res.status(400).json({
          success: false,
          error: "org, repo, and envContent are required"
        });
        return;
      }

      const result = await this.secretsService.updateSecret(org, repo, envContent, branch);
      
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
      const { org, repo, branch } = req.query;
      
      if (!org || !repo) {
        res.status(400).json({
          success: false,
          error: "org and repo query parameters are required"
        });
        return;
      }

      const result = await this.secretsService.deleteSecret(org, repo, branch);
      
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