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
  "storage.googleapis.com"
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

# Setup GCS bucket for async tasks (optional)
echo ""
echo "Setting up GCS bucket for async tasks..."
GCS_LOGS_BUCKET="${GCS_LOGS_BUCKET:-}"

if [ -n "$GCS_LOGS_BUCKET" ]; then
  echo "GCS_LOGS_BUCKET configured: ${GCS_LOGS_BUCKET}"

  # Check if bucket exists
  if gsutil ls "gs://${GCS_LOGS_BUCKET}" &>/dev/null; then
    echo "✓ GCS bucket already exists: gs://${GCS_LOGS_BUCKET}"
  else
    echo "Creating GCS bucket: ${GCS_LOGS_BUCKET}"
    gcloud storage buckets create "gs://${GCS_LOGS_BUCKET}" \
      --project="${PROJECT_ID}" \
      --location="${REGION}" \
      --uniform-bucket-level-access \
      --quiet
    echo "✓ GCS bucket created"

    # Set lifecycle policy
    # - Delete logs after 30 days (sessions/)
    # - Delete encrypted payloads after 1 day (tasks/)
    echo "Setting lifecycle policy..."
    if [ -f "${DIR}/../gcs-lifecycle.json" ]; then
      gcloud storage buckets update "gs://${GCS_LOGS_BUCKET}" \
        --lifecycle-file="${DIR}/../gcs-lifecycle.json" \
        --quiet
      echo "✓ Lifecycle policy configured (30-day logs, 1-day encrypted payloads)"
    else
      echo "⚠️  gcs-lifecycle.json not found, using default policy"
      cat > /tmp/lifecycle-${GCS_LOGS_BUCKET}.json << 'EOF'
{
  "lifecycle": {
    "rule": [{
      "action": {"type": "Delete"},
      "condition": {"age": 30}
    }]
  }
}
EOF
      gcloud storage buckets update "gs://${GCS_LOGS_BUCKET}" \
        --lifecycle-file=/tmp/lifecycle-${GCS_LOGS_BUCKET}.json \
        --quiet
      rm -f /tmp/lifecycle-${GCS_LOGS_BUCKET}.json
      echo "✓ Basic lifecycle policy configured (30-day auto-delete)"
    fi
  fi

  # Grant storage permissions to service account
  echo "Granting storage permissions to service account..."
  if gcloud storage buckets get-iam-policy "gs://${GCS_LOGS_BUCKET}" \
      --project="${PROJECT_ID}" \
      --format=json 2>/dev/null | grep -q "serviceAccount:${SERVICE_ACCOUNT}"; then
    echo "✓ Service account already has storage permissions"
  else
    gcloud storage buckets add-iam-policy-binding "gs://${GCS_LOGS_BUCKET}" \
      --member="serviceAccount:${SERVICE_ACCOUNT}" \
      --role="roles/storage.objectAdmin" \
      --project="${PROJECT_ID}" \
      --quiet
    echo "✓ Storage permissions granted"
  fi
else
  echo "⚠ GCS_LOGS_BUCKET not set in .env - skipping bucket creation"
  echo "  Async task support (/run-async endpoint) will not be available"
  echo "  To enable later:"
  echo "    1. Add GCS_LOGS_BUCKET to .env"
  echo "    2. Run this script again"
  echo "    3. Redeploy with ./scripts/deploy-service.sh"
fi

# Setup Cloud KMS for payload encryption
if [ -n "$GCS_LOGS_BUCKET" ]; then
  echo ""
  echo "Setting up Cloud KMS for payload encryption..."

  # Enable KMS API
  echo -n "  Checking cloudkms.googleapis.com... "
  if gcloud services list --enabled --project="${PROJECT_ID}" 2>/dev/null | grep -q "cloudkms.googleapis.com"; then
    echo "already enabled"
  else
    echo -n "enabling... "
    gcloud services enable "cloudkms.googleapis.com" --project="${PROJECT_ID}" --quiet
    echo "done"
  fi

  # Run KMS setup script
  if [ -f "${DIR}/setup-kms.sh" ]; then
    echo "  Running KMS setup..."
    bash "${DIR}/setup-kms.sh"
    echo "✓ KMS setup complete"
  else
    echo "⚠️  KMS setup script not found: ${DIR}/setup-kms.sh"
    echo "  Run it manually later: ./scripts/setup-kms.sh"
  fi
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
echo "Resources created/verified:"
echo "✓ Required APIs enabled"
echo "✓ Artifact Registry repository"
echo "✓ Docker authentication configured"
echo "✓ IAM permissions for service account"
if [ -n "$GCS_LOGS_BUCKET" ]; then
  echo "✓ GCS bucket for async tasks: gs://${GCS_LOGS_BUCKET}"
fi
echo ""
echo "Next steps:"
echo "1. (Optional) Configure .env file with:"
echo "   - ANTHROPIC_API_KEY for local testing only (production uses request payload)"
if [ -z "$GCS_LOGS_BUCKET" ]; then
  echo "   - GCS_LOGS_BUCKET for async task support"
fi
echo ""
echo "2. Deploy your service:"
echo "   ./scripts/create-secrets.sh    # Create optional secrets (for local testing)"
echo "   ./scripts/build-and-push.sh    # Build Docker image"
echo "   ./scripts/deploy-service.sh    # Deploy to Cloud Run"
echo ""
echo "3. Test your deployment:"
echo "   ./scripts/test.sh remote       # Test sync endpoint"
if [ -n "$GCS_LOGS_BUCKET" ]; then
  echo "   ./scripts/test.sh remote-async # Test async endpoint"
fi
echo ""
echo "Project: ${PROJECT_ID}"
echo "Region: ${REGION}"
echo "Repository: ${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPOSITORY}"
if [ -n "$GCS_LOGS_BUCKET" ]; then
  echo "GCS Logs: gs://${GCS_LOGS_BUCKET}"
fi