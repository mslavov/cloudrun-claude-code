#!/bin/bash
#
# Create Cloud Run Job for async task execution
# This script creates the job definition that will run job-worker.js
#

set -e

# Check if .env file exists
if [ ! -f .env ]; then
  echo "Error: .env file not found"
  echo "Create a .env file with PROJECT_ID and REGION"
  exit 1
fi

# Load environment variables
source .env

# Set defaults
LOCATION="${REGION:-europe-west3}"
JOB_NAME="claude-code-async-worker"
IMAGE_NAME="claude-code"

echo "=== Creating Cloud Run Job ==="
echo ""
echo "Project: ${PROJECT_ID}"
echo "Location: ${LOCATION}"
echo "Job Name: ${JOB_NAME}"
echo ""

# Get the latest image from Artifact Registry
REPOSITORY="${LOCATION}-docker.pkg.dev/${PROJECT_ID}/claude-code"
IMAGE="${REPOSITORY}/${IMAGE_NAME}:latest"

echo "📦 Using image: ${IMAGE}"

# Get service account from the service
echo "🔍 Finding service account..."
SERVICE_SA=$(gcloud run services describe bugzy-agent \
  --region="${LOCATION}" \
  --format='value(spec.template.spec.serviceAccountName)' \
  --project="${PROJECT_ID}" 2>/dev/null || echo "")

if [ -z "$SERVICE_SA" ]; then
  echo "⚠️  Service 'bugzy-agent' not found"
  echo "Using default compute service account"
  SERVICE_SA="${PROJECT_ID}@appspot.gserviceaccount.com"
fi

echo "✅ Service account: ${SERVICE_SA}"

# Check if job already exists
JOB_EXISTS=$(gcloud run jobs describe "${JOB_NAME}" \
  --region="${LOCATION}" \
  --project="${PROJECT_ID}" \
  --format="value(metadata.name)" 2>/dev/null || echo "")

if [ -n "$JOB_EXISTS" ]; then
  echo ""
  echo "⚠️  Job '${JOB_NAME}' already exists"
  echo ""
  read -p "Do you want to update it? (y/N): " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Skipping job creation"
    exit 0
  fi

  OPERATION="Updating"
  CMD="update"
else
  OPERATION="Creating"
  CMD="create"
fi

echo ""
echo "🚀 ${OPERATION} Cloud Run Job..."

gcloud run jobs ${CMD} "${JOB_NAME}" \
  --image="${IMAGE}" \
  --region="${LOCATION}" \
  --project="${PROJECT_ID}" \
  --max-retries=1 \
  --task-timeout=1h \
  --cpu=2 \
  --memory=4Gi \
  --service-account="${SERVICE_SA}" \
  --set-env-vars="PROJECT_ID=${PROJECT_ID}" \
  --set-env-vars="REGION=${LOCATION}" \
  --set-env-vars="GCS_LOGS_BUCKET=${GCS_LOGS_BUCKET}" \
  --set-env-vars="GCS_PROJECT_ID=${PROJECT_ID}" \
  --set-env-vars="LOG_LEVEL=info" \
  --set-secrets="CLOUDRUN_CALLBACK_SECRET=CLOUDRUN_CALLBACK_SECRET:latest" \
  --command=node \
  --args=dist/job-worker.js

if [ "$CMD" = "create" ]; then
  echo "✅ Job created successfully"
else
  echo "✅ Job updated successfully"
fi

echo ""
echo "Job details:"
gcloud run jobs describe "${JOB_NAME}" \
  --region="${LOCATION}" \
  --project="${PROJECT_ID}" \
  --format="yaml(spec.template.spec.containers[0])" | head -20

echo ""
echo "=== Next Steps ==="
echo "1. Grant service account permissions: ./scripts/grant-job-permissions.sh"
echo "2. Test the job: gcloud run jobs execute ${JOB_NAME} --region=${LOCATION}"
echo "3. View job executions: https://console.cloud.google.com/run/jobs/details/${LOCATION}/${JOB_NAME}?project=${PROJECT_ID}"
