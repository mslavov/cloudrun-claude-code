# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

This is a Cloud Run service that wraps the Claude Code TypeScript SDK to provide a production-ready deployment with dynamic configuration for MCP servers, system prompts, and tool permissions. The service runs Claude Code CLI in ephemeral containers with per-request isolation.

## Documentation Guides

This repository includes comprehensive documentation:
- **README.md**: Project overview, features, quick start, and API usage examples
- **docs/deployment.md**: Detailed step-by-step deployment guide with all necessary commands
- **docs/testing.md**: Complete testing guide with local and remote testing instructions
- **docs/api-reference.md**: Complete API reference for /run and /run-async endpoints
- **docs/async-tasks.md**: Comprehensive guide for async task execution with GCS logging
- **docs/index.md**: Documentation index with links to all guides

When working on deployment, testing, or async tasks, read the appropriate guide first for complete instructions and commands.

## Key Commands

### Development
```bash
npm run dev       # Start development server with hot reload (uses tsx watch)
npm run build     # Compile TypeScript to JavaScript in dist/
npm start         # Run production server from dist/
```

### Testing
**IMPORTANT**: Always use/update the existing test script at `scripts/test.sh` when testing changes.

```bash
./scripts/test.sh local        # Test local Docker container
./scripts/test.sh remote       # Test deployed Cloud Run service
./scripts/test.sh remote-async # Test async task execution
./scripts/test.sh auth         # Test authentication setup
./scripts/test.sh examples     # Show API request examples
./scripts/test.sh all          # Run all tests
```

For deployment and service account setup commands, refer to docs/deployment.md and docs/testing.md.

## Architecture

### Core Components
- **src/server.ts**: Express server handling /run and /run-async endpoints, SSE streaming, request validation
- **src/api/controllers/claude.controller.ts**: Sync endpoint controller (SSE streaming)
- **src/api/controllers/async-claude.controller.ts**: Async endpoint controller (GCS logging)
- **src/api/services/task.service.ts**: Unified task execution service for both sync and async
- **src/api/services/gcs-logger.service.ts**: Streams JSONL logs to Google Cloud Storage
- **src/api/services/output-handlers.ts**: Output handler pattern (SSE vs GCS)
- **src/claude-runner.ts**: Manages Claude CLI subprocess spawning with two execution modes (named pipe or direct stdin)
- **Dockerfile**: Multi-stage build installing Claude Code via official script, runs as non-root user

### Request Flow (Sync - /run)
1. Client sends POST to /run with prompt and configuration
2. Server creates ephemeral workspace in /tmp
3. TaskService executes via ClaudeRunner subprocess
4. Output streams back to client via Server-Sent Events (SSE) using SSEOutputHandler
5. Workspace cleaned up after request completion (5s delay)

### Request Flow (Async - /run-async)
1. Client sends POST to /run-async with prompt, callbackUrl, configuration
2. Server validates request and returns 202 Accepted with task ID immediately
3. Task executes in background:
   - Creates ephemeral workspace in /tmp
   - TaskService executes via ClaudeRunner subprocess
   - Output streams to GCS bucket via GCSOutputHandler
   - Logs written in chunks (100 lines per chunk as JSONL)
4. On completion:
   - POSTs results to callback URL with task summary
   - Saves final metadata to GCS
   - Workspace cleaned up immediately
5. Logs persist in GCS at `gs://bucket/sessions/{taskId}/`

### Key Design Decisions
- **Ephemeral Workspaces**: Each request gets isolated /tmp/ws-{requestId} directory
- **Two Execution Modes**: Named pipe method (better for large prompts) or direct stdin
- **Output Handler Pattern**: SSE for sync, GCS streaming for async (strategy pattern)
- **Chunked GCS Writes**: Logs buffered and written in 100-line chunks to minimize GCS operations
- **Global Claude Installation**: Claude Code installed globally in Docker following official pattern
- **Dynamic Configuration**: MCP servers, system prompts, tools configured per-request
- **Authentication**: Payload-based authentication with token proxy for security
- **Async Task Isolation**: Background execution doesn't block HTTP connection, enables long-running tasks

## Authentication Methods

**All authentication is payload-based** - credentials are passed in the request body, not as service-level environment variables:

- `anthropicApiKey`: Direct API key from console.anthropic.com (passed in request payload)
- `anthropicOAuthToken`: OAuth token from Claude subscription (passed in request payload)

The service uses a local proxy that intercepts Claude's API calls and replaces dummy credentials with real ones from the payload. This ensures Claude never has direct access to your API keys.

## Configuration Options

### Request Parameters

**Common Parameters (both /run and /run-async):**
- `prompt` (required): The prompt for Claude
- `anthropicApiKey`: Anthropic API key (one of anthropicApiKey or anthropicOAuthToken required)
- `anthropicOAuthToken`: Claude OAuth token (one of anthropicApiKey or anthropicOAuthToken required)
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
- `gitRepo`: Git repository URL to clone (SSH or HTTPS)
- `gitBranch`: Git branch to checkout (default: main)
- `gitDepth`: Clone depth for shallow cloning (default: 1)
- `environmentSecrets`: Object with environment variables as key-value pairs
- `sshKey`: SSH private key for git authentication (PEM format)
- `timeoutMinutes`: Process timeout in minutes (default: 55, max: 60)

**Async-Only Parameters (/run-async):**
- `callbackUrl` (required): Webhook URL to POST results when task completes
- `taskId`: Custom task ID (auto-generated UUID if not provided, must be URL-safe)
- `metadata`: Optional metadata object returned in callback payload

### Environment Variables
- `PORT`: Server port (default: 8080)
- `ALLOWED_TOOLS`: Default allowed tools list
- `PERMISSION_MODE`: Default permission mode
- `GCS_LOGS_BUCKET`: GCS bucket name for async task logs (required for /run-async)
- `GCS_PROJECT_ID`: Optional GCS project ID (defaults to default credentials)

## Important Implementation Details

### Concurrency Settings
- **CONCURRENCY=3**: Optimal for Claude workloads (1.3GB RAM, 0.66 CPU per request)
- Lower concurrency ensures adequate resources for AI code generation tasks
- Total capacity: 30 concurrent requests (10 instances × 3 each)

### Claude CLI Environment Setup (claude-runner.ts)
- Sets `CLAUDE_CODE_ACTION=1` to enable OAuth support
- Preserves HOME directory for Claude configuration access
- Uses token proxy to securely inject credentials (never exposes real tokens to Claude process)
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

## SSH Key and Environment Variable Management

The service uses a **payload-based approach** for SSH keys and environment variables, designed to work seamlessly with orchestration systems like Agent Forge.

### Payload-Based SSH Keys
SSH keys and environment variables are passed directly in the `/run` request payload:

```json
{
  "prompt": "Run tests and deploy",
  "gitRepo": "git@github.com:myorg/myrepo.git",
  "gitBranch": "main",
  "sshKey": "-----BEGIN OPENSSH PRIVATE KEY-----\n...\n-----END OPENSSH PRIVATE KEY-----",
  "environmentSecrets": {
    "DATABASE_URL": "postgres://...",
    "API_KEY": "sk-..."
  }
}
```

**How it works:**
- SSH keys are written to the ephemeral workspace at `{workspace}/.ssh/deploy_key` with secure permissions (0600)
- `GIT_SSH_COMMAND` is configured in Claude's environment to use the per-request SSH key
- HTTPS URLs are automatically converted to SSH format if an SSH key is provided
- Claude's git commands (clone, pull, push, etc.) automatically use the per-request SSH key
- Environment variables are injected into Claude's process and written to `.env` file
- All credentials are cleaned up automatically after request completion
- Each request has isolated credentials, preventing cross-contamination

**Benefits:**
- Dynamic per-request credentials from orchestration system
- No long-term storage of sensitive data in the service
- Better security isolation between repositories
- Git commands work seamlessly with per-request SSH keys
- Flexible credential management controlled by the caller

## Async Task Requirements

**For /run-async endpoint to work:**

1. **GCS Bucket Setup:**
   - Add `GCS_LOGS_BUCKET` to `.env` file
   - Run `./scripts/setup-project.sh` (safe on existing projects - it's idempotent)
   - This automatically creates bucket, sets lifecycle policy, grants permissions
   - Alternative: Manual setup via `gcloud storage buckets create` + `./scripts/setup-service-account.sh` (idempotent)
   - Example: `your-project-id-claude-logs`

2. **Redeploy Service:**
   - After setting `GCS_LOGS_BUCKET`, redeploy: `./scripts/deploy-service.sh`
   - Service validates bucket configuration on startup

3. **Lifecycle Policies (Included):**
   - `setup-project.sh` automatically sets 30-day auto-delete policy
   - Reduces storage costs
   - Logs stored at: `gs://bucket/sessions/{taskId}/`

See `docs/async-tasks.md` for detailed setup and usage guide.

## Common Issues

### Authentication
All authentication is handled via request payload (`anthropicApiKey` or `anthropicOAuthToken`). The service uses a token proxy to securely inject credentials without exposing them to the Claude CLI process.

### Process Timeouts
Claude processes have a configurable timeout (default 55 minutes, max 60 minutes per Cloud Run limits). Long-running tasks may need timeout adjustment via `timeoutMinutes` option.

### Named Pipe vs Direct Input
The service supports two prompt delivery methods:
- Named pipe (default): Better for large prompts, uses mkfifo
- Direct stdin: Simpler but may have issues with very large prompts

### Async Tasks Not Available
If `/run-async` returns error about missing `GCS_LOGS_BUCKET`:
1. Add `GCS_LOGS_BUCKET=your-project-id-claude-logs` to .env
2. Run `./scripts/setup-project.sh` (handles everything automatically)
3. Redeploy: `./scripts/deploy-service.sh`

Alternative manual approach:
- Create bucket: `gcloud storage buckets create gs://bucket-name`
- Grant permissions: `./scripts/setup-service-account.sh` (idempotent, safe to re-run)
- Redeploy: `./scripts/deploy-service.sh`