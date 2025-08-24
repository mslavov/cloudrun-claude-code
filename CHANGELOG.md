# Changelog

## Deployment Improvements (2025-08-23)

### Added
- **`scripts/setup-project.sh`** - One-time setup script that:
  - Enables all required Google Cloud APIs automatically
  - Creates Artifact Registry repository
  - Configures Docker authentication
  - Sets up IAM permissions for Secret Manager access
  - Validates project configuration

- **`DEPLOYMENT.md`** - Comprehensive deployment guide with:
  - Step-by-step instructions
  - Troubleshooting section
  - Cost management tips
  - Clean up instructions

- **`TESTING.md`** - Testing documentation
- **`scripts/test.sh`** - Consolidated test script (renamed from test-all.sh)

### Updated

#### Scripts
- **`scripts/create-secrets.sh`**
  - Now checks and enables Secret Manager API automatically
  - Better error handling

- **`scripts/build-and-push.sh`**
  - Checks and enables required APIs (Artifact Registry, Cloud Build)
  - Creates Artifact Registry repository if it doesn't exist
  - Configures Docker authentication automatically
  - Added timeout and better error handling

- **`scripts/deploy-service.sh`**
  - Checks and enables Cloud Run API
  - Automatically creates environment variable configuration file
  - Grants IAM permissions to service account
  - Better error handling and status messages
  - Fixed issue with special characters in environment variables

#### Configuration
- **`.gitignore`** - Added `.env.deploy` and `.env.deploy.yaml` to ignore list
- **`README.md`** - Updated with streamlined deployment process

### Removed
- Consolidated and removed duplicate test scripts:
  - `examples/test-api.sh`
  - `scripts/test-service.sh`
  - `scripts/test-auth.sh`
  - `examples/api-request.json`
  - `test-local.sh`

### Fixed
- Environment variable handling for special characters (parentheses in ALLOWED_TOOLS)
- Secret mounting in different directories to avoid conflicts
- Service account IAM permissions for Secret Manager access
- API enablement timing issues with sleep delays

## Deployment Process

The deployment is now streamlined to just 4 commands:

```bash
./scripts/setup-project.sh     # One-time setup
./scripts/create-secrets.sh    # Create secrets
./scripts/build-and-push.sh    # Build and push image
./scripts/deploy-service.sh    # Deploy to Cloud Run
```

## Service Configuration

- Successfully deployed to: `https://bugzy-agent-t2c47qxnna-ey.a.run.app`
- Region: `europe-west3`
- Authentication: OAuth token from Claude subscription
- Resources: 2 CPU, 4GB RAM, 15-minute timeout
- Auto-scaling: 0-10 instances

## File Organization

```
/
├── scripts/
│   ├── setup-project.sh     # NEW: One-time setup
│   ├── create-secrets.sh    # UPDATED: Auto-enables APIs
│   ├── build-and-push.sh    # UPDATED: Creates repository
│   ├── deploy-service.sh    # UPDATED: Handles IAM & env vars
│   ├── setup-vpc.sh         # Optional VPC setup
│   ├── load-env.sh          # Helper for loading .env
│   └── test.sh              # Consolidated testing script
├── src/
│   └── server.ts            # Main application
├── DEPLOYMENT.md            # NEW: Deployment guide
├── TESTING.md               # NEW: Testing documentation
├── README.md                # UPDATED: Streamlined instructions
└── CHANGELOG.md             # NEW: This file
```