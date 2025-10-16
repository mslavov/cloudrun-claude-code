# Cloud KMS Setup Guide

This guide explains how to set up Cloud KMS for secure credential encryption in the Claude Code service.

## Table of Contents

1. [Overview](#overview)
2. [Why KMS](#why-kms)
3. [Setup](#setup)
4. [Architecture](#architecture)
5. [Key Management](#key-management)
6. [Troubleshooting](#troubleshooting)
7. [Security Best Practices](#security-best-practices)

## Overview

Cloud Key Management Service (KMS) is used to encrypt task payloads before storage and decrypt them in job workers. This ensures credentials (API keys, OAuth tokens, SSH keys) are never stored unencrypted.

**What Gets Encrypted:**
- Anthropic API keys / OAuth tokens
- SSH private keys
- Environment variables
- Git repository URLs
- Full task configuration

## Why KMS

### Without KMS (Insecure)

```
API Service → Store credentials in GCS → Job Worker reads credentials
              (PLAINTEXT)
```

**Problems:**
- ❌ Credentials stored unencrypted in GCS
- ❌ Anyone with GCS access can read credentials
- ❌ Compliance issues (PCI-DSS, HIPAA, SOC2)
- ❌ Audit trail limited

### With KMS (Secure)

```
API Service → Encrypt with KMS → Store encrypted in GCS → Job Worker → Decrypt with KMS
              (CIPHERTEXT)                                   (PLAINTEXT in memory only)
```

**Benefits:**
- ✅ Credentials encrypted at rest
- ✅ Fine-grained access control (IAM)
- ✅ Automatic key rotation available
- ✅ Full audit logging
- ✅ Compliance-ready

## Setup

### Automated Setup (Recommended)

The easiest way to set up KMS is using the provided script:

```bash
# Run the KMS setup script
./scripts/setup-kms.sh

# This script will:
# 1. Enable Cloud KMS API
# 2. Create keyring: claude-code
# 3. Create key: payload-encryption
# 4. Grant encrypt/decrypt permissions to service account
# 5. Update .env with KMS configuration
```

### Manual Setup

If you prefer manual control:

#### 1. Enable KMS API

```bash
# Load environment variables
source .env

# Enable Cloud KMS API
gcloud services enable cloudkms.googleapis.com --project=${PROJECT_ID}
```

#### 2. Create Key Ring

```bash
# Create keyring (one per region/project)
gcloud kms keyrings create claude-code \
  --location=global \
  --project=${PROJECT_ID}
```

Key rings are containers for keys. Use `global` location for multi-region access.

#### 3. Create Encryption Key

```bash
# Create symmetric encryption key
gcloud kms keys create payload-encryption \
  --location=global \
  --keyring=claude-code \
  --purpose=encryption \
  --project=${PROJECT_ID}
```

**Key Properties:**
- Purpose: `encryption` (symmetric encryption/decryption)
- Algorithm: AES-256-GCM (default)
- Rotation: Manual (can enable automatic rotation)

#### 4. Grant IAM Permissions

```bash
# Get service account email
SERVICE_ACCOUNT_EMAIL="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

# Grant encrypt permission (API service needs this)
gcloud kms keys add-iam-policy-binding payload-encryption \
  --location=global \
  --keyring=claude-code \
  --member="serviceAccount:${SERVICE_ACCOUNT_EMAIL}" \
  --role="roles/cloudkms.cryptoKeyEncrypter" \
  --project=${PROJECT_ID}

# Grant decrypt permission (Job worker needs this)
gcloud kms keys add-iam-policy-binding payload-encryption \
  --location=global \
  --keyring=claude-code \
  --member="serviceAccount:${SERVICE_ACCOUNT_EMAIL}" \
  --role="roles/cloudkms.cryptoKeyDecrypter" \
  --project=${PROJECT_ID}
```

#### 5. Update Environment Variables

Add to `.env`:

```bash
# Cloud KMS Configuration
KMS_KEY_RING=claude-code
KMS_KEY_NAME=payload-encryption
KMS_LOCATION=global
```

#### 6. Redeploy Services

```bash
# Redeploy API service with KMS config
./scripts/deploy-service.sh

# Redeploy job with KMS config
./scripts/deploy-job.sh
```

## Architecture

### Encryption Flow

```
┌─────────────────────────────────────────────────────────┐
│            API Service (Cloud Run Service)               │
│                                                          │
│  1. Receive request with credentials                    │
│     { anthropicApiKey: "sk-ant-...", ... }             │
│                                                          │
│  2. Serialize to JSON                                    │
│     payload = JSON.stringify(request)                   │
│                                                          │
│  3. Call KMS encrypt                                     │
│     encryptedPayload = kms.encrypt(payload, keyName)    │
│                                                          │
│  4. Store encrypted payload in GCS                       │
│     gs://bucket/encrypted-payloads/{taskId}.bin         │
│                                                          │
│  5. Trigger job with task ID                            │
│     jobRun({ env: { TASK_ID: taskId } })               │
└─────────────────────────────────────────────────────────┘
                           │
                           │ Task ID
                           ▼
┌─────────────────────────────────────────────────────────┐
│          Job Worker (Cloud Run Job)                      │
│                                                          │
│  1. Read encrypted payload from GCS                      │
│     encryptedPayload = gcs.read(taskId)                 │
│                                                          │
│  2. Call KMS decrypt                                     │
│     payload = kms.decrypt(encryptedPayload, keyName)    │
│                                                          │
│  3. Parse JSON to get credentials                        │
│     request = JSON.parse(payload)                       │
│     apiKey = request.anthropicApiKey                    │
│                                                          │
│  4. Execute task with credentials (in memory only)      │
│     claudeRun({ apiKey, ... })                          │
│                                                          │
│  5. Cleanup - delete encrypted payload                   │
│     gcs.delete(taskId)                                  │
└─────────────────────────────────────────────────────────┘
```

### Key Access Control

```
┌──────────────────────────────────────────┐
│           Cloud KMS Key                  │
│    claude-code/payload-encryption        │
└────────────┬────────────┬────────────────┘
             │            │
    Encrypt  │            │  Decrypt
     (API)   │            │  (Job Worker)
             │            │
             ▼            ▼
    ┌────────────┐  ┌────────────┐
    │ API Service│  │ Job Worker │
    │  Service   │  │   Service  │
    │  Account   │  │   Account  │
    └────────────┘  └────────────┘
```

Both use the same service account, but permissions can be split for tighter security.

## Key Management

### Viewing Key Information

```bash
# List all keys in keyring
gcloud kms keys list \
  --location=global \
  --keyring=claude-code \
  --project=${PROJECT_ID}

# Describe specific key
gcloud kms keys describe payload-encryption \
  --location=global \
  --keyring=claude-code \
  --project=${PROJECT_ID}

# View IAM policy
gcloud kms keys get-iam-policy payload-encryption \
  --location=global \
  --keyring=claude-code \
  --project=${PROJECT_ID}
```

### Key Rotation

#### Manual Rotation

```bash
# Create new key version (automatic)
gcloud kms keys versions create \
  --location=global \
  --keyring=claude-code \
  --key=payload-encryption \
  --primary \
  --project=${PROJECT_ID}

# Old versions remain for decryption
# New encryptions use new version automatically
```

#### Automatic Rotation

```bash
# Enable automatic rotation (every 90 days)
gcloud kms keys update payload-encryption \
  --location=global \
  --keyring=claude-code \
  --rotation-period=90d \
  --next-rotation-time=$(date -u -d "+90 days" +%Y-%m-%dT%H:%M:%SZ) \
  --project=${PROJECT_ID}
```

**Rotation Behavior:**
- Old key versions remain active for decryption
- New encryptions use latest key version
- Encrypted payloads deleted after task completion
- No re-encryption needed

### Key Versions

```bash
# List all key versions
gcloud kms keys versions list \
  --location=global \
  --keyring=claude-code \
  --key=payload-encryption \
  --project=${PROJECT_ID}

# Disable old key version
gcloud kms keys versions disable VERSION_NUMBER \
  --location=global \
  --keyring=claude-code \
  --key=payload-encryption \
  --project=${PROJECT_ID}

# Destroy key version (irreversible after 24h)
gcloud kms keys versions destroy VERSION_NUMBER \
  --location=global \
  --keyring=claude-code \
  --key=payload-encryption \
  --project=${PROJECT_ID}
```

## Troubleshooting

### Permission Denied Errors

**Symptoms:**
```
Error: Permission denied on resource 'projects/PROJECT/locations/global/keyRings/claude-code/cryptoKeys/payload-encryption'
```

**Solutions:**

1. Check IAM permissions:
   ```bash
   gcloud kms keys get-iam-policy payload-encryption \
     --location=global \
     --keyring=claude-code \
     --project=${PROJECT_ID}
   ```

2. Grant missing permissions:
   ```bash
   ./scripts/grant-job-permissions.sh
   ```

3. Verify service account:
   ```bash
   # Check which service account is being used
   gcloud run services describe claude-code-service \
     --region=us-central1 \
     --format="value(spec.template.spec.serviceAccountName)"
   ```

### Key Not Found

**Symptoms:**
```
Error: Key not found: projects/PROJECT/locations/global/keyRings/claude-code/cryptoKeys/payload-encryption
```

**Solutions:**

1. Verify key exists:
   ```bash
   gcloud kms keys list --location=global --keyring=claude-code --project=${PROJECT_ID}
   ```

2. Check .env configuration:
   ```bash
   grep KMS .env
   # Should show:
   # KMS_KEY_RING=claude-code
   # KMS_KEY_NAME=payload-encryption
   # KMS_LOCATION=global
   ```

3. Re-run setup:
   ```bash
   ./scripts/setup-kms.sh
   ```

### Decryption Failures

**Symptoms:**
```
Error: Failed to decrypt payload: Invalid ciphertext
```

**Solutions:**

1. Check encrypted payload exists:
   ```bash
   gcloud storage ls gs://your-bucket/encrypted-payloads/
   ```

2. Verify key version is enabled:
   ```bash
   gcloud kms keys versions list \
     --location=global \
     --keyring=claude-code \
     --key=payload-encryption \
     --filter="state=ENABLED"
   ```

3. Check logs for specific error:
   ```bash
   gcloud run jobs executions logs read EXECUTION_NAME --region=us-central1 | grep -i decrypt
   ```

## Security Best Practices

### 1. Least Privilege Access

```bash
# Grant only necessary permissions
# API Service: encrypt only
# Job Worker: decrypt only

# Split permissions (advanced):
# Create separate service accounts for API and Job
```

### 2. Enable Audit Logging

```bash
# View KMS audit logs
gcloud logging read "resource.type=cloudkms_cryptokey" \
  --limit=50 \
  --format=json \
  --project=${PROJECT_ID}
```

Monitor for:
- Unauthorized access attempts
- Unusual encryption/decryption patterns
- Permission changes

### 3. Key Rotation

- Enable automatic rotation (90 days recommended)
- Test rotation before enabling
- Monitor old key version usage

### 4. Backup Strategy

KMS keys cannot be exported (by design). To protect against accidental deletion:

```bash
# Prevent key deletion
gcloud kms keys update payload-encryption \
  --location=global \
  --keyring=claude-code \
  --protection-level=software \
  --project=${PROJECT_ID}

# Set IAM policy to prevent deletion
# Grant only cryptoKeyEncrypterDecrypter role, not admin
```

### 5. Multi-Region Setup

For global availability:

```bash
# Create keys in multiple regions
for region in us-central1 europe-west1 asia-east1; do
  gcloud kms keyrings create claude-code \
    --location=${region} \
    --project=${PROJECT_ID}

  gcloud kms keys create payload-encryption \
    --location=${region} \
    --keyring=claude-code \
    --purpose=encryption \
    --project=${PROJECT_ID}
done
```

Update application to use regional keys based on deployment location.

### 6. Monitoring

Set up alerts for:

```bash
# Create alert policy for KMS errors
gcloud alpha monitoring policies create \
  --notification-channels=CHANNEL_ID \
  --display-name="KMS Errors" \
  --condition-display-name="High error rate" \
  --condition-threshold-value=10 \
  --condition-threshold-duration=300s \
  --condition-filter='resource.type="cloudkms_cryptokey" AND severity="ERROR"'
```

## Cost Considerations

### KMS Pricing

- **Key versions:** $0.06/month per active key version
- **Operations:**
  - Encryption: $0.03 per 10,000 operations
  - Decryption: $0.03 per 10,000 operations

### Example Cost

- 1 key with 2 versions (current + rotated): $0.12/month
- 10,000 tasks/month: $0.06 (encrypt + decrypt)
- **Total:** ~$0.18/month

Very affordable for the security benefits!

## Next Steps

- See [Cloud Run Jobs Guide](./cloud-run-jobs.md) for how KMS integrates with job execution
- See [Deployment Guide](./deployment.md) for complete setup instructions
- See [API Reference](./api-reference.md) for how credentials are passed
- Review [Google Cloud KMS Documentation](https://cloud.google.com/kms/docs) for advanced features
