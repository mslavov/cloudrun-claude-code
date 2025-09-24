export type SecretType = 'env' | 'ssh';

export interface ListSecretsQuery {
  org?: string;
  repo?: string;
  type?: SecretType;
}

export interface GetSecretQuery {
  gitRepo: string;
  gitBranch?: string;
  type?: SecretType;
}

export interface CreateSecretBody {
  org: string;
  repo: string;
  branch?: string;
  type?: SecretType;
  secretContent?: string;
  envContent?: string; // Backward compatibility
}

export interface UpdateSecretBody {
  org: string;
  repo: string;
  branch?: string;
  type?: SecretType;
  secretContent?: string;
  envContent?: string; // Backward compatibility
}

export interface DeleteSecretQuery {
  org: string;
  repo: string;
  branch?: string;
  type?: SecretType;
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