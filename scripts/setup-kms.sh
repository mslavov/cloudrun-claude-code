#!/bin/bash
#
# Setup Cloud KMS for async task payload encryption
# This script is idempotent - safe to run multiple times
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
KEYRING="cloudrun-claude-code-keys"
KEY="async-task-payload-key"

echo "=== Cloud KMS Setup for Task Payload Encryption ==="
echo ""
echo "Project: ${PROJECT_ID}"
echo "Location: ${LOCATION}"
echo "Key Ring: ${KEYRING}"
echo "Key: ${KEY}"
echo ""

# Create key ring (idempotent - fails silently if exists)
echo "📦 Creating key ring: ${KEYRING}"
gcloud kms keyrings create "${KEYRING}" \
  --location="${LOCATION}" \
  --project="${PROJECT_ID}" \
  2>/dev/null && echo "✅ Key ring created" || echo "✅ Key ring already exists"

# Create encryption key (idempotent)
echo ""
echo "🔑 Creating crypto key: ${KEY}"
gcloud kms keys create "${KEY}" \
  --keyring="${KEYRING}" \
  --location="${LOCATION}" \
  --purpose=encryption \
  --rotation-period=90d \
  --project="${PROJECT_ID}" \
  2>/dev/null && echo "✅ Key created" || echo "✅ Key already exists"

# Get service account
echo ""
echo "🔍 Finding service account..."
SERVICE_SA=$(gcloud run services describe bugzy-agent \
  --region="${LOCATION}" \
  --format='value(spec.template.spec.serviceAccountName)' \
  --project="${PROJECT_ID}" 2>/dev/null || echo "")

if [ -z "$SERVICE_SA" ]; then
  echo "⚠️  Service 'bugzy-agent' not found in ${LOCATION}"
  echo "⚠️  Deploy the service first, then run this script again to grant KMS permissions"
else
  echo "✅ Service account: ${SERVICE_SA}"

  # Grant encrypt/decrypt permissions to service account
  echo ""
  echo "🔐 Granting KMS permissions to service account..."
  gcloud kms keys add-iam-policy-binding "${KEY}" \
    --keyring="${KEYRING}" \
    --location="${LOCATION}" \
    --member="serviceAccount:${SERVICE_SA}" \
    --role="roles/cloudkms.cryptoKeyEncrypterDecrypter" \
    --project="${PROJECT_ID}" \
    --quiet

  echo "✅ KMS permissions granted"
fi

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Key resource name:"
gcloud kms keys describe "${KEY}" \
  --keyring="${KEYRING}" \
  --location="${LOCATION}" \
  --format="value(name)" \
  --project="${PROJECT_ID}"

echo ""
echo "Test encryption with:"
echo "  echo 'test data' | gcloud kms encrypt \\"
echo "    --keyring=${KEYRING} \\"
echo "    --key=${KEY} \\"
echo "    --location=${LOCATION} \\"
echo "    --plaintext-file=- \\"
echo "    --ciphertext-file=-"
