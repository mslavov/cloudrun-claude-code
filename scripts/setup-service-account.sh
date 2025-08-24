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

# Set default values if not provided
SERVICE_ACCOUNT_NAME="${SERVICE_ACCOUNT_NAME:-claude-code-client}"
SERVICE_ACCOUNT_DISPLAY_NAME="${SERVICE_ACCOUNT_DISPLAY_NAME:-Claude Code Client Service Account}"

echo -e "${YELLOW}Using project: ${PROJECT_ID}${NC}"
echo -e "${YELLOW}Service account name: ${SERVICE_ACCOUNT_NAME}${NC}"

# Create service account
echo -e "${GREEN}Creating service account...${NC}"
gcloud iam service-accounts create ${SERVICE_ACCOUNT_NAME} \
    --display-name="${SERVICE_ACCOUNT_DISPLAY_NAME}" \
    --project=${PROJECT_ID} || echo -e "${YELLOW}Service account might already exist, continuing...${NC}"

SERVICE_ACCOUNT_EMAIL="${SERVICE_ACCOUNT_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
echo -e "${GREEN}Service account email: ${SERVICE_ACCOUNT_EMAIL}${NC}"

# Grant Cloud Run invoker role to the service account
echo -e "${GREEN}Granting Cloud Run invoker role...${NC}"
gcloud run services add-iam-policy-binding ${SERVICE_NAME} \
    --member="serviceAccount:${SERVICE_ACCOUNT_EMAIL}" \
    --role="roles/run.invoker" \
    --region=${REGION} \
    --project=${PROJECT_ID}

echo -e "${GREEN}Service account setup complete!${NC}"
echo -e "${YELLOW}Service account email: ${SERVICE_ACCOUNT_EMAIL}${NC}"
echo -e "${YELLOW}Run './scripts/download-service-account-key.sh' to download the key file${NC}"