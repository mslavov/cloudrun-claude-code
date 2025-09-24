#!/bin/bash

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}Downloading service account key...${NC}"

# Load environment variables
if [ -f .env ]; then
    source .env
else
    echo -e "${RED}Error: .env file not found${NC}"
    exit 1
fi

# Set default values if not provided
SERVICE_ACCOUNT_NAME="${SERVICE_ACCOUNT_NAME:-claude-code-client}"
SERVICE_ACCOUNTS_DIR="service_accounts"
KEY_FILE="${SERVICE_ACCOUNTS_DIR}/${PROJECT_ID}_service_account.json"
SYMLINK_FILE="service_account.json"

# Create service_accounts directory if it doesn't exist
mkdir -p ${SERVICE_ACCOUNTS_DIR}

SERVICE_ACCOUNT_EMAIL="${SERVICE_ACCOUNT_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

# Check if service account exists
echo -e "${YELLOW}Checking if service account exists...${NC}"
if ! gcloud iam service-accounts describe ${SERVICE_ACCOUNT_EMAIL} --project=${PROJECT_ID} &>/dev/null; then
    echo -e "${RED}Error: Service account ${SERVICE_ACCOUNT_EMAIL} does not exist${NC}"
    echo -e "${YELLOW}Run './scripts/setup-service-account.sh' first${NC}"
    exit 1
fi

# Check if key file already exists
if [ -f ${KEY_FILE} ]; then
    echo -e "${YELLOW}Warning: ${KEY_FILE} already exists${NC}"
    read -p "Do you want to overwrite it? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo -e "${YELLOW}Aborted${NC}"
        exit 0
    fi
fi

# Create and download the key
echo -e "${GREEN}Creating and downloading service account key...${NC}"
echo -e "${YELLOW}Saving to: ${KEY_FILE}${NC}"
gcloud iam service-accounts keys create ${KEY_FILE} \
    --iam-account=${SERVICE_ACCOUNT_EMAIL} \
    --project=${PROJECT_ID}

if [ -f ${KEY_FILE} ]; then
    echo -e "${GREEN}✓ Service account key downloaded successfully to ${KEY_FILE}${NC}"

    # Create symlink for backward compatibility
    if [ -L ${SYMLINK_FILE} ] || [ -f ${SYMLINK_FILE} ]; then
        rm -f ${SYMLINK_FILE}
    fi
    ln -s ${KEY_FILE} ${SYMLINK_FILE}
    echo -e "${GREEN}✓ Created symlink: ${SYMLINK_FILE} -> ${KEY_FILE}${NC}"

    echo -e "${YELLOW}⚠️  IMPORTANT: Keep this file secure and never commit it to version control${NC}"
    echo -e "${YELLOW}The service_accounts directory is already added to .gitignore${NC}"
else
    echo -e "${RED}Error: Failed to download service account key${NC}"
    exit 1
fi