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

# Check if required authentication is set
if [ -z "$ANTHROPIC_API_KEY" ] && [ -z "$CLAUDE_CODE_OAUTH_TOKEN" ]; then
  echo "Error: Either ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN must be set"
  exit 1
fi

echo "Creating/updating secrets in project: ${PROJECT_ID}"

# Create Anthropic API key secret if set
if [ -n "$ANTHROPIC_API_KEY" ]; then
  echo -n "${ANTHROPIC_API_KEY}" | gcloud secrets create ANTHROPIC_API_KEY \
    --data-file=- \
    --project="${PROJECT_ID}" \
    2>/dev/null || \
  echo -n "${ANTHROPIC_API_KEY}" | gcloud secrets versions add ANTHROPIC_API_KEY \
    --data-file=- \
    --project="${PROJECT_ID}"
  echo "✓ ANTHROPIC_API_KEY secret created/updated"
fi

# Create Anthropic OAuth token secret if set
if [ -n "$CLAUDE_CODE_OAUTH_TOKEN" ]; then
  echo -n "${CLAUDE_CODE_OAUTH_TOKEN}" | gcloud secrets create CLAUDE_CODE_OAUTH_TOKEN \
    --data-file=- \
    --project="${PROJECT_ID}" \
    2>/dev/null || \
  echo -n "${CLAUDE_CODE_OAUTH_TOKEN}" | gcloud secrets versions add CLAUDE_CODE_OAUTH_TOKEN \
    --data-file=- \
    --project="${PROJECT_ID}"
  echo "✓ CLAUDE_CODE_OAUTH_TOKEN secret created/updated"
fi

# Create Git SSH key secret if set
if [ -n "$GIT_SSH_KEY" ]; then
  echo -n "${GIT_SSH_KEY}" | gcloud secrets create GIT_SSH_KEY \
    --data-file=- \
    --project="${PROJECT_ID}" \
    2>/dev/null || \
  echo -n "${GIT_SSH_KEY}" | gcloud secrets versions add GIT_SSH_KEY \
    --data-file=- \
    --project="${PROJECT_ID}"
  echo "✓ GIT_SSH_KEY secret created/updated"
fi

echo "All secrets have been processed successfully"