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
# Simple request
curl -N -X POST http://localhost:8080/run \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Your prompt here",
    "maxTurns": 3,
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
```

## Troubleshooting

- **Server not running:** Start with `npm run dev`
- **Authentication errors:** Check your API key or OAuth token
- **Remote test failures:** Ensure service is deployed and you're authenticated with gcloud

## Example Requests

Run `./scripts/test.sh examples` to see comprehensive API request examples for various use cases.

## Testing Secret Management API

### Set up test environment
```bash
export SERVICE_URL=https://your-service-url.run.app
# Or for local testing
export SERVICE_URL=http://localhost:8080
```

### Test Secret CRUD Operations

```bash
# 1. List all secrets
curl "$SERVICE_URL/api/secrets/list" \
  -H "Authorization: Bearer $(gcloud auth print-identity-token)"

# 2. Create a repository-level secret
curl -X POST "$SERVICE_URL/api/secrets/create" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $(gcloud auth print-identity-token)" \
  -d '{
    "org": "mycompany",
    "repo": "backend",
    "envContent": "DATABASE_URL=postgres://localhost:5432/mydb\nAPI_KEY=sk-test-123\nREDIS_URL=redis://localhost:6379"
  }'

# 3. Create customer-specific secrets with hierarchical structure
curl -X POST "$SERVICE_URL/api/secrets/create" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $(gcloud auth print-identity-token)" \
  -d '{
    "org": "mycompany",
    "repo": "backend",
    "branch": "customers/acme",
    "envContent": "CUSTOMER_ID=acme\nCUSTOMER_TIER=enterprise"
  }'

curl -X POST "$SERVICE_URL/api/secrets/create" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $(gcloud auth print-identity-token)" \
  -d '{
    "org": "mycompany",
    "repo": "backend",
    "branch": "customers/acme/staging",
    "envContent": "ENVIRONMENT=staging\nDEBUG=true"
  }'

# 4. Test hierarchical resolution
# This will inherit from: customers/acme/staging -> customers/acme -> repository default
curl "$SERVICE_URL/api/secrets/get?gitRepo=git@github.com:mycompany/backend.git&gitBranch=customers/acme/staging" \
  -H "Authorization: Bearer $(gcloud auth print-identity-token)"

# 5. Update a secret
curl -X PUT "$SERVICE_URL/api/secrets/update" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $(gcloud auth print-identity-token)" \
  -d '{
    "org": "mycompany",
    "repo": "backend",
    "branch": "customers/acme/staging",
    "envContent": "ENVIRONMENT=staging\nDEBUG=false\nVERSION=2.0"
  }'

# 6. Delete a secret
curl -X DELETE "$SERVICE_URL/api/secrets/delete?org=mycompany&repo=backend&branch=customers/acme/staging" \
  -H "Authorization: Bearer $(gcloud auth print-identity-token)"
```

### Test with Git Repository Integration

```bash
# Test automatic environment loading with repository clone
curl -N -X POST $SERVICE_URL/run \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $(gcloud auth print-identity-token)" \
  -d '{
    "prompt": "Print all environment variables that start with CUSTOMER_ or DATABASE_",
    "gitRepo": "git@github.com:mycompany/backend.git",
    "gitBranch": "customers/acme/staging",
    "allowedTools": ["Bash"],
    "maxTurns": 1
  }'
```

### Test Hierarchical Resolution Scenarios

```bash
# Scenario 1: Branch with no specific secret (uses repository default)
curl "$SERVICE_URL/api/secrets/get?gitRepo=git@github.com:mycompany/backend.git&gitBranch=feature/new-feature" \
  -H "Authorization: Bearer $(gcloud auth print-identity-token)"

# Scenario 2: Complex branch hierarchy
# Create secrets at different levels
for branch in "customers" "customers/bigcorp" "customers/bigcorp/production"; do
  curl -X POST "$SERVICE_URL/api/secrets/create" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $(gcloud auth print-identity-token)" \
    -d "{
      \"org\": \"mycompany\",
      \"repo\": \"backend\",
      \"branch\": \"$branch\",
      \"envContent\": \"LEVEL=$branch\\nTIMESTAMP=$(date +%s)\"
    }"
done

# Test resolution at deepest level
curl "$SERVICE_URL/api/secrets/get?gitRepo=git@github.com:mycompany/backend.git&gitBranch=customers/bigcorp/production/hotfix" \
  -H "Authorization: Bearer $(gcloud auth print-identity-token)"
```