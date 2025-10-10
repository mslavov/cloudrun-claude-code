# Project Management Guide

This guide explains how to manage multiple GCP projects for deploying the Cloud Run Claude Code service.

## Overview

The project management system allows you to:
- Switch between different GCP projects easily
- Maintain separate configurations per project
- Automatically sync gcloud configuration
- Keep sensitive credentials in Secret Manager

## Directory Structure

```
cloudrun-claude-code/
├── projects/           # Project configurations
│   ├── bugzy-ai.env   # Configuration for bugzy-ai project
│   └── my-dev.env     # Configuration for development project
├── secrets/           # Client/tenant secrets (gitignored)
│   ├── bugzy-ai.secrets
│   └── negbg.secrets
├── .env              # Symlink to current project config
└── .current-project  # Tracks active project
```

## Quick Start

### 1. List Available Projects

```bash
./scripts/project.sh list
```

Shows all configured projects with the current one highlighted.

### 2. Switch Between Projects

```bash
# Switch to bugzy-ai project
./scripts/project.sh use bugzy-ai

# Switch to development project
./scripts/project.sh use my-dev
```

This command:
- Updates the `.env` symlink to point to the selected project config
- Sets gcloud default project
- Verifies access to the GCP project

### 3. Add a New Project

```bash
./scripts/project.sh add production
```

Interactive wizard that prompts for:
- GCP Project ID
- Region
- Service name
- Resource configuration (CPU, memory, instances)
- VPC settings (optional)

### 4. Check Current Project

```bash
./scripts/project.sh current
```

Shows:
- Current active project name
- GCP Project ID
- Whether gcloud is properly configured

### 5. View Project Details

```bash
# View current project details
./scripts/project.sh info

# View specific project details
./scripts/project.sh info bugzy-ai
```

### 6. Remove a Project

```bash
./scripts/project.sh remove old-project
```

## Deployment Workflow

After selecting a project, use the standard deployment scripts:

```bash
# 1. Switch to desired project
./scripts/project.sh use production

# 2. Create/update secrets in Secret Manager
./scripts/create-secrets.sh

# 3. Build and push Docker image
./scripts/build-and-push.sh

# 4. Deploy the service
./scripts/deploy-service.sh
```

## Project Configuration

Each project configuration (`projects/<project-name>.env`) contains:

### GCP Settings
- `PROJECT_ID` - GCP project ID
- `REGION` - Deployment region
- `SERVICE_NAME` - Cloud Run service name
- `REPOSITORY` - Artifact Registry repository name

### Resource Configuration
- `CPU` - CPU allocation (e.g., "2")
- `MEMORY` - Memory allocation (e.g., "4Gi")
- `TIMEOUT` - Request timeout in seconds
- `CONCURRENCY` - Requests per instance
- `MIN_INSTANCES` - Minimum instances (0 for scale-to-zero)
- `MAX_INSTANCES` - Maximum instances

### Claude Code Settings
- `ALLOWED_TOOLS` - Tools available to Claude
- `PERMISSION_MODE` - Permission handling mode
- `DANGEROUSLY_SKIP_PERMISSIONS` - Bypass tool permissions
- `LOG_LEVEL` - Log level (info: shows Claude output, warnings, errors | debug: shows everything including proxy logs)

### Network Configuration (Optional)
- `ENABLE_VPC` - Enable VPC connector
- `VPC_NETWORK` - VPC network name
- `VPC_SUBNET` - Subnet name
- `SUBNET_RANGE` - Subnet IP range

## Secrets Management

### Authentication Secrets

**IMPORTANT**: The service uses **payload-based authentication**. API keys/OAuth tokens are passed in each request's JSON payload, not stored as service-level secrets.

Optional secrets in Google Secret Manager (via `./scripts/create-secrets.sh`):
- `GIT_SSH_KEY` - Global SSH key for private repository access (fallback when not provided in request payload)
- `ANTHROPIC_API_KEY` - Optional, for local testing/debugging only (not used in production)

### Client/Tenant Secrets

Store client-specific secrets in `secrets/` directory:
- `secrets/bugzy-ai.secrets` - Bugzy AI client secrets
- `secrets/negbg.secrets` - NEGBG client secrets

These files are gitignored and should contain client-specific tokens (Notion, Slack, etc).

Upload them using:
```bash
./scripts/create-tenant-secret.sh <repo> <branch> secrets/<client>.secrets
```

## Important Notes

1. **First Time Setup**: After cloning the repository, you need to:
   - Create at least one project configuration
   - Upload secrets to Secret Manager
   - Build and deploy

2. **Switching Projects**: Always use `./scripts/project.sh use <project>` to ensure:
   - `.env` symlink is updated
   - gcloud default project is set correctly
   - Project access is verified

3. **Security**:
   - Never commit secrets to git
   - Keep authentication tokens in Secret Manager
   - Project configs can be committed (they don't contain secrets)
   - Client secrets in `secrets/` are gitignored

4. **Backwards Compatibility**:
   - If no project is selected, scripts will use existing `.env` if present
   - You can still manually edit `.env` for one-off deployments

## Troubleshooting

### "No project currently selected"
```bash
./scripts/project.sh use <project-name>
```

### "Project not found"
```bash
# List available projects
./scripts/project.sh list

# Add the missing project
./scripts/project.sh add <project-name>
```

### "Cannot access project"
- Ensure you're authenticated: `gcloud auth login`
- Verify project access: `gcloud projects describe <project-id>`
- Check billing is enabled for the project

### Gcloud project mismatch
```bash
# Re-sync gcloud configuration
./scripts/project.sh use <current-project>
```

## Example: Setting Up Multiple Projects

```bash
# 1. Add production project
./scripts/project.sh add production
# Enter: prod-project-123, us-central1, etc.

# 2. Add staging project
./scripts/project.sh add staging
# Enter: staging-project-456, us-central1, etc.

# 3. Add development project
./scripts/project.sh add dev
# Enter: dev-project-789, us-central1, etc.

# 4. Deploy to production
./scripts/project.sh use production
./scripts/create-secrets.sh
./scripts/build-and-push.sh
./scripts/deploy-service.sh

# 5. Deploy to staging
./scripts/project.sh use staging
./scripts/create-secrets.sh
./scripts/build-and-push.sh
./scripts/deploy-service.sh
```