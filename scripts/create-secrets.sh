#!/bin/bash

# Create or update GCP Secret Manager secrets

set -e

# Load environment variables
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
source "${DIR}/load-env.sh"

# Configuration
PROJECT_ID="${PROJECT_ID:-your-project-id}"

# Enable Secret Manager API if not already enabled
echo "Checking Secret Manager API..."
if ! gcloud services list --enabled --project="${PROJECT_ID}" | grep -q "secretmanager.googleapis.com"; then
  echo "Enabling Secret Manager API..."
  gcloud services enable secretmanager.googleapis.com --project="${PROJECT_ID}"
  echo "✓ Secret Manager API enabled"
  sleep 5  # Wait for API to be ready
else
  echo "✓ Secret Manager API already enabled"
fi

# NOTE: Service uses payload-based authentication and SSH keys
# All credentials are passed in request payload for maximum security isolation
# - API keys/OAuth tokens: Pass in request body (anthropicApiKey/anthropicOAuthToken)
# - SSH keys: Pass in request body (sshKey parameter)
# Service-level secrets are optional and only used for local testing/debugging

echo "Creating/updating secrets in project: ${PROJECT_ID}"
echo "Note: All production credentials should be passed in request payload"
echo ""

# Create Anthropic API key secret if set (optional - for testing/debugging only)
if [ -n "$ANTHROPIC_API_KEY" ]; then
  echo "Creating ANTHROPIC_API_KEY secret (for local testing only)..."
  echo -n "${ANTHROPIC_API_KEY}" | gcloud secrets create ANTHROPIC_API_KEY \
    --data-file=- \
    --project="${PROJECT_ID}" \
    2>/dev/null || \
  echo -n "${ANTHROPIC_API_KEY}" | gcloud secrets versions add ANTHROPIC_API_KEY \
    --data-file=- \
    --project="${PROJECT_ID}"
  echo "✓ ANTHROPIC_API_KEY secret created/updated (for local testing only)"
  echo "  Production deployments should use request payload instead"
else
  echo "ℹ No ANTHROPIC_API_KEY provided"
  echo "  This is fine - production uses payload-based authentication"
fi

echo ""
echo "✓ Secrets processed successfully"
echo "Remember: Production credentials should be passed in request payload, not stored as secrets"