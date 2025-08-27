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

# Install Claude Code using the official install script
# This installs the proper distribution that supports OAuth tokens
ARG CLAUDE_CODE_VERSION=1.0.89
RUN curl -fsSL https://claude.ai/install.sh | bash -s ${CLAUDE_CODE_VERSION} && \
    # Move all Claude installation to /opt
    mv /root/.claude /opt/claude && \
    mv /root/.local/share/claude /opt/claude-share && \
    # Create the actual binary in /usr/local/bin
    echo '#!/bin/bash' > /usr/local/bin/claude && \
    echo 'exec /opt/claude-share/versions/1.0.89 "$@"' >> /usr/local/bin/claude && \
    chmod +x /usr/local/bin/claude && \
    chmod +x /opt/claude-share/versions/1.0.89

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
    # Ensure appuser can access Claude installation
    chown -R appuser:appuser /opt/claude && \
    chown -R appuser:appuser /opt/claude-share && \
    # Create .claude symlink for appuser
    ln -s /opt/claude /home/appuser/.claude && \
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