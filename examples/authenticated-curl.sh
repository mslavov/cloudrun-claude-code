#!/bin/bash

# Example of authenticating to the Cloud Run service using gcloud and curl

set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# Load environment variables if available
if [ -f .env ]; then
    source .env
fi

# Service URL (replace with your actual URL or set in .env)
SERVICE_URL="${SERVICE_URL:-https://your-service-name-xxxxx.run.app}"

echo -e "${YELLOW}Authenticating to Cloud Run service...${NC}"
echo -e "Service URL: ${SERVICE_URL}"

# Get an identity token using gcloud
echo -e "${GREEN}Getting identity token...${NC}"
TOKEN=$(gcloud auth print-identity-token)

if [ -z "$TOKEN" ]; then
    echo -e "${RED}Error: Failed to get identity token${NC}"
    echo -e "${YELLOW}Make sure you're authenticated with gcloud${NC}"
    exit 1
fi

# Make an authenticated request
echo -e "${GREEN}Making authenticated request...${NC}"
curl -X POST "${SERVICE_URL}/run" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "What is 3+3?",
    "maxTurns": 1,
    "mcpConfigJson": {"mcpServers": {}},
    "allowedTools": [],
    "permissionMode": "acceptEdits"
  }' \
  --silent --show-error

echo -e "${GREEN}✓ Request completed${NC}"