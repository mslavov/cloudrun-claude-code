#!/bin/bash

# Load environment variables from .env file if it exists

# Find the script's directory and project root
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Load .env file if it exists
if [ -f "${PROJECT_ROOT}/.env" ]; then
  echo "Loading environment variables from .env file..."
  set -a
  source "${PROJECT_ROOT}/.env"
  set +a
  echo "✓ Environment variables loaded"
else
  echo "⚠️  No .env file found. Using default values or environment variables."
  echo "   To create one: cp .env.example .env"
fi