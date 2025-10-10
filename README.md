# Claude Code on Cloud Run

Production-ready deployment of Claude Code TypeScript SDK as a Cloud Run service with dynamic configuration for system prompts and tool permissions.

> **Note**: The Claude Code SDK is installed globally in the Docker container following the official Anthropic Docker setup pattern. This improves compatibility and reduces potential conflicts.

## Features

- ✅ Claude Code CLI integration (official distribution)
- ✅ API key authentication
- ✅ Hot-reloadable system prompts via Secret Manager
- ✅ Secure VPC egress with firewall rules
- ✅ Per-request ephemeral workspaces
- ✅ SSE streaming responses
- ✅ Tool permission controls

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
# One-time project setup (enables APIs, creates repository, sets IAM)
./scripts/setup-project.sh

# Deploy your service
./scripts/create-secrets.sh    # Create/update secrets in Secret Manager
./scripts/build-and-push.sh    # Build and push Docker image
./scripts/deploy-service.sh    # Deploy to Cloud Run

# Optional: Set up service account for production (after deployment)
./scripts/setup-service-account.sh    # Configure service account with Secret Manager access
./scripts/download-service-account-key.sh  # Download key for local testing (optional)

# Test the deployment
./scripts/test.sh remote
```

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
| `timeoutMinutes` | number | Process timeout in minutes | 55 |

### Environment Variables

**Service Configuration:**
- `PORT`: Server port (default: 8080)
- `ALLOWED_TOOLS`: Comma-separated list of allowed tools
- `PERMISSION_MODE`: Default permission mode (`acceptEdits`, `bypassPermissions`, `plan`)

**Authentication:**
- **IMPORTANT**: The service uses a **payload-based authentication model**
- API keys/OAuth tokens are passed in request payload, **not** as environment variables
- For local testing, you can optionally set `ANTHROPIC_API_KEY` environment variable

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

- `setup-project.sh` - One-time Google Cloud project setup (APIs, repository, IAM)
- `setup-service-account.sh` - Set up service account with Secret Manager access
- `download-service-account-key.sh` - Download service account key for local testing
- `create-secrets.sh` - Create/update optional Secret Manager secrets (for local testing)
- `build-and-push.sh` - Build and push Docker image to Artifact Registry
- `deploy-service.sh` - Deploy service to Cloud Run
- `setup-vpc.sh` - (Optional) Configure VPC network and firewall rules
- `load-env.sh` - Helper script to load environment variables

## Testing

- `test.sh` - Comprehensive test script for local and remote testing
  - `./scripts/test.sh auth` - Test authentication setup
  - `./scripts/test.sh local` - Test local development server
  - `./scripts/test.sh remote` - Test deployed Cloud Run service
  - `./scripts/test.sh examples` - Show API request examples

## Troubleshooting

### Known Issues

#### Claude Code SDK hanging in containers
- The SDK may timeout in containerized environments (Docker/Cloud Run)
- This is a known issue with the Claude Code SDK in non-interactive environments
- The service includes timeout handling (default 55 minutes, max 60 minutes per Cloud Run limits)
- Consider using the official Anthropic API SDK for production deployments if this persists

### Service not responding
- Check Cloud Run logs: `gcloud run services logs read qa-agent --region=us-central1`
- Verify secrets are mounted correctly
- Check VPC/firewall configuration

### Authentication errors
- Ensure `anthropicApiKey` or `anthropicOAuthToken` is included in the request payload
- For API keys: Obtain from https://console.anthropic.com/
- For OAuth tokens: Generate using `claude setup-token` command
- The service uses payload-based authentication, not environment variables

### Tool execution failures
- Verify tool permissions in ALLOWED_TOOLS
- Check permission mode settings
- Review container logs for specific errors

## License

This project follows the Claude Code SDK license terms.