# Deployment Guide

This guide walks you through deploying Claude Code to Google Cloud Run with Cloud Run Jobs architecture.

**Architecture:** The service uses Cloud Run Jobs for task execution with Cloud KMS encryption for secure credential handling. API requests trigger isolated job executions instead of running tasks in-process.

## Prerequisites

- Google Cloud Project with billing enabled
- `gcloud` CLI installed and configured
- Docker installed (for local testing)
- Node.js 20+
- Either an Anthropic API key OR Claude OAuth token

## Step-by-Step Deployment

### 1. Clone and Configure

```bash
# Clone the repository (if not already done)
git clone <your-repo-url>
cd cloudrun-claude-code

# Install dependencies
npm install

# Copy and configure environment files
cp .env.example .env

# Edit .env with your configuration
vim .env
```

### 2. Understand Authentication Model

**IMPORTANT**: This service uses a **payload-based authentication model**. API keys/OAuth tokens are passed in each request's JSON payload, not as environment variables.

For local testing, you can optionally set environment variables:
```bash
# Option A: API Key
export ANTHROPIC_API_KEY=sk-ant-...

# Option B: OAuth Token (for Claude Pro/Max subscribers)
npm install -g @anthropic-ai/claude-code
claude setup-token
export CLAUDE_CODE_OAUTH_TOKEN=<your-token>
```

**Note**: These environment variables are only for local testing convenience. In production, all credentials (API keys, OAuth tokens, SSH keys) are passed in the request payload for better security isolation.

### 3. Configure Google Cloud

Edit the `.env` file with your Google Cloud settings:

```bash
PROJECT_ID=your-project-id
REGION=us-central1  # or your preferred region
SERVICE_NAME=claude-code-service
```

### 4. Run Setup Script

The setup script handles all Google Cloud configuration automatically:

```bash
# This script will:
# - Enable required APIs (Secret Manager, Cloud Run, Artifact Registry, Cloud Build)
# - Create Artifact Registry repository
# - Configure Docker authentication
# - Set up IAM permissions
./scripts/setup-project.sh
```

### 5. Set Up Cloud KMS

Cloud KMS is required for encrypting task payloads before job execution:

```bash
# Set up Cloud KMS keyring and key
./scripts/setup-kms.sh

# This will:
# - Enable Cloud KMS API
# - Create KMS keyring: claude-code
# - Create KMS key: payload-encryption
# - Grant encrypt/decrypt permissions to service account
# - Update .env with KMS configuration
```

### 6. Build and Push Docker Image

```bash
# Build and push Docker image to Artifact Registry
./scripts/build-and-push.sh

# This creates the container image used by both API service and Cloud Run Job
```

### 7. Deploy Cloud Run Job

The Cloud Run Job executes tasks in isolated containers:

```bash
# Deploy Cloud Run Job
./scripts/deploy-job.sh

# This will:
# - Create Cloud Run Job: claude-code-job
# - Configure job to run job-worker.ts entrypoint
# - Set memory, CPU, and timeout configuration
# - Update .env with CLOUDRUN_JOB_NAME
```

### 8. Grant IAM Permissions

```bash
# Grant permissions for jobs and KMS
./scripts/grant-job-permissions.sh

# This grants:
# - API service: run.jobs.run, cloudkms.cryptoKeyVersions.useToEncrypt/useToDecrypt
# - Job worker: storage.objects.get/create, cloudkms.cryptoKeyVersions.useToDecrypt
```

### 9. Deploy API Service

```bash
# Deploy API service to Cloud Run (with authentication required)
./scripts/deploy-service.sh

# This creates the API service that triggers Cloud Run Jobs
```

### 10. Set Up Service Account for Client Authentication

```bash
# Set up service account for client authentication (idempotent, safe to re-run)
./scripts/setup-service-account.sh

# Download service account key for local testing
./scripts/download-service-account-key.sh
```

The deployment scripts will output your service URL. Note: The service requires authentication.

### 11. (Optional) Set Up Async Task Webhooks

If you need async task execution with webhook callbacks, configure webhook authentication:

**Note:** The GCS bucket (set up in Step 4) is already configured for both /run and /run-async endpoints. This step only sets up webhook authentication for /run-async callbacks.

```bash
# Generate webhook authentication secret
WEBHOOK_SECRET=$(openssl rand -hex 32)
echo "CLOUDRUN_CALLBACK_SECRET=$WEBHOOK_SECRET" >> .env

# Create webhook secret in Secret Manager
./scripts/create-secrets.sh

# This will:
# - Enable Secret Manager API if needed
# - Create CLOUDRUN_CALLBACK_SECRET for webhook authentication

# Redeploy with updated environment variables and secrets
./scripts/deploy-service.sh
```

**What this enables:**
- `/run-async` endpoint with webhook callbacks when tasks complete
- HMAC-authenticated webhook callbacks for secure task completion notifications

**Storage costs:**
- GCS storage: ~$0.023/GB/month (standard storage in us-central1)
- Each task generates ~1-10MB of logs depending on output volume
- Set lifecycle policies to auto-delete old logs:

```bash
# Create lifecycle policy to delete logs older than 30 days
cat > lifecycle.json << 'EOF'
{
  "lifecycle": {
    "rule": [{
      "action": {"type": "Delete"},
      "condition": {"age": 30}
    }]
  }
}
EOF

gcloud storage buckets update gs://your-project-id-claude-logs \
  --lifecycle-file=lifecycle.json
```

### 12. Test the Deployment

#### Using gcloud authentication (for developers)
```bash
# Test the synchronous /run endpoint
./scripts/test.sh remote

# Test async task execution
./scripts/test.sh remote-async

# Run all tests
./scripts/test.sh all

# Or use the authenticated curl example
./examples/authenticated-curl.sh
```

#### Using service account (for applications)
```bash
# JavaScript example
node examples/authenticated-client.js

# Python example
python examples/authenticated-client.py
```

## What Gets Deployed

The deployment creates:

1. **Artifact Registry:**
   - Docker repository for your container images
   - Located at: `{region}-docker.pkg.dev/{project-id}/claude-code`
   - Single image used by both API service and Cloud Run Job

2. **Cloud KMS:**
   - Key ring: `claude-code`
   - Encryption key: `payload-encryption`
   - Used to encrypt task payloads before job execution
   - Automatic key rotation available

3. **Cloud Run Service (API Service):**
   - Triggers Cloud Run Job executions
   - Streams logs via SSE for sync requests
   - Returns immediately for async requests
   - HTTPS endpoint with authentication
   - No CPU-always-allocated needed (jobs handle execution)

4. **Cloud Run Job:**
   - Executes tasks in isolated containers
   - Runs `job-worker.ts` entrypoint
   - Reads encrypted payloads from GCS
   - Decrypts using Cloud KMS
   - Streams output to GCS
   - Executes post-execution actions (git, file uploads)

5. **GCS Bucket:**
   - Stores task logs and encrypted payloads
   - Located at: `gs://{bucket-name}/sessions/{task-id}/`
   - Lifecycle policies (30-day auto-delete)
   - Required for both `/run` and `/run-async` endpoints

6. **Secret Manager (Optional - for async webhooks):**
   - Stores `CLOUDRUN_CALLBACK_SECRET` for webhook HMAC authentication
   - Mounted to Cloud Run service as environment variable
   - Used to sign webhook callbacks to your application

**Note**: API keys, OAuth tokens, and SSH keys are passed in request payloads (not stored as secrets). Task payloads are encrypted with KMS before storage and decrypted in job workers.

## Configuration Details

### Service Resources
- **CPU:** 2 vCPUs (configurable in .env)
- **Memory:** 4GB (configurable in .env)
- **Timeout:** 15 minutes (configurable in .env, Cloud Run Jobs support up to 24 hours)
- **Concurrency:** 1 request per instance (security isolation)
- **Scaling:** 0-10 instances (configurable in .env)
- **Per-request resources:** Full 4GB RAM, 2 CPU cores
- **Total capacity:** 10 concurrent requests (10 instances × 1 each)

### Security
- **Payload-Based Authentication:** API keys and OAuth tokens passed in request payload for isolation
- **Payload-Based SSH Keys:** SSH keys passed in request payload for per-request isolation
- **Token Proxy:** Prevents Claude from accessing real API credentials
- **Git Command Security:** Claude's git commands use per-request SSH keys via GIT_SSH_COMMAND
- **User Isolation:** Separate users in Docker (serveruser/claudeuser)
- **Service Account:** Dedicated service account for client applications
- **Ephemeral workspace:** /tmp cleared per request with automatic cleanup
- **Credential Isolation:** All credentials (API keys, SSH keys, env vars) are per-request
- **Concurrency=1:** Complete process isolation between requests
- **No persistent storage:** Stateless service

### Authentication Methods

1. **For developers:** Use `gcloud auth print-identity-token`
2. **For applications:** Use service account with `service_account.json`
3. **For CI/CD:** Mount service account key as secret

## Updating the Service

### Update Code
```bash
# Make your changes, then:
./scripts/build-and-push.sh
./scripts/deploy-service.sh
```

### Update Configuration
```bash
# Edit .env, then redeploy:
./scripts/deploy-service.sh
```

## Monitoring

### View Logs
```bash
gcloud run services logs read {service-name} --region={region} --limit=50
```

### View Metrics
```bash
# Open in browser
gcloud run services describe {service-name} --region={region} --format="value(status.url)"
# Then navigate to Cloud Console for metrics
```

## Troubleshooting

### Missing Required Environment Variables
If endpoints return errors about missing environment variables:
1. Ensure `GCS_LOGS_BUCKET` is set (required for both /run and /run-async)
2. Ensure KMS variables are set: `KMS_KEY_RING`, `KMS_KEY_NAME`, `KMS_LOCATION`
3. Ensure `CLOUDRUN_JOB_NAME` is set
4. Run `./scripts/setup-kms.sh` if KMS not configured
5. Run `./scripts/deploy-job.sh` if Cloud Run Job not deployed
6. Redeploy API service: `./scripts/deploy-service.sh`

### Cloud Run Job Not Found
If API service returns "Cloud Run Job not found":
1. Verify job exists: `gcloud run jobs list --region=us-central1`
2. Check `CLOUDRUN_JOB_NAME` matches deployed job name in .env
3. Redeploy job: `./scripts/deploy-job.sh`
4. Ensure job service account has proper permissions: `./scripts/grant-job-permissions.sh`

### KMS Permission Denied
If you see "Permission denied" errors related to KMS:
1. Run `./scripts/grant-job-permissions.sh` to grant permissions
2. Verify KMS key exists: `gcloud kms keys list --location=global --keyring=claude-code`
3. Check service account has `cloudkms.cryptoKeyVersions.useToEncrypt` and `useToDecrypt` roles
4. Re-run setup if needed: `./scripts/setup-kms.sh`

### Job Execution Failures
If jobs fail to execute or timeout:
1. Check job logs: `gcloud run jobs executions logs read JOB_EXECUTION_NAME --region=us-central1`
2. List job executions: `gcloud run jobs executions list CLOUDRUN_JOB_NAME --region=us-central1`
3. Verify job has enough memory/CPU (configured in deploy-job.sh)
4. Check encrypted payload exists in GCS
5. Ensure job timeout is sufficient (Cloud Run Jobs support up to 24 hours)

### Deployment Fails

1. **API not enabled error:**
   - Run `./scripts/setup-project.sh` to enable all APIs
   - Run `./scripts/setup-kms.sh` to enable KMS API

2. **Permission denied on secrets:**
   - The setup script should handle this, but you can manually grant:
   ```bash
   gcloud projects add-iam-policy-binding {project-id} \
     --member="serviceAccount:{project-number}-compute@developer.gserviceaccount.com" \
     --role="roles/secretmanager.secretAccessor"
   ```

3. **Build fails:**
   - Check Cloud Build logs:
   ```bash
   gcloud builds list --limit=5
   gcloud builds log {build-id}
   ```

### Service Not Responding

1. Check service logs:
   ```bash
   gcloud run services logs read {service-name} --region={region}
   ```

2. Check job logs:
   ```bash
   gcloud run jobs executions list {job-name} --region={region} --limit=5
   gcloud run jobs executions logs read {execution-name} --region={region}
   ```

3. Verify you have an Anthropic API key to include in requests:
   ```bash
   # API keys are passed in request payload, not environment variables
   echo "anthropicApiKey: sk-ant-..."
   ```

4. Test with minimal request:
   ```bash
   ./scripts/test.sh remote
   ```

## Cost Management

### Minimize Costs
- Set `MIN_INSTANCES=0` to scale to zero when not in use
- Use appropriate CPU/memory settings
- Set reasonable timeout values (but note: longer timeouts mean longer billing)
- Monitor usage in Cloud Console
- **Concurrency=1**: Provides maximum isolation but lower throughput per instance

### Free Tier
Cloud Run offers a generous free tier:
- 2 million requests per month
- 360,000 GB-seconds of memory
- 180,000 vCPU-seconds

## Authentication Setup

### Service Account Creation

The service is deployed with authentication required (no public access). To allow applications to access it:

```bash
# Create service account and grant permissions
./scripts/setup-service-account.sh

# Download key for local development
./scripts/download-service-account-key.sh
```

This creates:
- Service account: `claude-code-client@{project-id}.iam.gserviceaccount.com`
- IAM role: `roles/run.invoker` on the Cloud Run service
- Local key file: `service_account.json` (git-ignored)

### Client Authentication Examples

See the `examples/` directory for authentication examples:
- `authenticated-client.js` - Node.js/JavaScript
- `authenticated-client.py` - Python
- `authenticated-curl.sh` - Shell/curl with gcloud

## Clean Up

To remove all resources:

```bash
# Delete Cloud Run service
gcloud run services delete {service-name} --region={region}

# Delete service account
gcloud iam service-accounts delete claude-code-client@{project-id}.iam.gserviceaccount.com

# Note: No secrets are stored in Secret Manager - all credentials are payload-based

# Delete Artifact Registry repository
gcloud artifacts repositories delete claude-code --location={region}
```