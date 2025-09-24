# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

This is a Cloud Run service that wraps the Claude Code TypeScript SDK to provide a production-ready deployment with dynamic configuration for MCP servers, system prompts, and tool permissions. The service runs Claude Code CLI in ephemeral containers with per-request isolation.

## Documentation Guides

This repository includes comprehensive documentation:
- **README.md**: Project overview, features, quick start, and API usage examples
- **docs/deployment.md**: Detailed step-by-step deployment guide with all necessary commands
- **docs/testing.md**: Complete testing guide with local and remote testing instructions
- **docs/index.md**: Documentation index with links to all guides

When working on deployment or testing tasks, read the appropriate guide first for complete instructions and commands.

## Key Commands

### Development
```bash
npm run dev       # Start development server with hot reload (uses tsx watch)
npm run build     # Compile TypeScript to JavaScript in dist/
npm start         # Run production server from dist/
```

For deployment, testing, and service account setup commands, refer to docs/deployment.md and docs/testing.md.

## Architecture

### Core Components
- **src/server.ts**: Express server handling /run endpoint, SSE streaming, request validation
- **src/claude-runner.ts**: Manages Claude CLI subprocess spawning with two execution modes (named pipe or direct stdin)
- **Dockerfile**: Multi-stage build installing Claude Code via official script, runs as non-root user

### Request Flow
1. Client sends POST to /run with prompt and configuration
2. Server creates ephemeral workspace in /tmp
3. ClaudeRunner spawns claude CLI subprocess with arguments
4. Output streams back to client via Server-Sent Events (SSE)
5. Workspace cleaned up after request completion

### Key Design Decisions
- **Ephemeral Workspaces**: Each request gets isolated /tmp/ws-{requestId} directory
- **Two Execution Modes**: Named pipe method (better for large prompts) or direct stdin
- **Global Claude Installation**: Claude Code installed globally in Docker following official pattern
- **Dynamic Configuration**: MCP servers, system prompts, tools configured per-request
- **Authentication**: Supports both API keys and OAuth tokens

## Authentication Methods
- **ANTHROPIC_API_KEY**: Direct API access from console.anthropic.com
- **CLAUDE_CODE_OAUTH_TOKEN**: OAuth token from Claude subscription using `claude setup-token`

## Configuration Options

### Request Parameters
- `prompt` (required): The prompt for Claude
- `systemPrompt`: Custom system prompt to replace default
- `appendSystemPrompt`: Text to append to system prompt
- `allowedTools`: List of allowed tools
- `disallowedTools`: List of tools to block
- `permissionMode`: Permission mode (acceptEdits, bypassPermissions, plan)
- `mcpConfigJson`: MCP server configuration object
- `maxTurns`: Maximum conversation turns (default: 6)
- `model`: Specific Claude model to use
- `fallbackModel`: Fallback model if primary fails
- `useNamedPipe`: Use named pipe for prompt delivery (default: true)

### Environment Variables
- `PORT`: Server port (default: 8080)
- `ALLOWED_TOOLS`: Default allowed tools list
- `PERMISSION_MODE`: Default permission mode

## Important Implementation Details

### Concurrency Settings
- **CONCURRENCY=3**: Optimal for Claude workloads (1.3GB RAM, 0.66 CPU per request)
- Lower concurrency ensures adequate resources for AI code generation tasks
- Total capacity: 30 concurrent requests (10 instances × 3 each)

### Claude CLI Environment Setup (claude-runner.ts)
- Sets `CLAUDE_CODE_ACTION=1` to enable OAuth support
- Preserves HOME directory for Claude configuration access
- Passes through CLAUDE_CODE_OAUTH_TOKEN if available
- Configures timeout (default 55 minutes)

### Server Security (server.ts)
- Request size limit: 2MB
- Ephemeral workspace cleanup after 5 seconds
- Client disconnect handling kills Claude process
- Health check endpoints for monitoring

### Docker Configuration
- Claude Code installed via official install script
- Non-root user (appuser) with proper permissions
- Claude installation moved to /opt for shared access
- Symlinks created for user home directory access

## SSH Key Management

The service supports two approaches for SSH authentication with private Git repositories:

### 1. Per-Repository SSH Keys (Recommended)
- Managed via the SSH Key Management API endpoints
- Each repository can have its own SSH key stored in Google Secret Manager
- Keys are fetched dynamically when cloning repositories
- Better security isolation between projects
- No deployment-time configuration needed

### 2. Global SSH Key (Optional)
- Single SSH key mounted at `/home/appuser/.ssh/id_rsa`
- Set via `GIT_SSH_KEY` environment variable
- Applied to all Git operations globally
- Useful for simpler setups or backward compatibility
- Configured during deployment via `scripts/gen_key.sh` and `scripts/create-secrets.sh`

The service automatically detects which approach to use:
- If a repository has a per-repo SSH key, it uses that
- Otherwise, falls back to the global SSH key if mounted
- If neither is available, assumes public repository access

## Common Issues

### OAuth Token Setup
OAuth tokens from Claude subscriptions work with this service. The service sets `CLAUDE_CODE_ACTION=1` for proper OAuth support in the containerized environment.

### Process Timeouts
Claude processes have a configurable timeout (default 55 minutes, max 60 minutes per Cloud Run limits). Long-running tasks may need timeout adjustment via `timeoutMinutes` option.

### Named Pipe vs Direct Input
The service supports two prompt delivery methods:
- Named pipe (default): Better for large prompts, uses mkfifo
- Direct stdin: Simpler but may have issues with very large prompts