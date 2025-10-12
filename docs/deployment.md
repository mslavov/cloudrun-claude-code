# Deployment Guide

This guide walks you through deploying Claude Code to Google Cloud Run.

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

### 5. Deploy the Service

```bash
# Build and push Docker image to Artifact Registry
./scripts/build-and-push.sh

# Deploy to Cloud Run (with authentication required)
./scripts/deploy-service.sh

# Set up service account for client authentication (idempotent, safe to re-run)
./scripts/setup-service-account.sh

# Download service account key for local testing
./scripts/download-service-account-key.sh
```

The deployment script will output your service URL. Note: The service now requires authentication.

### 6. (Optional) Set Up Async Task Support

If you need async task execution with background processing, set up a GCS bucket for logs.

**Option A: Let setup-project.sh handle it (recommended for new projects)**

```bash
# 1. Add GCS_LOGS_BUCKET to your .env file
echo "GCS_LOGS_BUCKET=your-project-id-claude-logs" >> .env

# 2. Run setup script (safe to run on existing projects - it's idempotent)
./scripts/setup-project.sh

# This will:
# - Enable storage API
# - Create GCS bucket
# - Set lifecycle policy (30-day auto-delete)
# - Grant storage permissions to service account

# 3. Redeploy with updated environment variable
./scripts/deploy-service.sh
```

**Option B: Manual setup**

```bash
# 1. Add GCS_LOGS_BUCKET to your .env file
echo "GCS_LOGS_BUCKET=your-project-id-claude-logs" >> .env

# 2. Create the GCS bucket
gcloud storage buckets create gs://your-project-id-claude-logs \
  --project=${PROJECT_ID} \
  --location=${REGION} \
  --uniform-bucket-level-access

# 3. Grant storage permissions to service account
./scripts/setup-service-account.sh

# 4. Redeploy with updated environment variable
./scripts/deploy-service.sh
```

**What this enables:**
- `/run-async` endpoint for background task execution
- JSONL logs streamed to GCS
- Webhook callbacks when tasks complete
- Better handling of long-running tasks (up to Cloud Run's 60-minute limit)

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

### 7. Test the Deployment

#### Using gcloud authentication (for developers)
```bash
# Test the synchronous /run endpoint
./scripts/test.sh remote

# Test async task execution (requires GCS_LOGS_BUCKET setup)
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

2. **Cloud Run Service:**
   - Fully managed serverless container
   - Auto-scaling from 0 to max instances
   - HTTPS endpoint with authentication
   - CONCURRENCY=1 for maximum security isolation

3. **GCS Bucket (Optional - for async tasks):**
   - Stores JSONL logs from async task execution
   - Requires `roles/storage.objectAdmin` permission
   - Located at: `gs://{bucket-name}/sessions/{task-id}/`
   - Lifecycle policies recommended for cost management

**Note**: All credentials (API keys, OAuth tokens, SSH keys) are passed in request payloads, not stored as service-level secrets.

## Configuration Details

### Service Resources
- **CPU:** 2 vCPUs (configurable in .env)
- **Memory:** 4GB (configurable in .env)
- **Timeout:** 15 minutes (configurable in .env, up to 60 min max)
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

### Deployment Fails

1. **API not enabled error:**
   - Run `./scripts/setup-project.sh` to enable all APIs

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

2. Verify you have an Anthropic API key to include in requests:
   ```bash
   # API keys are passed in request payload, not environment variables
   echo "anthropicApiKey: sk-ant-..."
   ```

3. Test with minimal request:
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