export interface RunRequest {
  prompt: string;
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
}