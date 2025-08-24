#!/bin/bash

# Setup VPC network and subnet for Cloud Run with Direct VPC egress

set -e

# Load environment variables
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
source "${DIR}/load-env.sh"

# Configuration
PROJECT_ID="${PROJECT_ID:-your-project-id}"
REGION="${REGION:-us-central1}"
VPC_NETWORK="${VPC_NETWORK:-default}"
VPC_SUBNET="${VPC_SUBNET:-serverless-subnet}"
SUBNET_RANGE="${SUBNET_RANGE:-10.0.0.0/28}"

echo "Setting up VPC configuration for project: ${PROJECT_ID}"

# Check if using default network
if [ "$VPC_NETWORK" = "default" ]; then
  echo "Using default VPC network"
else
  # Create custom VPC network if it doesn't exist
  if ! gcloud compute networks describe "${VPC_NETWORK}" --project="${PROJECT_ID}" &>/dev/null; then
    echo "Creating VPC network: ${VPC_NETWORK}"
    gcloud compute networks create "${VPC_NETWORK}" \
      --subnet-mode=custom \
      --project="${PROJECT_ID}"
  else
    echo "VPC network ${VPC_NETWORK} already exists"
  fi
fi

# Create subnet for serverless VPC access
if ! gcloud compute networks subnets describe "${VPC_SUBNET}" \
  --region="${REGION}" \
  --project="${PROJECT_ID}" &>/dev/null; then
  echo "Creating subnet: ${VPC_SUBNET}"
  gcloud compute networks subnets create "${VPC_SUBNET}" \
    --network="${VPC_NETWORK}" \
    --region="${REGION}" \
    --range="${SUBNET_RANGE}" \
    --project="${PROJECT_ID}"
else
  echo "Subnet ${VPC_SUBNET} already exists"
fi

# Create firewall rules for egress control
FIREWALL_RULE_NAME="allow-claude-egress"

# Check if firewall rule exists
if ! gcloud compute firewall-rules describe "${FIREWALL_RULE_NAME}" \
  --project="${PROJECT_ID}" &>/dev/null; then
  echo "Creating firewall rule: ${FIREWALL_RULE_NAME}"
  
  # Allow egress to Anthropic API and common services
  gcloud compute firewall-rules create "${FIREWALL_RULE_NAME}" \
    --network="${VPC_NETWORK}" \
    --action=ALLOW \
    --direction=EGRESS \
    --priority=1000 \
    --destination-ranges="0.0.0.0/0" \
    --rules=tcp:443,tcp:80 \
    --target-tags=claude-code \
    --project="${PROJECT_ID}"
  
  echo "✓ Firewall rule created"
else
  echo "Firewall rule ${FIREWALL_RULE_NAME} already exists"
fi

echo ""
echo "VPC setup complete!"
echo "Network: ${VPC_NETWORK}"
echo "Subnet: ${VPC_SUBNET} (${SUBNET_RANGE})"
echo "Region: ${REGION}"