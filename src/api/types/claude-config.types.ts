/**
 * Configuration types for MCP servers, slash commands, and subagents
 * These can be passed in the request payload to dynamically configure Claude Code
 */

/**
 * Slash Command Configuration
 * Defines a custom slash command
 */
export interface SlashCommandConfig {
  /** YAML frontmatter (optional) - any valid frontmatter fields */
  frontmatter?: Record<string, any>;

  /** The prompt/content of the slash command */
  content: string;
}

/**
 * Subagent Configuration
 * Defines a specialized subagent
 */
export interface SubagentConfig {
  /** YAML frontmatter - any valid frontmatter fields (name and description typically required) */
  frontmatter: Record<string, any>;

  /** The system prompt for the subagent */
  content: string;
}

/**
 * Collection of MCP servers, slash commands, and subagents
 * Used in request payload
 */
export interface ClaudeConfigPayload {
  /**
   * MCP configuration - raw JSON that will be written to .mcp.json
   * Should match the standard .mcp.json format:
   * { "mcpServers": { "servername": { "command": "...", ... } } }
   */
  mcpConfig?: Record<string, any>;

  /** Slash commands to create */
  slashCommands?: Record<string, SlashCommandConfig>;

  /** Subagents to create */
  subagents?: Record<string, SubagentConfig>;
}

/**
 * Result of writing config files
 * Tracks which files were created for git exclusion
 */
export interface ConfigFilesResult {
  /** Paths to created config files (relative to workspace root) */
  createdFiles: string[];

  /** Summary of what was created */
  summary: {
    mcpConfigCreated: boolean;
    slashCommandsCount: number;
    subagentsCount: number;
  };
}
