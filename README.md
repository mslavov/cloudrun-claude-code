# Claude Code on Cloud Run

Production-ready deployment of Claude Code TypeScript SDK as a Cloud Run service with dynamic configuration for system prompts and tool permissions.

**Execution Architecture:** The service uses a **Cloud Run Jobs architecture** where API requests trigger isolated job executions. All task execution happens in Cloud Run Job containers with Cloud KMS encryption for secure credential handling. This architecture provides better resource isolation, improved security, and eliminates CPU-always-allocated billing.

> **Note**: The Claude Code SDK is installed globally in the Docker container following the official Anthropic Docker setup pattern. This improves compatibility and reduces potential conflicts.

## Features

- ✅ **Cloud Run Jobs Architecture** - All tasks execute in isolated job containers
- ✅ **Cloud KMS Encryption** - Secure credential handling with encrypted payloads
- ✅ Claude Code CLI integration (official distribution)
- ✅ API key authentication
- ✅ Async task execution with GCS logging
- ✅ **Post-execution actions** - Automated git commits/pushes and file uploads
- ✅ **Git operations** - Comprehensive git service with identity configuration
- ✅ Hot-reloadable system prompts via Secret Manager
- ✅ Secure VPC egress with firewall rules
- ✅ Per-request ephemeral workspaces
- ✅ SSE streaming responses (sync) + GCS logs (async)
- ✅ Tool permission controls
- ✅ Webhook callbacks for async tasks with HMAC authentication

## Quick Start

### Prerequisites

- Google Cloud Project with billing enabled
- `gcloud` CLI installed and configured
- Docker (for local testing)
- Node.js 20+
- Anthropic API key (from https://console.anthropic.com/)

### 1. Get Anthropic API Key

The service requires API keys to be passed in each request payload (not as environment variables). Get your API key:

```bash
# Get your API key from https://console.anthropic.com/
# You'll pass this key in the request payload

# For local testing, you can set it as an environment variable
export ANTHROPIC_API_KEY=sk-ant-...

# OR use OAuth token from Claude subscription
# Generate OAuth token using Claude Code CLI
npm install -g @anthropic-ai/claude-code
claude setup-token
export CLAUDE_CODE_OAUTH_TOKEN=<your-token>
```

**Important:** The service uses a **payload-based authentication model**. API keys/OAuth tokens must be included in each request's JSON payload for security isolation.

### 2. Set up environment variables

```bash
# Copy and configure the environment file
cp .env.example .env

# Edit .env with your configuration
vim .env
# Set PROJECT_ID and your chosen authentication method
```


### 3. Deploy to Cloud Run

```bash
# One-time project setup (enables APIs, creates repository, sets IAM, GCS bucket)
./scripts/setup-project.sh

# Set up Cloud KMS for credential encryption (required for Cloud Run Jobs)
./scripts/setup-kms.sh

# Build and push Docker image
./scripts/build-and-push.sh

# Deploy Cloud Run Job (executes tasks in isolated containers)
./scripts/deploy-job.sh

# Grant IAM permissions for jobs and KMS
./scripts/grant-job-permissions.sh

# Deploy API service (triggers jobs)
./scripts/deploy-service.sh

# Set up service account for production (after deployment)
./scripts/setup-service-account.sh    # Configure service account (idempotent, safe to re-run)
./scripts/download-service-account-key.sh  # Download key for local testing (optional)

# Test the deployment
./scripts/test.sh remote
```

**Important:** The service now uses Cloud Run Jobs for all task execution. Both `/run` and `/run-async` endpoints require KMS and Cloud Run Job setup.

## API Usage

### Health Check

```bash
# Simple health check (for monitoring)
curl https://your-service-url/health
# Returns: ok

# Verbose health check with SDK verification
curl https://your-service-url/health?verbose=true
# Returns JSON with server status, auth config, and SDK health

# Note: Both /health and /healthz endpoints work identically
```

### Run Agent

**IMPORTANT:** All requests must include either `anthropicApiKey` or `anthropicOAuthToken` in the request payload.

```bash
# Basic request with API key
curl -N -X POST https://your-service-url/run \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $(gcloud auth print-identity-token)" \
  -d '{
    "prompt": "Generate a test plan for login functionality",
    "anthropicApiKey": "sk-ant-your-key-here",
    "maxTurns": 6
  }'

# With OAuth token (from Claude subscription)
curl -N -X POST https://your-service-url/run \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $(gcloud auth print-identity-token)" \
  -d '{
    "prompt": "Generate a test plan for login functionality",
    "anthropicOAuthToken": "your-oauth-token-here",
    "maxTurns": 6
  }'

# With custom system prompt and tools
curl -N -X POST https://your-service-url/run \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $(gcloud auth print-identity-token)" \
  -d '{
    "prompt": "Review the code and suggest improvements",
    "anthropicApiKey": "sk-ant-your-key-here",
    "systemPrompt": "You are a code reviewer focusing on best practices",
    "allowedTools": ["Read", "Write", "Grep"],
    "permissionMode": "acceptEdits",
    "maxTurns": 6
  }'

# With specific model and environment variables
curl -N -X POST https://your-service-url/run \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $(gcloud auth print-identity-token)" \
  -d '{
    "prompt": "Analyze this codebase for security issues",
    "anthropicApiKey": "sk-ant-your-key-here",
    "model": "claude-3-5-sonnet-20241022",
    "allowedTools": ["Read", "Grep"],
    "disallowedTools": ["Write", "Bash"],
    "appendSystemPrompt": "Focus on OWASP top 10 vulnerabilities",
    "maxTurns": 10,
    "environmentSecrets": {
      "DATABASE_URL": "postgres://...",
      "API_KEY": "..."
    }
  }'
```

### Async Task Execution

For long-running tasks, use the `/run-async` endpoint which returns immediately and executes in the background:

```bash
# Create async task with callback URL
curl -X POST https://your-service-url/run-async \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $(gcloud auth print-identity-token)" \
  -d '{
    "prompt": "Analyze this large codebase and generate a comprehensive report",
    "anthropicApiKey": "sk-ant-your-key-here",
    "callbackUrl": "https://your-app.com/webhook/claude-task-complete",
    "gitRepo": "https://github.com/your-org/your-repo",
    "maxTurns": 20,
    "metadata": {
      "requestId": "task-123",
      "userId": "user-456"
    }
  }'

# Response (202 Accepted - task started):
{
  "taskId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "pending",
  "logsPath": "gs://your-logs-bucket/sessions/550e8400-e29b-41d4-a716-446655440000/",
  "createdAt": "2025-01-10T12:34:56.789Z"
}

# When task completes, POST callback to your webhook with HMAC authentication:
# Headers:
#   X-Webhook-Signature: sha256=<hmac-signature>
#   X-Webhook-Timestamp: <unix-timestamp>
#   Content-Type: application/json
# Body:
{
  "taskId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "completed",
  "exitCode": 0,
  "logsPath": "gs://your-logs-bucket/sessions/550e8400-e29b-41d4-a716-446655440000/",
  "summary": {
    "durationMs": 45000,
    "turns": 15,
    "errors": 0,
    "startedAt": "2025-01-10T12:34:56.789Z",
    "completedAt": "2025-01-10T12:35:41.789Z"
  },
  "metadata": {
    "requestId": "task-123",
    "userId": "user-456"
  },
  "uploadedFiles": [  # If postExecutionActions.uploadFiles was configured
    {
      "originalPath": "coverage/report.html",
      "gcsPath": "gs://bucket/sessions/TASK_ID/uploads/coverage/report.html",
      "sizeBytes": 12345
    }
  ],
  "gitCommit": {  # If postExecutionActions.git was configured
    "sha": "abc123def456",
    "message": "Task execution 550e8400...",
    "pushed": true,
    "branch": "main"
  }
}

# View logs from GCS
gcloud storage cat gs://your-logs-bucket/sessions/TASK_ID/*.jsonl
```

**Async Task Requirements:**
- `GCS_LOGS_BUCKET` environment variable must be set in Cloud Run
- `CLOUDRUN_CALLBACK_SECRET` must be set for webhook HMAC authentication
- Service account needs `roles/storage.objectAdmin` on the GCS bucket
- Run `./scripts/create-secrets.sh` to create the webhook secret
- Run `./scripts/setup-service-account.sh` to grant storage permissions

**Webhook Security:**
The service signs webhook callbacks with HMAC-SHA256. Your webhook handler should verify the signature to ensure authenticity. See `docs/async-tasks.md` for signature verification examples.

See `examples/` folder for more request examples.

## Configuration Options

### Request Parameters

| Parameter | Type | Description | Default |
|-----------|------|-------------|---------|
| `prompt` | string | **Required** The prompt for Claude | - |
| `anthropicApiKey` | string | **Required** Anthropic API key (from console.anthropic.com) | - |
| `anthropicOAuthToken` | string | **Alternative** OAuth token (from Claude subscription) | - |
| `systemPrompt` | string | Custom system prompt to replace the default | - |
| `appendSystemPrompt` | string | Text to append to the system prompt | - |
| `allowedTools` | string[] | List of allowed tools | Env var |
| `disallowedTools` | string[] | List of tools to explicitly block | - |
| `permissionMode` | string | Permission mode (`acceptEdits`, `bypassPermissions`, `plan`) | Env var |
| `maxTurns` | number | Maximum conversation turns | 6 |
| `cwdRelative` | string | Working directory path | "." |
| `model` | string | Specific Claude model to use | - |
| `fallbackModel` | string | Fallback model if primary fails | - |
| `useNamedPipe` | boolean | Use named pipe for prompt delivery (better for large prompts) | true |
| `gitRepo` | string | Git repository URL to clone (SSH or HTTPS) | - |
| `gitBranch` | string | Branch to checkout | "main" |
| `gitDepth` | number | Clone depth for shallow cloning | 1 |
| `sshKey` | string | SSH private key for git authentication (PEM format) | - |
| `environmentSecrets` | object | Environment variables as key-value pairs | {} |
| `timeoutMinutes` | number | Process timeout in minutes (max 1440 / 24 hours) | 55 |
| `callbackUrl` | string | Webhook URL for async task completion (required for `/run-async`) | - |
| `taskId` | string | Custom task ID (auto-generated if not provided, for `/run-async`) | - |
| `metadata` | object | Custom metadata returned in callback (for `/run-async`) | - |
| `postExecutionActions` | object | Post-execution actions (git, file uploads) for `/run-async` only | - |

### Environment Variables

**Required (Cloud Run Jobs Architecture):**
- `GCS_LOGS_BUCKET`: GCS bucket name for task logs and encrypted payloads (required for both /run and /run-async)
- `KMS_KEY_RING`: Cloud KMS key ring name (created by setup-kms.sh)
- `KMS_KEY_NAME`: Cloud KMS key name (created by setup-kms.sh)
- `KMS_LOCATION`: Cloud KMS location (default: global)
- `CLOUDRUN_JOB_NAME`: Name of the Cloud Run Job (created by deploy-job.sh)

**Optional:**
- `PORT`: Server port (default: 8080)
- `ALLOWED_TOOLS`: Comma-separated list of allowed tools
- `PERMISSION_MODE`: Default permission mode (`acceptEdits`, `bypassPermissions`, `plan`)
- `GCS_PROJECT_ID`: Optional GCS project ID (defaults to default credentials)
- `CLOUDRUN_CALLBACK_SECRET`: Secret for HMAC webhook authentication (required for /run-async)
- `LOG_LEVEL`: Log verbosity (info, debug)
- `MAX_CONCURRENT_TASKS`: Maximum concurrent tasks (default: 1)

**Authentication:**
- **IMPORTANT**: The service uses a **payload-based authentication model**
- API keys/OAuth tokens are passed in request payload, **not** as environment variables
- For local testing, you can optionally set `ANTHROPIC_API_KEY` environment variable

**Cloud Run Jobs Architecture (Required for All Endpoints):**
- Both `/run` and `/run-async` now use Cloud Run Jobs for task execution
- Requires `GCS_LOGS_BUCKET` for logs and encrypted payloads
- Requires Cloud KMS setup for credential encryption (`./scripts/setup-kms.sh`)
- Requires Cloud Run Job deployment (`./scripts/deploy-job.sh`)
- Run `./scripts/grant-job-permissions.sh` to grant IAM permissions

**Async Tasks (Additional Requirements):**
- Requires `CLOUDRUN_CALLBACK_SECRET` for webhook authentication (generate with `openssl rand -hex 32`)
- Run `./scripts/create-secrets.sh` to create webhook secret in Secret Manager
- Service account needs `roles/storage.objectAdmin` on the GCS bucket

**Git Repository Support:**
- SSH keys are passed in request payload via the `sshKey` parameter
- Per-request isolation ensures credentials are never shared between requests
- See Git Repository Setup section for details

### Tool Permissions

Examples:
- `Read,Write,Grep` - Basic file operations
- `Bash(npm run test:*)` - Restricted bash commands
- `WebSearch` - Web search capability
- `WebFetch` - Web content fetching

## Git Repository Setup

The service can clone and work with git repositories during request execution. This is useful for analyzing codebases, running tests, or making changes to existing projects.

### SSH Key Management

The service uses a **payload-based approach** for SSH keys, designed to work seamlessly with orchestration systems:

**Per-Request SSH Keys**: SSH keys are passed directly in the `/run` request payload for maximum security and flexibility:

```json
{
  "prompt": "Run tests and deploy",
  "anthropicApiKey": "sk-ant-...",
  "gitRepo": "git@github.com:myorg/myrepo.git",
  "gitBranch": "main",
  "sshKey": "-----BEGIN OPENSSH PRIVATE KEY-----\n...\n-----END OPENSSH PRIVATE KEY-----"
}
```

**How it works:**
- SSH keys are written to the ephemeral workspace at `{workspace}/.ssh/deploy_key` with secure permissions (0600)
- `GIT_SSH_COMMAND` is configured in Claude's environment to use the per-request SSH key
- HTTPS URLs are automatically converted to SSH format if an SSH key is provided
- Claude's git commands (clone, pull, push, etc.) automatically use the per-request SSH key
- All credentials are cleaned up automatically after request completion
- Each request has isolated credentials, preventing cross-contamination

### Environment Variables with Repositories

When working with repositories, you can pass environment variables directly in the request:

```bash
curl -N -X POST https://your-service-url/run \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $(gcloud auth print-identity-token)" \
  -d '{
    "prompt": "Run tests with production config",
    "anthropicApiKey": "sk-ant-...",
    "gitRepo": "git@github.com:myorg/myrepo.git",
    "sshKey": "-----BEGIN OPENSSH PRIVATE KEY-----\n...",
    "environmentSecrets": {
      "DATABASE_URL": "postgres://...",
      "API_KEY": "sk-..."
    }
  }'
```

Environment variables are:
- Injected into Claude's process environment
- Written to a `.env` file in the workspace
- Cleaned up automatically after request completion
- Isolated per request for security

### Using Git Repositories in Requests

You can clone repositories in your requests by providing the necessary credentials:

```bash
# Clone and analyze a private repository
curl -N -X POST https://your-service-url/run \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $(gcloud auth print-identity-token)" \
  -d '{
    "prompt": "Analyze the codebase and suggest improvements",
    "anthropicApiKey": "sk-ant-...",
    "gitRepo": "git@github.com:your-org/private-repo.git",
    "gitBranch": "develop",
    "gitDepth": 10,
    "sshKey": "-----BEGIN OPENSSH PRIVATE KEY-----\n...",
    "allowedTools": ["Read", "Grep", "Bash"]
  }'

# Work with a specific branch and environment
curl -N -X POST https://your-service-url/run \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $(gcloud auth print-identity-token)" \
  -d '{
    "prompt": "Run the test suite and fix any failing tests",
    "anthropicApiKey": "sk-ant-...",
    "gitRepo": "git@github.com:your-org/app.git",
    "gitBranch": "staging",
    "sshKey": "-----BEGIN OPENSSH PRIVATE KEY-----\n...",
    "environmentSecrets": {
      "DATABASE_URL": "postgres://staging...",
      "API_KEY": "staging-key"
    },
    "allowedTools": ["Read", "Write", "Edit", "Bash"]
  }'
```

## Security Considerations

1. **Payload-Based Authentication**: API keys and OAuth tokens passed in request payload, not environment variables
2. **Payload-Based SSH Keys**: SSH keys passed in request payload for per-request isolation
3. **Token Proxy**: Service uses a proxy to prevent Claude from accessing real API credentials
4. **User Isolation**: Separate users (serveruser/claudeuser) in Docker for code/runtime isolation
5. **Ephemeral Workspaces**: Each request gets isolated `/tmp` workspace with automatic cleanup
6. **Credential Isolation**: All credentials (API keys, SSH keys, env vars) are per-request and isolated
7. **Git Command Security**: Claude's git commands use per-request SSH keys via GIT_SSH_COMMAND
8. **Network Isolation**: Use Direct VPC egress with firewall rules
9. **Tool Restrictions**: Carefully configure allowed tools
10. **Permission Mode**: Start with `acceptEdits` for safety
11. **Concurrency Limits**: CONCURRENCY=1 ensures process isolation between requests

## Local Development

```bash
# Install dependencies
npm install

# Install Claude Code SDK globally for local development
npm install -g @anthropic-ai/claude-code

# Run development server
npm run dev

# Build TypeScript
npm run build

# Run production server
npm start
```

### Docker Build

The Dockerfile installs Claude CLI globally following the official pattern:
- Claude Code CLI is installed as a global npm package
- A proper non-root user with home directory is created for CLI compatibility
- The container runs the Claude CLI directly as a subprocess

## Deployment Scripts

All deployment scripts are in the `scripts/` folder:

- `setup-project.sh` - One-time Google Cloud project setup (APIs, repository, IAM, GCS bucket)
- `setup-kms.sh` - Set up Cloud KMS for credential encryption (required for Cloud Run Jobs)
- `build-and-push.sh` - Build and push Docker image to Artifact Registry
- `deploy-job.sh` - Deploy Cloud Run Job for task execution
- `grant-job-permissions.sh` - Grant IAM permissions for jobs and KMS
- `deploy-service.sh` - Deploy API service to Cloud Run
- `setup-service-account.sh` - Set up service account with permissions (idempotent, safe to re-run)
- `download-service-account-key.sh` - Download service account key for local testing
- `create-secrets.sh` - Create secrets in Secret Manager (webhook secret)
- `load-env.sh` - Helper script to load environment variables
- `project.sh` - Manage multiple GCP projects

## Testing

- `test.sh` - Comprehensive test script for local and remote testing
  - `./scripts/test.sh auth` - Test authentication setup
  - `./scripts/test.sh local` - Test local development server
  - `./scripts/test.sh remote` - Test deployed Cloud Run service
  - `./scripts/test.sh remote-async` - Test async task execution on Cloud Run
  - `./scripts/test.sh examples` - Show API request examples
  - `./scripts/test.sh all` - Run all tests

## Troubleshooting

### Missing Required Environment Variables
If endpoints return errors about missing environment variables:
1. Ensure `GCS_LOGS_BUCKET` is set (required for both /run and /run-async)
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
4. Ensure job timeout is sufficient (Cloud Run Jobs support up to 24 hours)

### Authentication Errors
- Ensure `anthropicApiKey` or `anthropicOAuthToken` is included in the request payload
- For API keys: Obtain from https://console.anthropic.com/
- For OAuth tokens: Generate using `claude setup-token` command
- The service uses payload-based authentication, not environment variables

### Git Operations Fail
If git commit/push operations fail:
1. Ensure `.gitconfig` file exists in repository root with user name and email
2. Verify SSH key is provided in request payload for private repos
3. Check git operations logs in GCS session logs
4. Ensure workspace has git changes before commit

### Known Issues

#### Claude Code SDK hanging in containers
- The SDK may timeout in containerized environments (Docker/Cloud Run)
- This is a known issue with the Claude Code SDK in non-interactive environments
- The service includes timeout handling (default 55 minutes, max 1440 minutes / 24 hours per Cloud Run Jobs limits)
- Consider using the official Anthropic API SDK for production deployments if this persists

### Service not responding
- Check Cloud Run logs: `gcloud run services logs read qa-agent --region=us-central1`
- Verify secrets are mounted correctly
- Check VPC/firewall configuration

## License

This project follows the Claude Code SDK license terms.