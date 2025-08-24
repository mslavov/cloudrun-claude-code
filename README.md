# Claude Code on Cloud Run

Production-ready deployment of Claude Code TypeScript SDK as a Cloud Run service with dynamic configuration for MCP servers, system prompts, and tool permissions.

> **Note**: The Claude Code SDK is installed globally in the Docker container following the official Anthropic Docker setup pattern. This improves compatibility and reduces potential conflicts.

## Features

- ✅ Claude Code CLI integration (official distribution)
- ✅ API key authentication
- ✅ Dynamic MCP server configuration
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

### 1. Authentication Setup

Choose one of the following authentication methods:

#### API Keys
```bash
# Get your API key from https://console.anthropic.com/
export ANTHROPIC_API_KEY=sk-ant-...
```

#### OAuth Tokens
```bash
# Generate OAuth token using Claude Code CLI
npm install -g @anthropic-ai/claude-code
claude setup-token

# Set the token for the service
export CLAUDE_CODE_OAUTH_TOKEN=<your-token>
```

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

```bash
# Simple request (uses default config from .env)
curl -N -X POST https://your-service-url/run \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $(gcloud auth print-identity-token)" \
  -d '{
    "prompt": "Generate a test plan for login functionality",
    "maxTurns": 6
  }'

# With dynamic MCP configuration (passed per-request)
curl -N -X POST https://your-service-url/run \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $(gcloud auth print-identity-token)" \
  -d '{
    "prompt": "Review the latest PRs and suggest tests",
    "systemPrompt": "You are a QA engineer",
    "allowedTools": ["Read", "Write", "Grep"],
    "permissionMode": "acceptEdits",
    "maxTurns": 6,
    "mcpConfigJson": {
      "mcpServers": {
        "github": {
          "type": "stdio",
          "command": "npx",
          "args": ["@modelcontextprotocol/server-github@latest"],
          "env": {"GITHUB_TOKEN": "ghp_your_token_here"}
        }
      }
    }
  }'

# With specific model and disallowed tools
curl -N -X POST https://your-service-url/run \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $(gcloud auth print-identity-token)" \
  -d '{
    "prompt": "Analyze this codebase for security issues",
    "model": "claude-3-5-sonnet-20241022",
    "allowedTools": ["Read", "Grep"],
    "disallowedTools": ["Write", "Bash"],
    "appendSystemPrompt": "Focus on OWASP top 10 vulnerabilities",
    "maxTurns": 10,
    "useNamedPipe": false
  }'
```

See `examples/` folder for more request examples.

## Configuration Options

### Request Parameters

| Parameter | Type | Description | Default |
|-----------|------|-------------|---------|
| `prompt` | string | **Required** The prompt for Claude | - |
| `systemPrompt` | string | Custom system prompt to replace the default | - |
| `appendSystemPrompt` | string | Text to append to the system prompt | - |
| `allowedTools` | string[] | List of allowed tools | Env var |
| `disallowedTools` | string[] | List of tools to explicitly block | - |
| `permissionMode` | string | Permission mode (`acceptEdits`, `bypassPermissions`, `plan`) | Env var |
| `mcpConfigJson` | object | MCP server configuration | - |
| `maxTurns` | number | Maximum conversation turns | 6 |
| `cwdRelative` | string | Working directory path | "." |
| `model` | string | Specific Claude model to use | - |
| `fallbackModel` | string | Fallback model if primary fails | - |
| `useNamedPipe` | boolean | Use named pipe for prompt delivery (better for large prompts) | true |

### Environment Variables

**Authentication (choose one):**
- `CLAUDE_CODE_OAUTH_TOKEN`: OAuth token for Claude Pro/Max subscription users
  - Generate locally with: `claude setup-token`
  - Use this token in your deployment
- `ANTHROPIC_API_KEY`: API key for direct Anthropic API access
  - Get from: https://console.anthropic.com/

**Configuration:**
- `ALLOWED_TOOLS`: Comma-separated list of allowed tools
- `PERMISSION_MODE`: Default permission mode (`acceptEdits`, `bypassPermissions`, `plan`)

### Tool Permissions

Examples:
- `Read,Write,Grep` - Basic file operations
- `Bash(npm run test:*)` - Restricted bash commands
- `WebSearch` - Web search capability
- `WebFetch` - Web content fetching

## Security Considerations

1. **Network Isolation**: Use Direct VPC egress with firewall rules
2. **Secrets Management**: Use Secret Manager with version rotation
3. **Tool Restrictions**: Carefully configure allowed tools
4. **Permission Mode**: Start with `acceptEdits` for safety
5. **Ephemeral Workspaces**: Each request gets isolated `/tmp` workspace

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
- `create-secrets.sh` - Create/update Secret Manager secrets
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
- The service includes timeout handling (55 seconds) to prevent indefinite hangs
- Consider using the official Anthropic API SDK for production deployments if this persists

### Service not responding
- Check Cloud Run logs: `gcloud run services logs read qa-agent --region=us-central1`
- Verify secrets are mounted correctly
- Check VPC/firewall configuration

### Authentication errors
- Ensure either ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN is set correctly
- For API keys: Obtain from https://console.anthropic.com/
- For OAuth tokens: Generate using `claude setup-token` command
- Check Secret Manager permissions

### Tool execution failures
- Verify tool permissions in ALLOWED_TOOLS
- Check permission mode settings
- Review container logs for specific errors

## License

This project follows the Claude Code SDK license terms.