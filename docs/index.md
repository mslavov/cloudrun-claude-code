# Claude Code on Cloud Run - Documentation

Welcome to the comprehensive documentation for the Claude Code Cloud Run service. This service wraps the Claude Code TypeScript SDK to provide a production-ready deployment with dynamic configuration for MCP servers, system prompts, and tool permissions.

## 📚 Documentation Structure

### Getting Started
- **[README](../README.md)** - Project overview, features, and quick start guide (root)
- **[API Reference](api-reference.md)** - Complete API endpoint documentation
- **[Testing Guide](testing.md)** - Local and remote testing instructions

### Deployment & Operations
- **[Deployment Guide](deployment.md)** - Step-by-step Cloud Run deployment
- **[Project Management](project-management.md)** - Managing secrets and configuration

### Development
- **[Claude Configuration](../CLAUDE.md)** - Claude Code guidance and configuration (root)
- **[Per-Repository SSH Keys](per-repo-ssh-keys.md)** - SSH deployment key management

## 🚀 Quick Navigation

### For First-Time Users
1. Start with the [README](../README.md) for an overview
2. Follow the [Deployment Guide](deployment.md) to set up your service
3. Use the [Testing Guide](testing.md) to verify your installation

### For Developers
1. Review [Claude Configuration](../CLAUDE.md) for development guidelines
2. Check the [API Reference](api-reference.md) for endpoint details
3. See [Per-Repository SSH Keys](per-repo-ssh-keys.md) for secure git operations

### For Operations Teams
1. Use [Project Management](project-management.md) for secrets and config
2. Follow [Deployment Guide](deployment.md) for production setup
3. Review [Testing Guide](testing.md) for monitoring and validation

## 📖 Documentation Overview

### Core Documentation

#### [README](../README.md)
The main entry point covering:
- Project features and architecture
- Quick start instructions
- Configuration options
- Basic usage examples

#### [API Reference](api-reference.md)
Complete API documentation including:
- `/run` endpoint for Claude execution
- `/api/secrets/*` endpoints for secret management
- Request/response schemas
- Authentication details

#### [Deployment Guide](deployment.md)
Comprehensive deployment instructions:
- Prerequisites and setup
- Google Cloud configuration
- Service deployment scripts
- Cost management and scaling

### Operational Documentation

#### [Testing Guide](testing.md)
Testing and validation procedures:
- Local development testing
- Remote service testing
- Authentication testing
- Example client implementations

#### [Project Management](project-management.md)
Configuration and secret management:
- Secret Manager integration
- Environment variable management
- Service account configuration
- Multi-project support

### Development Documentation

#### [Claude Configuration](../CLAUDE.md)
Guidelines for Claude Code development:
- Codebase conventions
- Architecture decisions
- Key implementation details
- Common issues and solutions

#### [Per-Repository SSH Keys](per-repo-ssh-keys.md)
SSH deployment key implementation:
- Per-repository key management
- API endpoints for SSH keys
- Security considerations
- Migration from global keys

## 🔗 External Resources

- [Claude Code Official Documentation](https://docs.claude.ai/claude-code)
- [Google Cloud Run Documentation](https://cloud.google.com/run/docs)
- [Secret Manager Documentation](https://cloud.google.com/secret-manager/docs)

## 📝 Contributing to Documentation

When updating documentation:
1. Keep markdown files in the `/docs` directory
2. Update this index when adding new documents
3. Use consistent formatting and structure
4. Include practical examples where possible
5. Update cross-references when moving content

## 🏗️ Project Structure

```
cloudrun-claude-code/
├── README.md               # Main project documentation (root)
├── CLAUDE.md               # Claude Code configuration (root)
├── docs/                   # Additional documentation
│   ├── index.md            # Documentation index (this file)
│   ├── api-reference.md   # API documentation
│   ├── deployment.md      # Deployment guide
│   ├── testing.md         # Testing guide
│   ├── project-management.md # Project configuration
│   └── per-repo-ssh-keys.md # SSH key management
├── src/                    # Source code
├── examples/               # Example implementations
├── scripts/                # Deployment scripts
└── tmp/                    # Temporary files (gitignored)