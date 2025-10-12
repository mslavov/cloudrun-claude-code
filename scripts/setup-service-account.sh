#!/bin/bash

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}Setting up service account for Claude Code Cloud Run service...${NC}"

# Load environment variables
if [ -f .env ]; then
    source .env
else
    echo -e "${RED}Error: .env file not found${NC}"
    exit 1
fi

# Validate required environment variables
if [ -z "$PROJECT_ID" ]; then
    echo -e "${RED}Error: PROJECT_ID not set in .env${NC}"
    exit 1
fi

if [ -z "$SERVICE_NAME" ]; then
    echo -e "${RED}Error: SERVICE_NAME not set in .env${NC}"
    exit 1
fi

if [ -z "$REGION" ]; then
    echo -e "${RED}Error: REGION not set in .env${NC}"
    exit 1
fi

# Set default values if not provided
SERVICE_ACCOUNT_NAME="${SERVICE_ACCOUNT_NAME:-claude-code-client}"
SERVICE_ACCOUNT_DISPLAY_NAME="${SERVICE_ACCOUNT_DISPLAY_NAME:-Claude Code Client Service Account}"

SERVICE_ACCOUNT_EMAIL="${SERVICE_ACCOUNT_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

echo -e "${YELLOW}Project: ${PROJECT_ID}${NC}"
echo -e "${YELLOW}Service account: ${SERVICE_ACCOUNT_EMAIL}${NC}"
echo ""

# Create service account (idempotent)
echo -e "${GREEN}Checking service account...${NC}"
if gcloud iam service-accounts describe ${SERVICE_ACCOUNT_EMAIL} --project=${PROJECT_ID} >/dev/null 2>&1; then
    echo -e "${GREEN}✓ Service account already exists${NC}"
else
    echo -e "${GREEN}Creating service account...${NC}"
    gcloud iam service-accounts create ${SERVICE_ACCOUNT_NAME} \
        --display-name="${SERVICE_ACCOUNT_DISPLAY_NAME}" \
        --project=${PROJECT_ID}
    echo -e "${GREEN}✓ Service account created${NC}"
fi

# Grant Cloud Run invoker role (idempotent)
echo ""
echo -e "${GREEN}Checking Cloud Run permissions...${NC}"
if gcloud run services get-iam-policy ${SERVICE_NAME} \
    --region=${REGION} \
    --project=${PROJECT_ID} \
    --format=json 2>/dev/null | grep -q "serviceAccount:${SERVICE_ACCOUNT_EMAIL}"; then
    echo -e "${GREEN}✓ Service account already has Cloud Run invoker role${NC}"
else
    echo -e "${GREEN}Granting Cloud Run invoker role...${NC}"
    gcloud run services add-iam-policy-binding ${SERVICE_NAME} \
        --member="serviceAccount:${SERVICE_ACCOUNT_EMAIL}" \
        --role="roles/run.invoker" \
        --region=${REGION} \
        --project=${PROJECT_ID}
    echo -e "${GREEN}✓ Cloud Run invoker role granted${NC}"
fi

# Grant GCS permissions if bucket is configured (idempotent)
if [ -n "${GCS_LOGS_BUCKET}" ]; then
    echo ""
    echo -e "${GREEN}Checking Cloud Storage permissions...${NC}"
    echo -e "${YELLOW}Bucket: ${GCS_LOGS_BUCKET}${NC}"

    # Check if bucket exists
    if ! gsutil ls "gs://${GCS_LOGS_BUCKET}" >/dev/null 2>&1; then
        echo -e "${YELLOW}⚠ Bucket gs://${GCS_LOGS_BUCKET} not found${NC}"
        echo -e "${YELLOW}  The bucket will be created automatically by setup-project.sh${NC}"
        echo -e "${YELLOW}  Or create it manually:${NC}"
        echo -e "${YELLOW}  gcloud storage buckets create gs://${GCS_LOGS_BUCKET} --project=${PROJECT_ID} --location=${REGION}${NC}"
    else
        echo -e "${GREEN}✓ Bucket exists${NC}"

        # Check if service account already has storage permissions (idempotent)
        if gcloud storage buckets get-iam-policy "gs://${GCS_LOGS_BUCKET}" \
            --project=${PROJECT_ID} \
            --format=json 2>/dev/null | grep -q "serviceAccount:${SERVICE_ACCOUNT_EMAIL}"; then
            echo -e "${GREEN}✓ Service account already has storage permissions${NC}"
        else
            echo -e "${GREEN}Granting storage.objectAdmin role on bucket...${NC}"
            gcloud storage buckets add-iam-policy-binding "gs://${GCS_LOGS_BUCKET}" \
                --member="serviceAccount:${SERVICE_ACCOUNT_EMAIL}" \
                --role="roles/storage.objectAdmin" \
                --project=${PROJECT_ID}
            echo -e "${GREEN}✓ Storage permissions granted${NC}"
        fi
    fi
else
    echo ""
    echo -e "${YELLOW}⚠ GCS_LOGS_BUCKET not set in .env${NC}"
    echo -e "${YELLOW}  Async task support requires a GCS bucket for logs${NC}"
    echo -e "${YELLOW}  To enable async tasks:${NC}"
    echo -e "${YELLOW}  1. Add GCS_LOGS_BUCKET to your .env file${NC}"
    echo -e "${YELLOW}  2. Run ./scripts/setup-project.sh (handles bucket creation and permissions)${NC}"
    echo -e "${YELLOW}  3. Run this script again to grant permissions${NC}"
fi

echo ""
echo -e "${GREEN}Service account setup complete!${NC}"
echo ""
echo -e "${YELLOW}Summary:${NC}"
echo -e "${YELLOW}  Service account: ${SERVICE_ACCOUNT_EMAIL}${NC}"
echo -e "${YELLOW}  Cloud Run service: ${SERVICE_NAME}${NC}"
if [ -n "${GCS_LOGS_BUCKET}" ]; then
    echo -e "${YELLOW}  GCS logs bucket: ${GCS_LOGS_BUCKET}${NC}"
fi
echo ""
echo -e "${GREEN}Permissions:${NC}"
echo -e "${GREEN}  ✓ roles/run.invoker on ${SERVICE_NAME}${NC}"
if [ -n "${GCS_LOGS_BUCKET}" ] && gsutil ls "gs://${GCS_LOGS_BUCKET}" >/dev/null 2>&1; then
    echo -e "${GREEN}  ✓ roles/storage.objectAdmin on gs://${GCS_LOGS_BUCKET}${NC}"
fi
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo -e "${YELLOW}  Run './scripts/download-service-account-key.sh' to download the key file${NC}"
