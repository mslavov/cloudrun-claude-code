export interface ListSecretsQuery {
  org?: string;
  repo?: string;
}

export interface GetSecretQuery {
  gitRepo: string;
  gitBranch?: string;
}

export interface CreateSecretBody {
  org: string;
  repo: string;
  branch?: string;
  envContent: string;
}

export interface UpdateSecretBody {
  org: string;
  repo: string;
  branch?: string;
  envContent: string;
}

export interface DeleteSecretQuery {
  org: string;
  repo: string;
  branch?: string;
}

export interface SecretResponse {
  success: boolean;
  secretName?: string;
  version?: string;
  error?: string;
}

export interface ListSecretsResponse {
  secrets: string[];
}

export interface GetSecretResponse {
  exists: boolean;
  secretName?: string;
  env?: Record<string, string>;
  error?: string;
}