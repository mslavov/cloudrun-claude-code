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
# Simple request (requires API key in payload)
curl -N -X POST http://localhost:8080/run \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Your prompt here",
    "anthropicApiKey": "sk-ant-your-key-here",
    "maxTurns": 3,
    "allowedTools": ["Read", "Write"],
    "permissionMode": "bypassPermissions"
  }'
```

## Remote Testing (Cloud Run)

1. **Deploy the service:**
```bash
./scripts/build-and-push.sh
./scripts/deploy-service.sh
```

2. **Test the deployed service:**
```bash
./scripts/test.sh remote
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

**IMPORTANT**: The service uses **payload-based authentication**. API keys are passed in request payload, not environment variables.

For local testing convenience, you can optionally set:

```bash
# Optional: For local testing only (not required in production)
export ANTHROPIC_API_KEY=sk-ant-...
# OR
export CLAUDE_CODE_OAUTH_TOKEN=your-oauth-token
```

The test script will use these environment variables if set, but in production all credentials should be passed in the request payload.

## Troubleshooting

- **Server not running:** Start with `npm run dev`
- **Authentication errors:** Check your API key or OAuth token
- **Remote test failures:** Ensure service is deployed and you're authenticated with gcloud

## Example Requests

Run `./scripts/test.sh examples` to see comprehensive API request examples for various use cases.