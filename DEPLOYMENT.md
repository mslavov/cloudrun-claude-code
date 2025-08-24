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

### 2. Set Authentication

Choose one of the following authentication methods:

#### Option A: API Key
```bash
# Add to .env file:
ANTHROPIC_API_KEY=sk-ant-...
```

#### Option B: OAuth Token (for Claude Pro/Max subscribers)
```bash
# Get token from Claude Code CLI
npm install -g @anthropic-ai/claude-code
claude setup-token

# Add to .env file:
CLAUDE_CODE_OAUTH_TOKEN=<your-token>
```

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
# Create/update secrets in Secret Manager
./scripts/create-secrets.sh

# Build and push Docker image to Artifact Registry
./scripts/build-and-push.sh

# Deploy to Cloud Run (with authentication required)
./scripts/deploy-service.sh

# Set up service account for client authentication
./scripts/setup-service-account.sh

# Download service account key for local testing
./scripts/download-service-account-key.sh
```

The deployment script will output your service URL. Note: The service now requires authentication.

### 6. Test the Deployment

#### Using gcloud authentication (for developers)
```bash
# Test the deployed service
./scripts/test.sh remote

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

1. **Secret Manager Secrets:**
   - `CLAUDE_CODE_OAUTH_TOKEN` - OAuth token for Claude Pro/Max users
   - Or `ANTHROPIC_API_KEY` - API key for direct Anthropic API access

2. **Artifact Registry:**
   - Docker repository for your container images
   - Located at: `{region}-docker.pkg.dev/{project-id}/claude-code`

3. **Cloud Run Service:**
   - Fully managed serverless container
   - Auto-scaling from 0 to max instances
   - HTTPS endpoint with authentication

## Configuration Details

### Service Resources
- **CPU:** 2 vCPUs (configurable in .env)
- **Memory:** 4GB (configurable in .env)
- **Timeout:** 15 minutes (configurable in .env)
- **Concurrency:** 10 requests per instance
- **Scaling:** 0-10 instances (configurable in .env)

### Security
- **Authentication:** Service requires authentication (no public access)
- **Service Account:** Dedicated service account for client applications
- **Secrets:** Mounted securely via Secret Manager
- **Ephemeral workspace:** /tmp cleared per request
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

### Update Secrets
```bash
# Edit your local files, then:
./scripts/create-secrets.sh
# Restart service to pick up new secrets
gcloud run services update {service-name} --region={region}
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

2. Verify authentication token is set:
   ```bash
   gcloud secrets versions access latest --secret="CLAUDE_CODE_OAUTH_TOKEN"
   ```

3. Test with minimal request:
   ```bash
   ./scripts/test.sh remote
   ```

## Cost Management

### Minimize Costs
- Set `MIN_INSTANCES=0` to scale to zero when not in use
- Use appropriate CPU/memory settings
- Set reasonable timeout values
- Monitor usage in Cloud Console

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

# Delete secrets
gcloud secrets delete CLAUDE_CODE_OAUTH_TOKEN
# Delete any additional secrets like GITHUB_TOKEN, SLACK_BOT_TOKEN if created

# Delete Artifact Registry repository
gcloud artifacts repositories delete claude-code --location={region}
```