#!/bin/bash

# One-time setup script for Google Cloud project
# This script enables all required APIs and sets up initial configurations

set -e

# Load environment variables
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
source "${DIR}/load-env.sh"

# Configuration
PROJECT_ID="${PROJECT_ID:-your-project-id}"
REGION="${REGION:-us-central1}"

echo "========================================="
echo "Google Cloud Project Setup"
echo "========================================="
echo "Project ID: ${PROJECT_ID}"
echo "Region: ${REGION}"
echo ""

# Check if gcloud is installed
if ! command -v gcloud &> /dev/null; then
  echo "Error: gcloud CLI is not installed"
  echo "Please install it from: https://cloud.google.com/sdk/docs/install"
  exit 1
fi

# Check authentication
echo "Checking authentication..."
CURRENT_USER=$(gcloud config get-value account 2>/dev/null)
if [ -z "$CURRENT_USER" ]; then
  echo "Error: Not authenticated with gcloud"
  echo "Please run: gcloud auth login"
  exit 1
fi
echo "✓ Authenticated as: ${CURRENT_USER}"

# Set project
echo "Setting default project..."
gcloud config set project "${PROJECT_ID}" 2>/dev/null || {
  echo "Error: Project ${PROJECT_ID} not found or you don't have access"
  exit 1
}
echo "✓ Project set to: ${PROJECT_ID}"

# Enable all required APIs
echo ""
echo "Enabling required Google Cloud APIs..."
echo "This may take a few minutes..."

APIS=(
  "secretmanager.googleapis.com"
  "run.googleapis.com"
  "artifactregistry.googleapis.com"
  "cloudbuild.googleapis.com"
  "compute.googleapis.com"
)

for API in "${APIS[@]}"; do
  echo -n "  Checking ${API}... "
  if gcloud services list --enabled --project="${PROJECT_ID}" 2>/dev/null | grep -q "${API}"; then
    echo "already enabled"
  else
    echo -n "enabling... "
    gcloud services enable "${API}" --project="${PROJECT_ID}" --quiet
    echo "done"
  fi
done

echo ""
echo "✓ All required APIs are enabled"

# Create Artifact Registry repository
echo ""
echo "Setting up Artifact Registry..."
REPOSITORY="${REPOSITORY:-claude-code}"

if gcloud artifacts repositories describe "${REPOSITORY}" \
  --location="${REGION}" \
  --project="${PROJECT_ID}" &>/dev/null; then
  echo "✓ Artifact Registry repository '${REPOSITORY}' already exists"
else
  echo "Creating Artifact Registry repository: ${REPOSITORY}"
  gcloud artifacts repositories create "${REPOSITORY}" \
    --repository-format=docker \
    --location="${REGION}" \
    --project="${PROJECT_ID}" \
    --description="Claude Code Docker images" \
    --quiet
  echo "✓ Repository created"
fi

# Configure Docker authentication
echo ""
echo "Configuring Docker authentication..."
gcloud auth configure-docker "${REGION}-docker.pkg.dev" --quiet
echo "✓ Docker authentication configured"

# Grant IAM permissions for the default compute service account
echo ""
echo "Setting up IAM permissions..."
PROJECT_NUMBER=$(gcloud projects describe "${PROJECT_ID}" --format="value(projectNumber)")
SERVICE_ACCOUNT="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

# Check and grant Secret Manager access
if ! gcloud projects get-iam-policy "${PROJECT_ID}" \
  --flatten="bindings[].members" \
  --filter="bindings.members:serviceAccount:${SERVICE_ACCOUNT} AND bindings.role:roles/secretmanager.secretAccessor" \
  --format="value(bindings.role)" 2>/dev/null | grep -q "roles/secretmanager.secretAccessor"; then
  
  echo "Granting Secret Manager access to service account..."
  gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
    --member="serviceAccount:${SERVICE_ACCOUNT}" \
    --role="roles/secretmanager.secretAccessor" \
    --quiet
  echo "✓ Secret Manager access granted"
else
  echo "✓ Service account already has Secret Manager access"
fi

# Check for required files
echo ""
echo "Checking required files..."
MISSING_FILES=()

if [ ! -f "${DIR}/../.env" ]; then
  MISSING_FILES+=(".env")
fi

# No MCP or system prompt files needed - all configuration is dynamic

if [ ${#MISSING_FILES[@]} -gt 0 ]; then
  echo "⚠ Missing required files:"
  for FILE in "${MISSING_FILES[@]}"; do
    echo "  - ${FILE}"
  done
  echo ""
  echo "Please create the .env file from its example:"
  echo "  cp .env.example .env"
  echo ""
  echo "Then edit it with your configuration."
else
  echo "✓ All required files exist"
fi

# Summary
echo ""
echo "========================================="
echo "Setup Complete!"
echo "========================================="
echo ""
echo "Next steps:"
echo "1. Ensure your .env file contains either:"
echo "   - ANTHROPIC_API_KEY=sk-ant-..."
echo "   - CLAUDE_CODE_OAUTH_TOKEN=your-oauth-token"
echo ""
echo "2. Deploy your service:"
echo "   ./scripts/create-secrets.sh    # Create secrets"
echo "   ./scripts/build-and-push.sh    # Build Docker image"
echo "   ./scripts/deploy-service.sh    # Deploy to Cloud Run"
echo ""
echo "3. Test your deployment:"
echo "   ./scripts/test.sh remote"
echo ""
echo "Project: ${PROJECT_ID}"
echo "Region: ${REGION}"
echo "Repository: ${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPOSITORY}"