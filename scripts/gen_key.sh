#!/bin/bash

# Generate SSH key for Claude Code and add it to GitHub
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "🔑 Claude Code SSH Key Generator"
echo "================================="
echo

# Check if gh CLI is installed
if ! command -v gh &> /dev/null; then
    echo -e "${RED}Error: GitHub CLI (gh) is not installed${NC}"
    echo "Install it with: brew install gh (macOS) or see https://cli.github.com/"
    exit 1
fi

# Check if user is authenticated with gh
if ! gh auth status &> /dev/null; then
    echo -e "${YELLOW}You need to authenticate with GitHub first${NC}"
    echo "Running: gh auth login"
    gh auth login
fi

# Set default key name and create keys directory
KEY_NAME="${1:-claude_ssh_key}"
KEYS_DIR="./.keys"
KEY_PATH="${KEYS_DIR}/${KEY_NAME}"

# Create keys directory if it doesn't exist
if [ ! -d "${KEYS_DIR}" ]; then
    mkdir -p "${KEYS_DIR}"
    echo -e "${GREEN}✓ Created keys directory: ${KEYS_DIR}${NC}"
fi

# Check if key already exists
if [ -f "${KEY_PATH}" ]; then
    echo -e "${YELLOW}Warning: Key file ${KEY_PATH} already exists${NC}"
    read -p "Do you want to overwrite it? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Aborted."
        exit 1
    fi
    rm -f "${KEY_PATH}" "${KEY_PATH}.pub"
fi

# Generate SSH key
echo "📝 Generating SSH key pair..."
ssh-keygen -t ed25519 -C "claude-code@$(hostname)" -f "${KEY_PATH}" -N "" -q
echo -e "${GREEN}✓ SSH key pair generated${NC}"
echo "  Private key: ${KEY_PATH}"
echo "  Public key: ${KEY_PATH}.pub"
echo

# Read the public key
PUBLIC_KEY=$(cat "${KEY_PATH}.pub")

# Add key to GitHub
echo "📤 Adding SSH key to GitHub..."
TITLE="Claude Code ($(hostname) - $(date +%Y-%m-%d))"

if gh ssh-key add "${KEY_PATH}.pub" --title "${TITLE}"; then
    echo -e "${GREEN}✓ SSH key added to GitHub successfully${NC}"
else
    echo -e "${RED}Failed to add SSH key to GitHub${NC}"
    echo "You can manually add it at: https://github.com/settings/keys"
    echo "Public key content:"
    echo "${PUBLIC_KEY}"
    exit 1
fi

# Add to .env file
echo
echo "📝 Adding private key to .env file..."

# Check if .env exists and create if not
if [ ! -f .env ]; then
    echo "# Claude Code environment variables" > .env
fi

# Check if GIT_SSH_KEY already exists in .env
if grep -q "^GIT_SSH_KEY=" .env; then
    echo -e "${YELLOW}Warning: GIT_SSH_KEY already exists in .env${NC}"
    read -p "Do you want to replace it? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        # Remove old GIT_SSH_KEY
        if [[ "$OSTYPE" == "darwin"* ]]; then
            sed -i '' '/^GIT_SSH_KEY=/d' .env
        else
            sed -i '/^GIT_SSH_KEY=/d' .env
        fi
    else
        echo "Skipping .env update"
        echo
        echo "To manually add the key to .env, run:"
        echo "echo 'GIT_SSH_KEY=\"\$(cat ${KEY_PATH})\"' >> .env"
        exit 0
    fi
fi

# Add the private key to .env (properly escaped)
echo "" >> .env
echo "# Git SSH key for cloning private repositories" >> .env
echo "GIT_SSH_KEY=\"$(cat "${KEY_PATH}" | sed ':a;N;$!ba;s/\n/\\n/g')\"" >> .env

echo -e "${GREEN}✓ Private key added to .env${NC}"

# Test the SSH connection
echo
echo "🧪 Testing SSH connection to GitHub..."
if ssh -T git@github.com -o StrictHostKeyChecking=no 2>&1 | grep -q "successfully authenticated"; then
    echo -e "${GREEN}✓ SSH connection to GitHub successful${NC}"
else
    echo -e "${YELLOW}⚠ SSH test returned unexpected result (this might be normal)${NC}"
    echo "You can manually test with: ssh -T git@github.com"
fi

# Provide next steps
echo
echo "✅ Setup Complete!"
echo "=================="
echo
echo "The SSH key has been:"
echo "  1. Generated as ${KEY_PATH} and ${KEY_PATH}.pub"
echo "  2. Added to your GitHub account as '${TITLE}'"
echo "  3. Added to your .env file as GIT_SSH_KEY"
echo
echo "Next steps:"
echo "  1. Deploy the secret to Google Cloud:"
echo "     ./scripts/create-secrets.sh"
echo
echo "  2. Test with a private repository:"
echo "     curl -X POST https://your-service-url/run \\"
echo "       -d '{\"prompt\": \"List files\", \"gitRepo\": \"git@github.com:your-org/private-repo.git\"}'"
echo
echo "⚠️  Security Notes:"
echo "  - Keep ${KEY_PATH} secure and never commit it to git"
echo "  - The .keys directory is automatically gitignored"
echo "  - The .env file should also never be committed"
