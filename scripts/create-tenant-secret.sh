#!/bin/bash

# Create tenant-specific secret in Google Cloud Secret Manager
# Usage: ./scripts/create-tenant-secret.sh <repo> <branch> <env-file>
# Example: ./scripts/create-tenant-secret.sh myorg/myrepo tenants/acme/main .env.acme

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${GREEN}✓${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

# Function to show usage
show_usage() {
    echo "Usage: $0 <repo> <branch> <env-file>"
    echo ""
    echo "Parameters:"
    echo "  repo      Repository in format 'org/repo' or full git URL"
    echo "  branch    Branch name (e.g., 'tenants/acme/main', 'main', 'staging')"
    echo "  env-file  Path to environment file (e.g., '.env.acme', '/path/to/.env.tenant')"
    echo ""
    echo "Examples:"
    echo "  $0 myorg/myrepo tenants/acme/main .env.acme"
    echo "  $0 git@github.com:myorg/myrepo.git tenants/acme .env.acme"
    echo "  $0 myorg/myrepo staging .env.staging"
    echo "  $0 myorg/myrepo main .env.production"
    echo ""
    echo "Environment variables:"
    echo "  PROJECT_ID    GCP Project ID (required)"
    echo "  FORCE_UPDATE  Set to 'true' to update existing secrets"
}

# Check arguments
if [ $# -ne 3 ]; then
    print_error "Invalid number of arguments"
    show_usage
    exit 1
fi

REPO="$1"
BRANCH="$2"
ENV_FILE="$3"

# Load environment variables
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
if [ -f "${DIR}/load-env.sh" ]; then
    source "${DIR}/load-env.sh"
fi

# Check required environment
if [ -z "$PROJECT_ID" ]; then
    print_error "PROJECT_ID environment variable is required"
    echo "Set PROJECT_ID or create a .env file with PROJECT_ID=your-project-id"
    exit 1
fi

# Check if env file exists
if [ ! -f "$ENV_FILE" ]; then
    print_error "Environment file not found: $ENV_FILE"
    exit 1
fi

print_status "Creating tenant secret..."
echo "Repository: $REPO"
echo "Branch: $BRANCH"
echo "Environment file: $ENV_FILE"
echo "Project ID: $PROJECT_ID"
echo ""

# Function to parse repository URL and extract org/repo
parse_repo() {
    local repo_input="$1"
    
    # Handle SSH format: git@github.com:org/repo.git
    if [[ $repo_input =~ git@[^:]+:([^/]+)/([^/\.]+)(\.git)?$ ]]; then
        echo "${BASH_REMATCH[1]}/${BASH_REMATCH[2]}"
        return 0
    fi
    
    # Handle HTTPS format: https://github.com/org/repo.git
    if [[ $repo_input =~ https?://[^/]+/([^/]+)/([^/\.]+)(\.git)?$ ]]; then
        echo "${BASH_REMATCH[1]}/${BASH_REMATCH[2]}"
        return 0
    fi
    
    # Handle simple format: org/repo
    if [[ $repo_input =~ ^([^/]+)/([^/]+)$ ]]; then
        echo "$repo_input"
        return 0
    fi
    
    print_error "Could not parse repository: $repo_input"
    print_error "Expected formats: 'org/repo', 'git@host:org/repo.git', or 'https://host/org/repo.git'"
    exit 1
}

# Function to build secret name
build_secret_name() {
    local org_repo="$1"
    local branch="$2"
    
    # Convert to lowercase and replace special characters
    local org=$(echo "$org_repo" | cut -d'/' -f1 | tr '[:upper:]' '[:lower:]')
    local repo=$(echo "$org_repo" | cut -d'/' -f2 | tr '[:upper:]' '[:lower:]')
    
    # Base secret name
    local secret_name="env_${org}_${repo}"
    
    # Add branch if not main/master
    if [ "$branch" != "main" ] && [ "$branch" != "master" ]; then
        # Replace slashes with double underscores
        local sanitized_branch=$(echo "$branch" | sed 's/\//__/g')
        secret_name="${secret_name}_${sanitized_branch}"
    fi
    
    echo "$secret_name"
}

# Parse repository
ORG_REPO=$(parse_repo "$REPO")
print_status "Parsed repository: $ORG_REPO"

# Build secret name
SECRET_NAME=$(build_secret_name "$ORG_REPO" "$BRANCH")
print_status "Secret name: $SECRET_NAME"

# Check if secret already exists
SECRET_EXISTS=false
if gcloud secrets describe "$SECRET_NAME" --project="$PROJECT_ID" >/dev/null 2>&1; then
    SECRET_EXISTS=true
    print_warning "Secret '$SECRET_NAME' already exists"
    
    if [ "$FORCE_UPDATE" != "true" ]; then
        echo ""
        echo "Options:"
        echo "1. Set FORCE_UPDATE=true to update the existing secret"
        echo "2. Use a different branch name"
        echo "3. Delete the existing secret first: gcloud secrets delete $SECRET_NAME --project=$PROJECT_ID"
        echo ""
        read -p "Do you want to update the existing secret? (y/N): " -r
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            print_error "Aborted"
            exit 1
        fi
    fi
fi

# Enable Secret Manager API if not already enabled
print_status "Checking Secret Manager API..."
if ! gcloud services list --enabled --project="$PROJECT_ID" | grep -q "secretmanager.googleapis.com"; then
    print_warning "Enabling Secret Manager API..."
    gcloud services enable secretmanager.googleapis.com --project="$PROJECT_ID"
    print_status "Secret Manager API enabled"
    sleep 3  # Wait for API to be ready
fi

# Create or update secret
if [ "$SECRET_EXISTS" = "true" ]; then
    print_status "Updating existing secret..."
    cat "$ENV_FILE" | gcloud secrets versions add "$SECRET_NAME" \
        --data-file=- \
        --project="$PROJECT_ID"
    print_status "Secret '$SECRET_NAME' updated successfully"
else
    print_status "Creating new secret..."
    
    # Extract tenant name from branch for labels (if it's a tenant branch)
    TENANT_LABEL=""
    if [[ $BRANCH =~ tenants/([^/]+) ]]; then
        TENANT_LABEL="tenant=${BASH_REMATCH[1]},"
    fi
    
    # Extract org and repo for labels
    ORG_NAME=$(echo "$ORG_REPO" | cut -d'/' -f1)
    REPO_NAME=$(echo "$ORG_REPO" | cut -d'/' -f2)
    
    # Create the secret with labels
    cat "$ENV_FILE" | gcloud secrets create "$SECRET_NAME" \
        --data-file=- \
        --project="$PROJECT_ID" \
        --labels="type=env,org=${ORG_NAME},repo=${REPO_NAME},${TENANT_LABEL}created_by=script"
    
    print_status "Secret '$SECRET_NAME' created successfully"
fi

# Show secret information
echo ""
print_status "Secret Information:"
echo "  Name: $SECRET_NAME"
echo "  Project: $PROJECT_ID"
echo "  Full Path: projects/$PROJECT_ID/secrets/$SECRET_NAME"

# Show how to access the secret
echo ""
print_status "To view the secret content:"
echo "  gcloud secrets versions access latest --secret=\"$SECRET_NAME\" --project=\"$PROJECT_ID\""

# Show labels information
echo ""
print_status "Secret labels:"
gcloud secrets describe "$SECRET_NAME" --project="$PROJECT_ID" --format="value(labels)" 2>/dev/null || echo "  (no labels)"

print_status "Done!"