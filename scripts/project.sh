#!/bin/bash

# Project management script for switching between GCP projects
# Usage: ./scripts/project.sh [command] [args]

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Script directory and project root
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$(dirname "$DIR")"
PROJECTS_DIR="${PROJECT_ROOT}/projects"
CURRENT_PROJECT_FILE="${PROJECT_ROOT}/.current-project"

# Ensure projects directory exists
mkdir -p "${PROJECTS_DIR}"

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

print_info() {
    echo -e "${BLUE}ℹ${NC} $1"
}

# Function to show usage
show_usage() {
    echo "Project Management for Cloud Run Claude Code"
    echo ""
    echo "Usage: $0 [command] [args]"
    echo ""
    echo "Commands:"
    echo "  list              List all configured projects"
    echo "  use <project>     Switch to a specific project"
    echo "  add <project>     Add a new project configuration"
    echo "  current           Show the current active project"
    echo "  info [project]    Show detailed info about a project (default: current)"
    echo "  remove <project>  Remove a project configuration"
    echo ""
    echo "Examples:"
    echo "  $0 list"
    echo "  $0 add my-new-project"
    echo "  $0 use bugzy-ai"
    echo "  $0 current"
    echo ""
    echo "After switching projects, use the regular deployment scripts:"
    echo "  ./scripts/deploy-service.sh"
    echo "  ./scripts/build-and-push.sh"
}

# Function to list all projects
list_projects() {
    echo "Available projects:"
    echo ""

    # Get current project
    CURRENT=""
    if [ -f "${CURRENT_PROJECT_FILE}" ]; then
        CURRENT=$(cat "${CURRENT_PROJECT_FILE}")
    fi

    # List all project files
    if [ -d "${PROJECTS_DIR}" ]; then
        for project_file in "${PROJECTS_DIR}"/*.env; do
            if [ -f "$project_file" ]; then
                PROJECT_NAME=$(basename "$project_file" .env)
                PROJECT_ID=$(grep "^PROJECT_ID=" "$project_file" 2>/dev/null | cut -d'=' -f2 || echo "not-set")
                REGION=$(grep "^REGION=" "$project_file" 2>/dev/null | cut -d'=' -f2 || echo "not-set")
                SERVICE=$(grep "^SERVICE_NAME=" "$project_file" 2>/dev/null | cut -d'=' -f2 || echo "not-set")

                if [ "$PROJECT_NAME" = "$CURRENT" ]; then
                    echo -e "  ${GREEN}→${NC} ${PROJECT_NAME} ${GREEN}(current)${NC}"
                    echo "      Project ID: ${PROJECT_ID}"
                    echo "      Region: ${REGION}"
                    echo "      Service: ${SERVICE}"
                else
                    echo "    ${PROJECT_NAME}"
                    echo "      Project ID: ${PROJECT_ID}"
                    echo "      Region: ${REGION}"
                    echo "      Service: ${SERVICE}"
                fi
                echo ""
            fi
        done
    fi

    # Check if no projects found
    if [ -z "$(ls -A ${PROJECTS_DIR}/*.env 2>/dev/null)" ]; then
        print_warning "No projects configured yet"
        echo "    Use '$0 add <project-name>' to add a project"
    fi
}

# Function to get current project
get_current() {
    if [ -f "${CURRENT_PROJECT_FILE}" ]; then
        CURRENT=$(cat "${CURRENT_PROJECT_FILE}")
        if [ -f "${PROJECTS_DIR}/${CURRENT}.env" ]; then
            echo "$CURRENT"
            return 0
        fi
    fi
    return 1
}

# Function to show current project
show_current() {
    if CURRENT=$(get_current); then
        PROJECT_FILE="${PROJECTS_DIR}/${CURRENT}.env"
        PROJECT_ID=$(grep "^PROJECT_ID=" "$PROJECT_FILE" 2>/dev/null | cut -d'=' -f2 || echo "not-set")

        print_status "Current project: ${CURRENT}"
        echo "  Project ID: ${PROJECT_ID}"

        # Check gcloud config
        GCLOUD_PROJECT=$(gcloud config get-value project 2>/dev/null || echo "")
        if [ "$GCLOUD_PROJECT" = "$PROJECT_ID" ]; then
            echo "  gcloud project: ${GREEN}✓ ${GCLOUD_PROJECT}${NC}"
        else
            echo "  gcloud project: ${YELLOW}⚠ ${GCLOUD_PROJECT} (mismatched)${NC}"
            echo ""
            echo "  Run '$0 use ${CURRENT}' to sync gcloud configuration"
        fi
    else
        print_warning "No project currently selected"
        echo "  Use '$0 use <project-name>' to select a project"
    fi
}

# Function to use/switch to a project
use_project() {
    PROJECT_NAME="$1"

    if [ -z "$PROJECT_NAME" ]; then
        print_error "Project name required"
        echo "Usage: $0 use <project-name>"
        return 1
    fi

    PROJECT_FILE="${PROJECTS_DIR}/${PROJECT_NAME}.env"

    if [ ! -f "$PROJECT_FILE" ]; then
        print_error "Project '${PROJECT_NAME}' not found"
        echo "Available projects:"
        for f in "${PROJECTS_DIR}"/*.env; do
            if [ -f "$f" ]; then
                echo "  - $(basename "$f" .env)"
            fi
        done
        return 1
    fi

    # Load project configuration to get PROJECT_ID
    PROJECT_ID=$(grep "^PROJECT_ID=" "$PROJECT_FILE" | cut -d'=' -f2)

    if [ -z "$PROJECT_ID" ]; then
        print_error "PROJECT_ID not found in ${PROJECT_FILE}"
        return 1
    fi

    print_info "Switching to project: ${PROJECT_NAME}"

    # Set current project
    echo "$PROJECT_NAME" > "${CURRENT_PROJECT_FILE}"

    # Create/update symlink to current project env
    ln -sf "${PROJECT_FILE}" "${PROJECT_ROOT}/.env"
    print_status "Updated .env symlink"

    # Switch gcloud default project
    print_info "Setting gcloud default project to: ${PROJECT_ID}"
    if gcloud config set project "${PROJECT_ID}" 2>/dev/null; then
        print_status "gcloud project set to: ${PROJECT_ID}"
    else
        print_warning "Could not set gcloud project. You may not have access to ${PROJECT_ID}"
        echo "  Run 'gcloud auth login' if you need to authenticate"
    fi

    # Verify the project exists and we have access
    if gcloud projects describe "${PROJECT_ID}" &>/dev/null; then
        print_status "Verified access to project: ${PROJECT_ID}"
    else
        print_warning "Cannot access project ${PROJECT_ID}"
        echo "  Make sure you have the necessary permissions"
    fi

    print_status "Switched to project: ${PROJECT_NAME}"
    echo ""
    echo "You can now use the deployment scripts:"
    echo "  ./scripts/create-secrets.sh    # Upload secrets"
    echo "  ./scripts/build-and-push.sh    # Build and push image"
    echo "  ./scripts/deploy-service.sh    # Deploy service"
}

# Function to add a new project
add_project() {
    PROJECT_NAME="$1"

    if [ -z "$PROJECT_NAME" ]; then
        print_error "Project name required"
        echo "Usage: $0 add <project-name>"
        return 1
    fi

    PROJECT_FILE="${PROJECTS_DIR}/${PROJECT_NAME}.env"

    if [ -f "$PROJECT_FILE" ]; then
        print_warning "Project '${PROJECT_NAME}' already exists"
        read -p "Do you want to overwrite it? (y/N): " -r
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            print_info "Aborted"
            return 1
        fi
    fi

    print_info "Adding new project: ${PROJECT_NAME}"
    echo ""

    # Get project configuration
    read -p "GCP Project ID: " PROJECT_ID
    read -p "Region [europe-west3]: " REGION
    REGION=${REGION:-europe-west3}
    read -p "Service Name [${PROJECT_NAME}-agent]: " SERVICE_NAME
    SERVICE_NAME=${SERVICE_NAME:-${PROJECT_NAME}-agent}
    read -p "Repository Name [claude-code]: " REPOSITORY
    REPOSITORY=${REPOSITORY:-claude-code}

    # Resource configuration
    echo ""
    echo "Resource Configuration (press Enter for defaults):"
    read -p "CPU [2]: " CPU
    CPU=${CPU:-2}
    read -p "Memory [4Gi]: " MEMORY
    MEMORY=${MEMORY:-4Gi}
    read -p "Timeout in seconds [3600]: " TIMEOUT
    TIMEOUT=${TIMEOUT:-3600}
    read -p "Concurrency [3]: " CONCURRENCY
    CONCURRENCY=${CONCURRENCY:-3}
    read -p "Min Instances [0]: " MIN_INSTANCES
    MIN_INSTANCES=${MIN_INSTANCES:-0}
    read -p "Max Instances [10]: " MAX_INSTANCES
    MAX_INSTANCES=${MAX_INSTANCES:-10}

    # VPC configuration
    echo ""
    read -p "Enable VPC? (y/N): " ENABLE_VPC_INPUT
    if [[ $ENABLE_VPC_INPUT =~ ^[Yy]$ ]]; then
        ENABLE_VPC="true"
        read -p "VPC Network [default]: " VPC_NETWORK
        VPC_NETWORK=${VPC_NETWORK:-default}
        read -p "VPC Subnet [serverless-subnet]: " VPC_SUBNET
        VPC_SUBNET=${VPC_SUBNET:-serverless-subnet}
        read -p "Subnet Range [10.0.0.0/28]: " SUBNET_RANGE
        SUBNET_RANGE=${SUBNET_RANGE:-10.0.0.0/28}
    else
        ENABLE_VPC="false"
        VPC_NETWORK="default"
        VPC_SUBNET="serverless-subnet"
        SUBNET_RANGE="10.0.0.0/28"
    fi

    # Create project configuration file
    cat > "$PROJECT_FILE" << EOF
# Google Cloud Configuration for ${PROJECT_NAME}
PROJECT_ID=${PROJECT_ID}
REGION=${REGION}

# Service Configuration
SERVICE_NAME=${SERVICE_NAME}
REPOSITORY=${REPOSITORY}
IMAGE_NAME=claude-code
TAG=latest

# Resource Configuration
CPU=${CPU}
MEMORY=${MEMORY}
TIMEOUT=${TIMEOUT}
CONCURRENCY=${CONCURRENCY}
MIN_INSTANCES=${MIN_INSTANCES}
MAX_INSTANCES=${MAX_INSTANCES}

# Network Configuration
ENABLE_VPC=${ENABLE_VPC}
VPC_NETWORK=${VPC_NETWORK}
VPC_SUBNET=${VPC_SUBNET}
SUBNET_RANGE=${SUBNET_RANGE}

# Claude Code Configuration
ALLOWED_TOOLS="Read,Write,Grep,Bash(npm run test:*),WebSearch"
PERMISSION_MODE=acceptEdits

# Advanced Configuration
DANGEROUSLY_SKIP_PERMISSIONS=false
LOG_CLAUDE_OUTPUT=true
CLAUDE_DEBUG=false

# Authentication tokens are stored in Secret Manager
# Use ./scripts/create-secrets.sh to upload them
EOF

    print_status "Project configuration created: ${PROJECT_FILE}"

    # Ask if user wants to switch to this project
    echo ""
    read -p "Switch to this project now? (Y/n): " -r
    if [[ ! $REPLY =~ ^[Nn]$ ]]; then
        use_project "$PROJECT_NAME"
    else
        print_info "Project added. Use '$0 use ${PROJECT_NAME}' to switch to it"
    fi
}

# Function to show project info
show_info() {
    PROJECT_NAME="$1"

    # If no project specified, use current
    if [ -z "$PROJECT_NAME" ]; then
        if ! PROJECT_NAME=$(get_current); then
            print_error "No current project selected and no project specified"
            echo "Usage: $0 info [project-name]"
            return 1
        fi
    fi

    PROJECT_FILE="${PROJECTS_DIR}/${PROJECT_NAME}.env"

    if [ ! -f "$PROJECT_FILE" ]; then
        print_error "Project '${PROJECT_NAME}' not found"
        return 1
    fi

    echo "Project: ${PROJECT_NAME}"
    echo "Configuration file: ${PROJECT_FILE}"
    echo ""
    echo "Settings:"
    echo "----------------------------------------"
    cat "$PROJECT_FILE" | grep -v "^#" | grep -v "^$" | while read line; do
        echo "  $line"
    done
}

# Function to remove a project
remove_project() {
    PROJECT_NAME="$1"

    if [ -z "$PROJECT_NAME" ]; then
        print_error "Project name required"
        echo "Usage: $0 remove <project-name>"
        return 1
    fi

    PROJECT_FILE="${PROJECTS_DIR}/${PROJECT_NAME}.env"

    if [ ! -f "$PROJECT_FILE" ]; then
        print_error "Project '${PROJECT_NAME}' not found"
        return 1
    fi

    # Check if it's the current project
    if [ -f "${CURRENT_PROJECT_FILE}" ]; then
        CURRENT=$(cat "${CURRENT_PROJECT_FILE}")
        if [ "$CURRENT" = "$PROJECT_NAME" ]; then
            print_warning "This is the current active project"
        fi
    fi

    read -p "Are you sure you want to remove project '${PROJECT_NAME}'? (y/N): " -r
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        print_info "Aborted"
        return 1
    fi

    rm -f "$PROJECT_FILE"

    # If it was the current project, remove current marker
    if [ "$CURRENT" = "$PROJECT_NAME" ]; then
        rm -f "${CURRENT_PROJECT_FILE}"
        rm -f "${PROJECT_ROOT}/.env"
        print_warning "Removed current project marker. Please select a new project with '$0 use <project>'"
    fi

    print_status "Project '${PROJECT_NAME}' removed"
}

# Main command handler
case "$1" in
    list|ls)
        list_projects
        ;;
    use|switch)
        use_project "$2"
        ;;
    add|create)
        add_project "$2"
        ;;
    current)
        show_current
        ;;
    info|show)
        show_info "$2"
        ;;
    remove|rm|delete)
        remove_project "$2"
        ;;
    "")
        show_usage
        ;;
    *)
        print_error "Unknown command: $1"
        echo ""
        show_usage
        exit 1
        ;;
esac