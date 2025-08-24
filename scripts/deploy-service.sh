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
CONCURRENCY="${CONCURRENCY:-10}"
MIN_INSTANCES="${MIN_INSTANCES:-0}"
MAX_INSTANCES="${MAX_INSTANCES:-10}"

# Permission configuration
ALLOWED_TOOLS="${ALLOWED_TOOLS:-Read,Write,Grep,Bash(npm run test:*),WebSearch}"
PERMISSION_MODE="${PERMISSION_MODE:-acceptEdits}"

# Construct the full image URL
IMAGE_URL="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPOSITORY}/${IMAGE_NAME}:${TAG}"

echo "Deploying Cloud Run service: ${SERVICE_NAME}"
echo "Image: ${IMAGE_URL}"
echo "Region: ${REGION}"
echo "VPC enabled: ${ENABLE_VPC}"

# Create environment variables file if it doesn't exist
ENV_FILE="${DIR}/../.env.deploy.yaml"
if [ ! -f "${ENV_FILE}" ]; then
  echo "Creating environment variables file..."
  cat > "${ENV_FILE}" << EOF
ALLOWED_TOOLS: "${ALLOWED_TOOLS}"
PERMISSION_MODE: "${PERMISSION_MODE}"
EOF
  echo "✓ Environment variables file created"
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

# Add authentication secrets based on what's available
if gcloud secrets describe ANTHROPIC_API_KEY --project="${PROJECT_ID}" &>/dev/null; then
  DEPLOY_CMD="${DEPLOY_CMD} \
  --set-secrets=\"ANTHROPIC_API_KEY=ANTHROPIC_API_KEY:latest\""
fi

if gcloud secrets describe CLAUDE_CODE_OAUTH_TOKEN --project="${PROJECT_ID}" &>/dev/null; then
  DEPLOY_CMD="${DEPLOY_CMD} \
  --set-secrets=\"CLAUDE_CODE_OAUTH_TOKEN=CLAUDE_CODE_OAUTH_TOKEN:latest\""
fi

DEPLOY_CMD="${DEPLOY_CMD}"

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
  
  # Grant Secret Manager access to the default compute service account
  echo "Granting IAM permissions..."
  PROJECT_NUMBER=$(gcloud projects describe "${PROJECT_ID}" --format="value(projectNumber)")
  SERVICE_ACCOUNT="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
  
  # Check if the service account already has the role
  if ! gcloud projects get-iam-policy "${PROJECT_ID}" \
    --flatten="bindings[].members" \
    --filter="bindings.members:serviceAccount:${SERVICE_ACCOUNT} AND bindings.role:roles/secretmanager.secretAccessor" \
    --format="value(bindings.role)" | grep -q "roles/secretmanager.secretAccessor"; then
    
    echo "Granting Secret Manager access to service account: ${SERVICE_ACCOUNT}"
    gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
      --member="serviceAccount:${SERVICE_ACCOUNT}" \
      --role="roles/secretmanager.secretAccessor" \
      --quiet
    echo "✓ IAM permissions granted"
  else
    echo "✓ Service account already has Secret Manager access"
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