#!/bin/bash

# Deploy the Cloud Run service with secrets

set -e

# Load environment variables
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
source "${DIR}/load-env.sh"

# Configuration
PROJECT_ID="${PROJECT_ID:-your-project-id}"
REGION="${REGION:-us-central1}"
SERVICE_NAME="${SERVICE_NAME:-qa-agent}"
REPOSITORY="${REPOSITORY:-claude-code}"
IMAGE_NAME="${IMAGE_NAME:-claude-code}"
TAG="${TAG:-latest}"

# Enable Cloud Run API if not already enabled
echo "Checking Cloud Run API..."
if ! gcloud services list --enabled --project="${PROJECT_ID}" | grep -q "run.googleapis.com"; then
  echo "Enabling Cloud Run API..."
  gcloud services enable run.googleapis.com --project="${PROJECT_ID}"
  echo "✓ Cloud Run API enabled"
  sleep 5  # Wait for API to be ready
else
  echo "✓ Cloud Run API already enabled"
fi

# Optional VPC configuration (set ENABLE_VPC=true to use)
ENABLE_VPC="${ENABLE_VPC:-false}"
VPC_NETWORK="${VPC_NETWORK:-default}"
VPC_SUBNET="${VPC_SUBNET:-serverless-subnet}"

# Resource configuration
CPU="${CPU:-2}"
MEMORY="${MEMORY:-4Gi}"
TIMEOUT="${TIMEOUT:-900}"
CONCURRENCY="${CONCURRENCY:-1}"
MIN_INSTANCES="${MIN_INSTANCES:-0}"
MAX_INSTANCES="${MAX_INSTANCES:-10}"

# Async task configuration (required for /run-async endpoint)
# CPU_THROTTLING: Set to 'false' to keep CPU allocated after HTTP response
# This is REQUIRED for async tasks to continue running in background
CPU_THROTTLING="${CPU_THROTTLING:-false}"
GCS_LOGS_BUCKET="${GCS_LOGS_BUCKET:-}"
GCS_PROJECT_ID="${GCS_PROJECT_ID:-${PROJECT_ID}}"

# Permission configuration
ALLOWED_TOOLS="${ALLOWED_TOOLS:-Read,Write,Grep,Bash(npm run test:*),WebSearch}"
PERMISSION_MODE="${PERMISSION_MODE:-acceptEdits}"

# Advanced configuration
DANGEROUSLY_SKIP_PERMISSIONS="${DANGEROUSLY_SKIP_PERMISSIONS:-false}"
LOG_LEVEL="${LOG_LEVEL:-info}"

# Construct the full image URL
IMAGE_URL="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPOSITORY}/${IMAGE_NAME}:${TAG}"

echo "Deploying Cloud Run service: ${SERVICE_NAME}"
echo "Image: ${IMAGE_URL}"
echo "Region: ${REGION}"
echo "VPC enabled: ${ENABLE_VPC}"
echo "Skip permissions: ${DANGEROUSLY_SKIP_PERMISSIONS}"
echo "Log level: ${LOG_LEVEL}"
echo "CPU throttling: ${CPU_THROTTLING}"
if [ -n "${GCS_LOGS_BUCKET}" ]; then
  echo "GCS logs bucket: ${GCS_LOGS_BUCKET} (async tasks enabled)"
else
  echo "GCS logs bucket: not configured (async tasks disabled)"
fi

# Create/update environment variables file with latest values
ENV_FILE="${DIR}/../.env.deploy.yaml"
echo "Creating/updating environment variables file..."
cat > "${ENV_FILE}" << EOF
PROJECT_ID: "${PROJECT_ID}"
ALLOWED_TOOLS: "${ALLOWED_TOOLS}"
PERMISSION_MODE: "${PERMISSION_MODE}"
DANGEROUSLY_SKIP_PERMISSIONS: "${DANGEROUSLY_SKIP_PERMISSIONS}"
LOG_LEVEL: "${LOG_LEVEL}"
EOF

# Add all LOG_LEVEL_* variables from environment
for var in $(env | grep '^LOG_LEVEL_' | cut -d= -f1); do
  value="${!var}"
  if [ -n "$value" ]; then
    echo "${var}: \"${value}\"" >> "${ENV_FILE}"
    echo "  Adding ${var}=${value}"
  fi
done

# Add GCS configuration if async tasks are enabled
if [ -n "${GCS_LOGS_BUCKET}" ]; then
  cat >> "${ENV_FILE}" << EOF
GCS_LOGS_BUCKET: "${GCS_LOGS_BUCKET}"
GCS_PROJECT_ID: "${GCS_PROJECT_ID}"
EOF
  echo "✓ Environment variables file created/updated (with async task support)"
else
  echo "✓ Environment variables file created/updated (async tasks disabled)"
fi

# Build deployment command
DEPLOY_CMD="gcloud run deploy \"${SERVICE_NAME}\" \
  --image=\"${IMAGE_URL}\" \
  --region=\"${REGION}\" \
  --platform=managed \
  --concurrency=\"${CONCURRENCY}\" \
  --cpu=\"${CPU}\" \
  --memory=\"${MEMORY}\" \
  --timeout=\"${TIMEOUT}\" \
  --min-instances=\"${MIN_INSTANCES}\" \
  --max-instances=\"${MAX_INSTANCES}\" \
  --env-vars-file=\"${DIR}/../.env.deploy.yaml\""

# Add CPU throttling flag (critical for async tasks)
if [ "${CPU_THROTTLING}" = "false" ]; then
  DEPLOY_CMD="${DEPLOY_CMD} --no-cpu-throttling"
else
  DEPLOY_CMD="${DEPLOY_CMD} --cpu-throttling"
fi

# NOTE: Service uses payload-based authentication and SSH keys
# All credentials are passed in request payload for security isolation:
# - API keys/OAuth tokens: Pass as anthropicApiKey/anthropicOAuthToken in request body
# - SSH keys: Pass as sshKey parameter in request body
# ANTHROPIC_API_KEY secret is optional and only for local testing/debugging
if gcloud secrets describe ANTHROPIC_API_KEY --project="${PROJECT_ID}" &>/dev/null; then
  echo "ℹ ANTHROPIC_API_KEY secret found - mounting for local testing only"
  echo "  Production should use payload-based authentication"
  DEPLOY_CMD="${DEPLOY_CMD} \
  --set-secrets=\"ANTHROPIC_API_KEY=ANTHROPIC_API_KEY:latest\""
else
  echo "ℹ No ANTHROPIC_API_KEY secret found"
  echo "  This is expected - production uses payload-based authentication"
fi

# Mount CLOUDRUN_CALLBACK_SECRET for webhook HMAC authentication (required for async tasks)
if [ -n "${GCS_LOGS_BUCKET}" ]; then
  if gcloud secrets describe CLOUDRUN_CALLBACK_SECRET --project="${PROJECT_ID}" &>/dev/null; then
    echo "✓ CLOUDRUN_CALLBACK_SECRET found - mounting for webhook authentication"
    if echo "$DEPLOY_CMD" | grep -q "set-secrets="; then
      # Append to existing secrets
      DEPLOY_CMD="${DEPLOY_CMD%\"}\",CLOUDRUN_CALLBACK_SECRET=CLOUDRUN_CALLBACK_SECRET:latest\""
    else
      # First secret
      DEPLOY_CMD="${DEPLOY_CMD} \
  --set-secrets=\"CLOUDRUN_CALLBACK_SECRET=CLOUDRUN_CALLBACK_SECRET:latest\""
    fi
  else
    echo "⚠ WARNING: CLOUDRUN_CALLBACK_SECRET not found in Secret Manager"
    echo "  Async tasks require this secret for webhook authentication"
    echo "  Run: ./scripts/create-secrets.sh to create it"
  fi
fi

# Add VPC configuration if enabled
if [ "${ENABLE_VPC}" = "true" ]; then
  DEPLOY_CMD="${DEPLOY_CMD} \
  --vpc-egress=all-traffic \
  --network=\"${VPC_NETWORK}\" \
  --subnet=\"${VPC_SUBNET}\""
fi

DEPLOY_CMD="${DEPLOY_CMD} \
  --project=\"${PROJECT_ID}\""

# Deploy the service
eval ${DEPLOY_CMD}

if [ $? -eq 0 ]; then
  echo "✓ Service deployed successfully"
  
  # Grant IAM permissions to the default compute service account
  echo "Granting IAM permissions..."
  PROJECT_NUMBER=$(gcloud projects describe "${PROJECT_ID}" --format="value(projectNumber)")
  SERVICE_ACCOUNT="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

  # Grant Secret Manager access (idempotent - safe to run multiple times)
  echo "Granting Secret Manager access to service account: ${SERVICE_ACCOUNT}"
  gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
    --member="serviceAccount:${SERVICE_ACCOUNT}" \
    --role="roles/secretmanager.secretAccessor" \
    --quiet 2>/dev/null || true
  echo "✓ Secret Manager IAM permissions granted"

  # Grant Storage Admin role if GCS bucket is configured (for async tasks)
  if [ -n "${GCS_LOGS_BUCKET}" ]; then
    echo "Granting Storage Object Admin access for async tasks: ${SERVICE_ACCOUNT}"
    gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
      --member="serviceAccount:${SERVICE_ACCOUNT}" \
      --role="roles/storage.objectAdmin" \
      --quiet 2>/dev/null || true
    echo "✓ Storage Object Admin IAM permissions granted"
  fi
else
  echo "✗ Service deployment failed"
  exit 1
fi

# Get the service URL
SERVICE_URL=$(gcloud run services describe "${SERVICE_NAME}" \
  --region="${REGION}" \
  --project="${PROJECT_ID}" \
  --format="value(status.url)")

echo "Service URL: ${SERVICE_URL}"