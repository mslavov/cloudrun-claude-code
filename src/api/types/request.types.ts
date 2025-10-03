export interface RunRequest {
  prompt: string;
  anthropicApiKey?: string; // User's Anthropic API key
  anthropicOAuthToken?: string; // User's Anthropic OAuth token (from Claude subscription)
  systemPrompt?: string;
  appendSystemPrompt?: string;
  allowedTools?: string[];
  disallowedTools?: string[];
  permissionMode?: string;
  maxTurns?: number;
  model?: string;
  fallbackModel?: string;
  cwdRelative?: string;
  useNamedPipe?: boolean;
  gitRepo?: string;
  gitBranch?: string;
  gitDepth?: number;
  timeoutMinutes?: number;
  environmentSecrets?: Record<string, string>;
  sshKey?: string;
  metadata?: Record<string, any>;
}