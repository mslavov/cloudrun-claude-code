# Testing Guide

## Quick Start

All test functionality is consolidated in the `scripts/test.sh` script:

```bash
# Run all tests
./scripts/test.sh

# Test specific components
./scripts/test.sh auth      # Test authentication setup
./scripts/test.sh local     # Test local development server
./scripts/test.sh remote    # Test deployed Cloud Run service
./scripts/test.sh examples  # Show API request examples
```

## Local Testing

1. **Start the development server:**
```bash
npm run dev
```

2. **Run local tests:**
```bash
./scripts/test.sh local
```

3. **Manual testing with curl:**
```bash
# Simple request with dynamic MCP configuration
curl -N -X POST http://localhost:8080/run \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Your prompt here",
    "maxTurns": 3,
    "mcpConfigJson": {"mcpServers": {}},
    "allowedTools": ["Read", "Write"],
    "permissionMode": "bypassPermissions"
  }'
```

## Remote Testing (Cloud Run)

1. **Deploy the service:**
```bash
./scripts/create-secrets.sh
./scripts/build-and-push.sh
./scripts/deploy-service.sh
```

2. **Test the deployed service:**
```bash
./scripts/test.sh remote
```

## Dynamic MCP Configuration

Every request can include its own MCP server configuration:

```json
{
  "prompt": "Your task",
  "mcpConfigJson": {
    "mcpServers": {
      "github": {
        "type": "stdio",
        "command": "npx",
        "args": ["@modelcontextprotocol/server-github@latest"],
        "env": {"GITHUB_TOKEN": "ghp_YOUR_TOKEN"}
      }
    }
  }
}
```

## Test Script Features

The `scripts/test.sh` script includes:
- Authentication verification (API key or OAuth token)
- Health check testing
- Simple request testing
- Tool-enabled request testing
- Remote service testing with gcloud authentication
- Comprehensive API examples

## Environment Variables

Set these in your `.env` file or export them:

```bash
# Authentication (choose one)
ANTHROPIC_API_KEY=sk-ant-...
CLAUDE_CODE_OAUTH_TOKEN=your-oauth-token

# Optional for MCP servers
GITHUB_TOKEN=ghp_...
```

## Troubleshooting

- **Server not running:** Start with `npm run dev`
- **Authentication errors:** Check your API key or OAuth token
- **Remote test failures:** Ensure service is deployed and you're authenticated with gcloud
- **MCP errors:** Verify tokens and server configurations in your request

## Example Requests

Run `./scripts/test.sh examples` to see comprehensive API request examples for various use cases.