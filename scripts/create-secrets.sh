#!/bin/bash

# Create or update GCP Secret Manager secrets
#
# IMPORTANT: This service uses PAYLOAD-BASED authentication for API keys
# - API keys (ANTHROPIC_API_KEY) and OAuth tokens (CLAUDE_CODE_OAUTH_TOKEN)
#   are passed in request payload, NOT as environment variables
# - This script ONLY manages CLOUDRUN_CALLBACK_SECRET for webhook security
#
# For more details, see CLAUDE.md and README.md

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

echo "Creating/updating secrets in project: ${PROJECT_ID}"

# Create CLOUDRUN_CALLBACK_SECRET for webhook HMAC authentication
if [ -z "$CLOUDRUN_CALLBACK_SECRET" ]; then
  echo "Error: CLOUDRUN_CALLBACK_SECRET must be set in .env"
  echo ""
  echo "Generate a strong secret with:"
  echo "  openssl rand -hex 32"
  echo ""
  echo "Then add to .env:"
  echo "  CLOUDRUN_CALLBACK_SECRET=<your-generated-secret>"
  exit 1
fi

echo "Creating/updating CLOUDRUN_CALLBACK_SECRET..."
echo -n "${CLOUDRUN_CALLBACK_SECRET}" | gcloud secrets create CLOUDRUN_CALLBACK_SECRET \
  --data-file=- \
  --project="${PROJECT_ID}" \
  2>/dev/null || \
echo -n "${CLOUDRUN_CALLBACK_SECRET}" | gcloud secrets versions add CLOUDRUN_CALLBACK_SECRET \
  --data-file=- \
  --project="${PROJECT_ID}"

echo "✓ CLOUDRUN_CALLBACK_SECRET created/updated"

echo ""
echo "✓ All secrets have been processed successfully"
echo ""
echo "NOTE: This service uses payload-based authentication:"
echo "  - API keys/OAuth tokens are passed in request payload"
echo "  - SSH keys are passed in request payload"
echo "  - CLOUDRUN_CALLBACK_SECRET is used for webhook authentication"
echo ""
echo "See CLAUDE.md for more details on the security model"
