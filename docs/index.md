# Claude Code on Cloud Run - Documentation

Welcome to the comprehensive documentation for the Claude Code Cloud Run service. This service wraps the Claude Code TypeScript SDK to provide a production-ready deployment with dynamic configuration for MCP servers, system prompts, and tool permissions.

## 📚 Documentation Structure

### Getting Started
- **[README](../README.md)** - Project overview, features, and quick start guide (root)
- **[API Reference](api-reference.md)** - Complete API endpoint documentation
- **[Testing Guide](testing.md)** - Local and remote testing instructions

### Deployment & Operations
- **[Deployment Guide](deployment.md)** - Step-by-step Cloud Run deployment
- **[Cloud Run Jobs Architecture](cloud-run-jobs.md)** - Job-based execution architecture
- **[KMS Setup Guide](kms-setup.md)** - Cloud KMS encryption configuration
- **[Project Management](project-management.md)** - Managing secrets and configuration

### Feature Guides
- **[Async Tasks](async-tasks.md)** - Background task execution with webhooks
- **[Post-Execution Actions](post-execution-actions.md)** - Automated git operations and file uploads

### Development
- **[Claude Configuration](../CLAUDE.md)** - Claude Code guidance and configuration (root)
- **[Per-Repository SSH Keys](per-repo-ssh-keys.md)** - SSH deployment key management

## 🚀 Quick Navigation

### For First-Time Users
1. Start with the [README](../README.md) for an overview
2. Follow the [Deployment Guide](deployment.md) to set up your service
3. Review [Cloud Run Jobs Architecture](cloud-run-jobs.md) to understand the execution model
4. Configure security with the [KMS Setup Guide](kms-setup.md)
5. Use the [Testing Guide](testing.md) to verify your installation

### For Developers
1. Review [Claude Configuration](../CLAUDE.md) for development guidelines
2. Check the [API Reference](api-reference.md) for endpoint details
3. Learn about [Async Tasks](async-tasks.md) for background execution
4. Configure [Post-Execution Actions](post-execution-actions.md) for automated workflows
5. See [Per-Repository SSH Keys](per-repo-ssh-keys.md) for secure git operations

### For Operations Teams
1. Understand [Cloud Run Jobs Architecture](cloud-run-jobs.md) for the execution model
2. Set up [KMS encryption](kms-setup.md) for credential security
3. Follow [Deployment Guide](deployment.md) for production setup
4. Use [Project Management](project-management.md) for secrets and config
5. Review [Testing Guide](testing.md) for monitoring and validation

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

#### [Cloud Run Jobs Architecture](cloud-run-jobs.md)
Architecture and implementation of Cloud Run Jobs:
- Why Cloud Run Jobs vs in-process execution
- Component architecture and flow diagrams
- Benefits and trade-offs
- Monitoring and troubleshooting

#### [KMS Setup Guide](kms-setup.md)
Cloud Key Management Service configuration:
- Automated and manual KMS setup
- Encryption architecture and flow
- Key management and rotation
- Security best practices

### Feature Guides

#### [Async Tasks](async-tasks.md)
Background task execution guide:
- Async vs sync execution patterns
- GCS log streaming architecture
- Webhook callbacks and authentication
- Use cases and examples

#### [Post-Execution Actions](post-execution-actions.md)
Automated actions after task completion:
- Git operations (commit, push)
- File uploads to GCS
- Configuration examples
- CI/CD integration patterns

#### [Enhanced Configuration](api-reference.md#enhanced-configuration-mcp-servers-slash-commands-subagents)
Dynamic MCP servers, slash commands, and subagents configuration:
- Per-request MCP server configuration
- Custom slash commands with flexible frontmatter
- Specialized subagents for domain expertise
- Automatic git exclusion for config files
- Examples and best practices

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
│   ├── cloud-run-jobs.md  # Cloud Run Jobs architecture
│   ├── kms-setup.md       # KMS setup guide
│   ├── async-tasks.md     # Async task execution
│   ├── post-execution-actions.md # Post-execution automation
│   ├── testing.md         # Testing guide
│   ├── project-management.md # Project configuration
│   └── per-repo-ssh-keys.md # SSH key management
├── src/                    # Source code
├── examples/               # Example implementations
├── scripts/                # Deployment scripts
└── tmp/                    # Temporary files (gitignored)