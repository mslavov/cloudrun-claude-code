import { SlashCommandConfig, SubagentConfig } from './claude-config.types.js';

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
  preExecutionCommands?: string[]; // Commands to run before task execution starts (e.g., npm ci, playwright install)
  postExecutionActions?: PostExecutionActions;
  environmentSecrets?: Record<string, string>;
  sshKey?: string;
  metadata?: Record<string, any>;
  mcpConfig?: Record<string, any>; // Raw .mcp.json content
  slashCommands?: Record<string, SlashCommandConfig>;
  subagents?: Record<string, SubagentConfig>;
}

export interface PostExecutionActions {
  /**
   * Git operations (commit and/or push)
   */
  git?: {
    /** Whether to create a git commit */
    commit: boolean;

    /** Custom commit message (optional) */
    commitMessage?: string;

    /** Whether to push to remote */
    push: boolean;

    /** Git branch to push to (default: 'main') */
    branch?: string;

    /** Specific files to commit (optional, defaults to all changes) */
    files?: string[];

    /**
     * How to handle conflicts when pushing (default: 'auto')
     * - "auto": Automatically recover from conflicts (agent's changes win)
     * - "fail": Fail explicitly on conflicts
     */
    conflictStrategy?: "auto" | "fail";
  };

  /**
   * File upload operations
   */
  uploadFiles?: {
    /** Glob patterns for files to upload (e.g., [".playwright/**\/*.webm"]) */
    globPatterns: string[];

    /** Optional prefix in GCS bucket */
    gcsPrefix?: string;
  };
}