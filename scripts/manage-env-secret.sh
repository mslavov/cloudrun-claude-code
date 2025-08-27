#!/bin/bash

# Script to manage repository-specific environment secrets in Google Secret Manager
# Usage: ./manage-env-secret.sh <action> <org> <repo> [branch]
#
# Actions:
#   create  - Create a new secret (reads from stdin)
#   update  - Update an existing secret (reads from stdin)
#   delete  - Delete a secret
#   get     - Retrieve and display a secret
#   list    - List all env secrets
#
# Examples:
#   cat .env | ./manage-env-secret.sh create mycompany backend
#   cat .env.staging | ./manage-env-secret.sh create mycompany backend staging
#   ./manage-env-secret.sh get mycompany backend
#   ./manage-env-secret.sh delete mycompany backend staging
#   ./manage-env-secret.sh list

set -e

# Load environment variables if available
if [ -f "$(dirname "$0")/load-env.sh" ]; then
  source "$(dirname "$0")/load-env.sh"
fi

# Configuration
PROJECT_ID="${PROJECT_ID:-your-project-id}"

# Parse arguments
ACTION="$1"
ORG="$2"
REPO="$3"
BRANCH="$4"

# Function to display usage
show_usage() {
  echo "Usage: $0 <action> <org> <repo> [branch]"
  echo ""
  echo "Actions:"
  echo "  create  - Create a new secret (reads from stdin)"
  echo "  update  - Update an existing secret (reads from stdin)"
  echo "  delete  - Delete a secret"
  echo "  get     - Retrieve and display a secret"
  echo "  list    - List all env secrets"
  echo ""
  echo "Examples:"
  echo "  cat .env | $0 create mycompany backend"
  echo "  cat .env.staging | $0 create mycompany backend staging"
  echo "  $0 get mycompany backend"
  echo "  $0 delete mycompany backend staging"
  echo "  $0 list"
  exit 1
}

# Validate arguments
if [ "$ACTION" = "list" ]; then
  # List doesn't need other arguments
  :
elif [ -z "$ACTION" ] || [ -z "$ORG" ] || [ -z "$REPO" ]; then
  show_usage
fi

# Convert to lowercase for consistency
ORG=$(echo "$ORG" | tr '[:upper:]' '[:lower:]')
REPO=$(echo "$REPO" | tr '[:upper:]' '[:lower:]')
[ -n "$BRANCH" ] && BRANCH=$(echo "$BRANCH" | tr '[:upper:]' '[:lower:]')

# Build secret name
SECRET_NAME="env-${ORG}-${REPO}"
[ -n "$BRANCH" ] && [ "$BRANCH" != "main" ] && [ "$BRANCH" != "master" ] && SECRET_NAME="${SECRET_NAME}-${BRANCH}"

# Execute action
case "$ACTION" in
  create)
    echo "Creating secret: ${SECRET_NAME}"
    if gcloud secrets describe "${SECRET_NAME}" --project="${PROJECT_ID}" &>/dev/null; then
      echo "Error: Secret ${SECRET_NAME} already exists. Use 'update' to modify it."
      exit 1
    fi
    
    # Read from stdin
    ENV_CONTENT=$(cat)
    if [ -z "$ENV_CONTENT" ]; then
      echo "Error: No content provided. Please pipe in the .env file content."
      exit 1
    fi
    
    echo -n "${ENV_CONTENT}" | gcloud secrets create "${SECRET_NAME}" \
      --data-file=- \
      --project="${PROJECT_ID}" \
      --labels="type=env,org=${ORG},repo=${REPO}${BRANCH:+,branch=${BRANCH}}"
    
    echo "✓ Secret ${SECRET_NAME} created successfully"
    ;;
    
  update)
    echo "Updating secret: ${SECRET_NAME}"
    if ! gcloud secrets describe "${SECRET_NAME}" --project="${PROJECT_ID}" &>/dev/null; then
      echo "Error: Secret ${SECRET_NAME} does not exist. Use 'create' to create it first."
      exit 1
    fi
    
    # Read from stdin
    ENV_CONTENT=$(cat)
    if [ -z "$ENV_CONTENT" ]; then
      echo "Error: No content provided. Please pipe in the .env file content."
      exit 1
    fi
    
    echo -n "${ENV_CONTENT}" | gcloud secrets versions add "${SECRET_NAME}" \
      --data-file=- \
      --project="${PROJECT_ID}"
    
    echo "✓ Secret ${SECRET_NAME} updated successfully"
    ;;
    
  delete)
    echo "Deleting secret: ${SECRET_NAME}"
    if ! gcloud secrets describe "${SECRET_NAME}" --project="${PROJECT_ID}" &>/dev/null; then
      echo "Error: Secret ${SECRET_NAME} does not exist."
      exit 1
    fi
    
    read -p "Are you sure you want to delete ${SECRET_NAME}? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
      gcloud secrets delete "${SECRET_NAME}" \
        --project="${PROJECT_ID}" \
        --quiet
      echo "✓ Secret ${SECRET_NAME} deleted successfully"
    else
      echo "Deletion cancelled"
    fi
    ;;
    
  get)
    echo "Retrieving secret: ${SECRET_NAME}"
    if ! gcloud secrets describe "${SECRET_NAME}" --project="${PROJECT_ID}" &>/dev/null; then
      echo "Error: Secret ${SECRET_NAME} does not exist."
      exit 1
    fi
    
    gcloud secrets versions access latest \
      --secret="${SECRET_NAME}" \
      --project="${PROJECT_ID}"
    ;;
    
  list)
    echo "Listing environment secrets in project: ${PROJECT_ID}"
    echo ""
    gcloud secrets list \
      --project="${PROJECT_ID}" \
      --filter="labels.type=env" \
      --format="table(name,labels.org,labels.repo,labels.branch,createTime.date('%Y-%m-%d'))"
    ;;
    
  *)
    echo "Error: Unknown action '${ACTION}'"
    show_usage
    ;;
esac