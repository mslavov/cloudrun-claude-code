# ---- build stage ----
FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- runtime stage ----
FROM node:20-bookworm-slim
WORKDIR /app

# Install system dependencies needed for Claude Code SDK
RUN apt-get update && apt-get install -y --no-install-recommends \
    bash git ripgrep ca-certificates curl openssh-client \
  && rm -rf /var/lib/apt/lists/*

# Install Claude Code globally via npm (always gets latest version)
# This approach matches the GitHub Action implementation and simplifies version management
RUN npm install -g @anthropic-ai/claude-code

# Set up environment
ENV NODE_ENV=production
ENV NODE_PATH=/usr/local/lib/node_modules
ENV PATH="/usr/local/lib/node_modules/.bin:${PATH}"

# Copy built application
COPY --from=build /app/dist ./dist
COPY package*.json ./

# Install production dependencies (without claude-code since it's global now)
RUN npm ci --omit=dev

# No default MCP or system prompt paths - all configuration is dynamic

# Create non-root user with home directory (needed for Claude Code)
RUN useradd -m -u 1001 -s /bin/bash appuser && \
    chown -R appuser:appuser /app && \
    # Setup SSH directory for appuser
    mkdir -p /home/appuser/.ssh && \
    chmod 700 /home/appuser/.ssh && \
    chown -R appuser:appuser /home/appuser/.ssh && \
    # Create secrets directory
    mkdir -p /secrets && \
    chown appuser:appuser /secrets

# Switch to non-root user
USER appuser

# Configure git to skip host verification for SSH
RUN git config --global core.sshCommand "ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null"

EXPOSE 8080
CMD ["node", "dist/server.js"]