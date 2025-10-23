# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

This is a Cloud Run service that wraps the Claude Code TypeScript SDK to provide a production-ready deployment with dynamic configuration for MCP servers, system prompts, and tool permissions.

**Execution Architecture:** The service uses a **Cloud Run Jobs architecture** where:
- API service (/run and /run-async endpoints) triggers Cloud Run Job executions
- Jobs run in isolated containers with ephemeral workspaces
- Credentials encrypted with Cloud KMS and securely passed to jobs
- All task execution happens in Cloud Run Jobs, not in the API service process

This architecture provides better resource isolation, improved security with KMS encryption, and eliminates the need for CPU-always-allocated billing.

## Documentation Guides

This repository includes comprehensive documentation:
- **README.md**: Project overview, features, quick start, and API usage examples
- **docs/deployment.md**: Detailed step-by-step deployment guide with all necessary commands
- **docs/testing.md**: Complete testing guide with local and remote testing instructions
- **docs/api-reference.md**: Complete API reference for /run and /run-async endpoints
- **docs/async-tasks.md**: Comprehensive guide for async task execution with GCS logging
- **docs/cloud-run-jobs.md**: Cloud Run Jobs architecture and execution model
- **docs/kms-setup.md**: Cloud KMS setup for secure credential handling
- **docs/post-execution-actions.md**: Git operations and file upload automation
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

**API Service (Cloud Run Service):**
- **src/server.ts**: Express server handling /run and /run-async endpoints, triggers Cloud Run Jobs
- **src/api/controllers/claude.controller.ts**: Sync endpoint controller - triggers job and streams logs via SSE
- **src/api/controllers/async-claude.controller.ts**: Async endpoint controller - triggers job and returns immediately
- **src/api/controllers/cancel.controller.ts**: Task cancellation and status endpoints
- **src/api/services/job-trigger.service.ts**: Triggers Cloud Run Job executions via Cloud Run Admin API
- **src/api/services/encryption.service.ts**: Cloud KMS integration for encrypting/decrypting task payloads
- **src/api/services/gcs.service.ts**: GCS operations - logs, encrypted payloads, file uploads

**Job Worker (Cloud Run Job):**
- **src/job-worker.ts**: Job entrypoint - reads encrypted payload, decrypts, executes task
- **src/api/services/task.service.ts**: Task execution service (used only by job worker)
- **src/api/services/git.service.ts**: Git operations - clone, commit, push
- **src/api/services/output-handlers.ts**: Output handler pattern (SSE vs GCS)
- **src/claude-runner.ts**: Manages Claude CLI subprocess spawning with two execution modes (named pipe or direct stdin)

**Shared:**
- **Dockerfile**: Multi-stage build installing Claude Code via official script, runs as non-root user

### Request Flow (Sync - /run)
1. Client sends POST to /run with prompt and configuration
2. API service validates request and generates task ID
3. API service encrypts payload with Cloud KMS and stores in GCS
4. API service triggers Cloud Run Job execution with task ID
5. Job worker starts:
   - Reads encrypted payload from GCS
   - Decrypts payload using Cloud KMS
   - Creates ephemeral workspace in /tmp
   - Executes Claude Code CLI via TaskService
   - Streams output to GCS
6. API service polls GCS logs and streams to client via SSE
7. On completion, job worker cleans up workspace and exits
8. API service sends final SSE event and closes connection

### Request Flow (Async - /run-async)
1. Client sends POST to /run-async with prompt, callbackUrl, configuration
2. API service validates request and generates task ID
3. API service encrypts payload with Cloud KMS and stores in GCS
4. API service triggers Cloud Run Job execution with task ID
5. API service returns 202 Accepted immediately with task ID and logs path
6. Job worker executes asynchronously:
   - Reads encrypted payload from GCS
   - Decrypts payload using Cloud KMS
   - Creates ephemeral workspace in /tmp
   - Executes Claude Code CLI via TaskService
   - Streams output to GCS in real-time
   - Executes post-execution actions (git commit/push, file uploads) if configured
   - Calls webhook with results and metadata
   - Cleans up workspace and exits
7. Logs persist in GCS at `gs://bucket/sessions/{taskId}/`
8. Encrypted payload deleted after execution

### Key Design Decisions
- **Cloud Run Jobs Architecture**: All task execution happens in isolated Cloud Run Job containers, not in API service
- **KMS Encryption**: Task payloads encrypted with Cloud KMS before storage, decrypted in job worker
- **Ephemeral Workspaces**: Each request gets isolated /tmp/ws-{requestId} directory in job container
- **Two Execution Modes**: Named pipe method (better for large prompts) or direct stdin
- **Output Handler Pattern**: SSE for sync (via GCS polling), GCS streaming for async (strategy pattern)
- **Chunked GCS Writes**: Logs buffered and written in 100-line chunks to minimize GCS operations
- **Global Claude Installation**: Claude Code installed globally in Docker following official pattern
- **Dynamic Configuration**: MCP servers, system prompts, tools configured per-request
- **Authentication**: Payload-based authentication with token proxy for security
- **Job-Based Isolation**: No CPU-always-allocated needed, better resource isolation, independent scaling
- **Post-Execution Actions**: Git operations and file uploads executed automatically after task completion
- **Git Service**: Comprehensive git operations with identity configuration from .gitconfig

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
- `mcpConfig`: MCP server configuration object (see Enhanced Configuration below)
- `slashCommands`: Custom slash commands configuration (see Enhanced Configuration below)
- `subagents`: Custom subagents configuration (see Enhanced Configuration below)
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
- `postExecutionActions`: Post-execution actions to perform after task completes (see below)

**Post-Execution Actions (async only):**
```json
{
  "postExecutionActions": {
    "git": {
      "commit": true,                  // Create git commit
      "commitMessage": "...",          // Custom commit message (optional)
      "push": true,                    // Push to remote
      "branch": "main",                // Branch to push to (default: main)
      "files": ["src/**"]              // Specific files to commit (optional)
    },
    "uploadFiles": {
      "globPatterns": ["*.log", "dist/**"],  // Files to upload to GCS
      "gcsPrefix": "optional/prefix"          // Optional prefix in GCS bucket
    }
  }
}
```

When configured:
- Git operations execute after task completion if changes detected
- Files matching glob patterns uploaded to task's GCS session path
- Results included in webhook callback (`gitCommit` and `uploadedFiles` fields)
- Git identity read from `.gitconfig` file in repository or uses defaults
- **Dynamic config files (.mcp.json, .claude/commands/, .claude/agents/) are automatically excluded from commits**

### Enhanced Configuration (MCP Servers, Slash Commands, Subagents)

The service supports payload-based configuration of MCP servers, custom slash commands, and subagents. These are written to the workspace before Claude Code execution and automatically excluded from git commits.

**MCP Servers (`mcpConfig`):**
```json
{
  "mcpConfig": {
    "mcpServers": {
      "github": {
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-github"],
        "env": {
          "GITHUB_TOKEN": "${GITHUB_TOKEN}"
        }
      },
      "postgres": {
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-postgres"],
        "env": {
          "DATABASE_URL": "${DATABASE_URL}"
        }
      }
    }
  }
}
```

- Accepts raw `.mcp.json` format - just pass the exact JSON you'd put in `.mcp.json`
- Environment variables expanded from `environmentSecrets` using `${VAR}` syntax
- No transformation needed - what you send is what gets written

**Slash Commands (`slashCommands`):**
```json
{
  "slashCommands": {
    "deploy-staging": {
      "frontmatter": {
        "description": "Deploy to staging environment",
        "allowed-tools": "Bash",
        "model": "sonnet"
      },
      "content": "Deploy to staging:\n1. Run tests\n2. Build\n3. Deploy to GCP"
    },
    "review-pr": {
      "frontmatter": {
        "description": "Comprehensive PR review",
        "argument-hint": "[pr-number]"
      },
      "content": "Review PR #$1:\n- Code quality\n- Security\n- Performance"
    }
  }
}
```

- Creates `.claude/commands/{name}.md` files with YAML frontmatter
- Frontmatter accepts any valid Claude Code slash command fields
- Supports arguments via `$1`, `$2`, or `$ARGUMENTS`
- Flexible structure - add any frontmatter fields you need

**Subagents (`subagents`):**
```json
{
  "subagents": {
    "security-auditor": {
      "frontmatter": {
        "name": "security-auditor",
        "description": "Security expert for auditing code",
        "tools": "Read, Grep, Bash(npm audit:*)",
        "model": "opus"
      },
      "content": "You are a security expert..."
    },
    "deployment-specialist": {
      "frontmatter": {
        "name": "deployment-specialist",
        "description": "Deployment and DevOps expert",
        "tools": "Bash, Read, Write"
      },
      "content": "You are a DevOps specialist..."
    }
  }
}
```

- Creates `.claude/agents/{name}.md` files with YAML frontmatter
- Frontmatter accepts any valid Claude Code subagent fields
- Name and description typically required for automatic invocation
- Flexible structure - add any frontmatter fields you need

**Git Commit Exclusion:**
When `postExecutionActions.git.commit` is configured without explicit `files` list, dynamically created config files are automatically excluded from commits. Only actual code changes made by Claude are committed.

**Override Behavior:**
If repository already contains `.mcp.json`, `.claude/commands/`, or `.claude/agents/`, payload configurations take precedence during execution but won't be committed.

### Environment Variables

**Required for Both Endpoints:**
- `GCS_LOGS_BUCKET`: GCS bucket name for task logs and encrypted payloads (required for both /run and /run-async)
- `KMS_KEY_RING`: Cloud KMS key ring name (created by setup-kms.sh)
- `KMS_KEY_NAME`: Cloud KMS key name (created by setup-kms.sh)
- `KMS_LOCATION`: Cloud KMS location (default: global)
- `CLOUDRUN_JOB_NAME`: Name of the Cloud Run Job (created by deploy-job.sh)

**Optional:**
- `PORT`: Server port (default: 8080)
- `ALLOWED_TOOLS`: Default allowed tools list
- `PERMISSION_MODE`: Default permission mode (acceptEdits, bypassPermissions, plan)
- `GCS_PROJECT_ID`: Optional GCS project ID (defaults to default credentials)
- `CLOUDRUN_CALLBACK_SECRET`: Secret for HMAC webhook authentication (required for /run-async callbacks)
- `LOG_LEVEL`: Log verbosity (info, debug)
- `MAX_CONCURRENT_TASKS`: Maximum concurrent tasks (default: 1)

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

## Cloud Run Jobs Architecture Requirements

**IMPORTANT:** Both `/run` and `/run-async` endpoints now use Cloud Run Jobs. The following setup is **required for all endpoints:**

### 1. GCS Bucket Setup
- Add `GCS_LOGS_BUCKET=your-project-id-claude-logs` to `.env` file
- Run `./scripts/setup-project.sh` (safe on existing projects - it's idempotent)
- This automatically creates bucket, sets lifecycle policy, grants permissions
- Logs and encrypted payloads stored at: `gs://bucket/sessions/{taskId}/`

### 2. Cloud KMS Setup
- Run `./scripts/setup-kms.sh` to create KMS keyring and key
- This is required for encrypting task payloads before job execution
- Updates `.env` with `KMS_KEY_RING`, `KMS_KEY_NAME`, `KMS_LOCATION`
- Grants API service permission to encrypt/decrypt

### 3. Cloud Run Job Deployment
- Run `./scripts/deploy-job.sh` to create the Cloud Run Job
- Job uses the same Docker image as the API service
- Runs `job-worker.ts` entrypoint instead of `server.ts`
- Updates `.env` with `CLOUDRUN_JOB_NAME`

### 4. IAM Permissions
- Run `./scripts/grant-job-permissions.sh` to grant necessary permissions
- API service needs: `run.jobs.run`, `cloudkms.cryptoKeyVersions.useToEncrypt`, `cloudkms.cryptoKeyVersions.useToDecrypt`
- Job worker needs: `storage.objects.get`, `storage.objects.create`, `cloudkms.cryptoKeyVersions.useToDecrypt`

### 5. Webhook Security (for /run-async only)
- Generate a strong secret: `openssl rand -hex 32`
- Add `CLOUDRUN_CALLBACK_SECRET` to `.env` file
- Run `./scripts/create-secrets.sh` to create the secret in Secret Manager
- Used for HMAC-SHA256 webhook authentication

### 6. Deploy API Service
- Run `./scripts/deploy-service.sh` to deploy the API service
- Service validates all required environment variables on startup
- Mounts webhook secret from Secret Manager if configured

**Webhook Security:**
When task completes, the service POSTs to your callback URL with HMAC authentication headers:
- `X-Webhook-Signature`: HMAC-SHA256 signature (format: `sha256={hex}`)
- `X-Webhook-Timestamp`: Unix timestamp when signature was generated
- Your webhook handler should verify the signature to ensure authenticity

See `docs/async-tasks.md` for detailed setup, usage guide, and webhook signature verification examples.

## Common Issues

### Missing Required Environment Variables
If endpoints return errors about missing environment variables:
1. Ensure `GCS_LOGS_BUCKET` is set in `.env` (required for both /run and /run-async)
2. Ensure KMS variables are set: `KMS_KEY_RING`, `KMS_KEY_NAME`, `KMS_LOCATION`
3. Ensure `CLOUDRUN_JOB_NAME` is set
4. Run `./scripts/setup-kms.sh` if KMS not configured
5. Run `./scripts/deploy-job.sh` if Cloud Run Job not deployed
6. Redeploy API service: `./scripts/deploy-service.sh`

### Cloud Run Job Not Found
If API service returns "Cloud Run Job not found":
1. Verify job exists: `gcloud run jobs list --region=us-central1`
2. Check `CLOUDRUN_JOB_NAME` matches deployed job name
3. Redeploy job: `./scripts/deploy-job.sh`
4. Ensure job service account has proper permissions: `./scripts/grant-job-permissions.sh`

### KMS Permission Denied
If you see "Permission denied" errors related to KMS:
1. Run `./scripts/grant-job-permissions.sh` to grant permissions
2. Verify KMS key exists: `gcloud kms keys list --location=global --keyring=claude-code`
3. Check service account has `cloudkms.cryptoKeyVersions.useToEncrypt` and `useToDecrypt` roles

### Job Execution Failures
If jobs fail to execute or timeout:
1. Check job logs: `gcloud run jobs executions logs read JOB_EXECUTION_NAME --region=us-central1`
2. Verify job has enough memory/CPU (configured in deploy-job.sh)
3. Check encrypted payload exists in GCS
4. Ensure job timeout is sufficient (default: 60 minutes)

### Authentication
All authentication is handled via request payload (`anthropicApiKey` or `anthropicOAuthToken`). The service uses a token proxy to securely inject credentials without exposing them to the Claude CLI process.

### Process Timeouts
Claude processes have a configurable timeout (default 55 minutes, max 60 minutes per Cloud Run limits). Long-running tasks may need timeout adjustment via `timeoutMinutes` option.

### Named Pipe vs Direct Input
The service supports two prompt delivery methods:
- Named pipe (default): Better for large prompts, uses mkfifo
- Direct stdin: Simpler but may have issues with very large prompts

### Git Operations Fail
If git commit/push operations fail:
1. Ensure `.gitconfig` file exists in repository root with user name and email
2. Verify SSH key is provided in request payload for private repos
3. Check git operations logs in GCS session logs
4. Ensure workspace has git changes before commit