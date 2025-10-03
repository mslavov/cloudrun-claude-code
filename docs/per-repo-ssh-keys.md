# Per-Repository SSH Keys

This document describes how SSH keys are managed for private git repository access in the Cloud Run Claude Code service.

## Architecture Change

**Important:** The service has moved from API-based SSH key management to a **payload-based approach**. SSH keys are now passed directly in the `/run` request payload rather than being stored in Secret Manager ahead of time.

This architecture better supports orchestration systems like Agent Forge, which can dynamically provide the appropriate SSH key for each repository at request time.

## How It Works

### Payload-Based SSH Keys (Current Approach)

When making a request to the `/run` endpoint, you can include an SSH key directly in the payload:

```bash
curl -X POST "https://your-service-url/run" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "prompt": "Run tests and deploy",
    "gitRepo": "git@github.com:myorg/myrepo.git",
    "gitBranch": "main",
    "sshKey": "-----BEGIN OPENSSH PRIVATE KEY-----\nMIIEpAIBAAKC...\n-----END OPENSSH PRIVATE KEY-----"
  }'
```

The service will:
1. Write the SSH key to the ephemeral workspace with secure permissions (0600)
2. Configure git to use this key for the clone operation
3. Clone the repository using SSH authentication
4. Clean up the key automatically after the request completes

### HTTPS to SSH Auto-Conversion

If you provide an HTTPS URL with an SSH key, the service automatically converts it:

```bash
curl -X POST "https://your-service-url/run" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "prompt": "Analyze this codebase",
    "gitRepo": "https://github.com:myorg/myrepo.git",
    "sshKey": "-----BEGIN OPENSSH PRIVATE KEY-----\n...\n-----END OPENSSH PRIVATE KEY-----"
  }'
```

The service converts `https://github.com/owner/repo.git` → `git@github.com:owner/repo.git` automatically.

### Global SSH Key (Fallback)

For backward compatibility, the service still supports a global SSH key mounted at `/home/appuser/.ssh/id_rsa` via Secret Manager. This is optional and used only when no `sshKey` is provided in the payload.

To set up a global SSH key:

```bash
# Create the secret
gcloud secrets create GIT_SSH_KEY --replication-policy="automatic"

# Add your SSH private key
cat ~/.ssh/id_rsa | gcloud secrets versions add GIT_SSH_KEY --data-file=-

# The deployment script automatically mounts this at /home/appuser/.ssh/id_rsa
```

## Security Features

1. **Ephemeral Storage**: SSH keys are written only to the ephemeral workspace (`/tmp/ws-{requestId}`)
2. **Secure Permissions**: Keys are written with 0600 permissions (readable only by the owner)
3. **Automatic Cleanup**: Keys are deleted when the workspace is cleaned up after request completion
4. **Isolated Per Request**: Each request has its own isolated SSH key, preventing cross-contamination
5. **No Persistence**: Keys are never stored on disk outside the ephemeral workspace
6. **Secure Transmission**: Keys are transmitted via HTTPS with Cloud Run IAM authentication

## Integration with Orchestration Systems

This payload-based approach is ideal for orchestration systems like Agent Forge:

```javascript
// Agent Forge can dynamically provide the correct SSH key
const sshKey = await getSSHKeyForRepo(repoUrl);
const envSecrets = await getEnvironmentForBranch(repoUrl, branch);

const response = await fetch(`${serviceUrl}/run`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    prompt: userPrompt,
    gitRepo: repoUrl,
    gitBranch: branch,
    sshKey: sshKey,
    environmentSecrets: envSecrets
  })
});
```

Benefits:
- **Dynamic**: Different keys for different repositories
- **Secure**: Keys never stored long-term in the service
- **Flexible**: Orchestrator controls key selection logic
- **Simple**: No separate API for key management

## Migration from API-Based Approach

If you were using the old API-based approach (`POST /api/secrets` with `type: "ssh"`), you should migrate to the payload-based approach:

**Old Approach (Deprecated):**
```bash
# Step 1: Store SSH key via API
curl -X POST "https://your-service-url/api/secrets" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "org": "myorg",
    "repo": "myrepo",
    "type": "ssh",
    "secretContent": "..."
  }'

# Step 2: Use it implicitly
curl -X POST "https://your-service-url/run" \
  -d '{"gitRepo": "git@github.com:myorg/myrepo.git", ...}'
```

**New Approach (Current):**
```bash
# Single request with SSH key included
curl -X POST "https://your-service-url/run" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "gitRepo": "git@github.com:myorg/myrepo.git",
    "sshKey": "-----BEGIN OPENSSH PRIVATE KEY-----\n...\n-----END OPENSSH PRIVATE KEY-----",
    ...
  }'
```

## Best Practices

1. **Never Log SSH Keys**: Ensure your orchestration system doesn't log SSH keys
2. **Use Deploy Keys**: Create read-only deploy keys per repository on GitHub/GitLab
3. **Rotate Keys**: Implement key rotation in your orchestration system
4. **Secure Transmission**: Always use HTTPS and proper authentication
5. **Key Format**: Use OpenSSH format (generated with `ssh-keygen -t ed25519` or `ssh-keygen -t rsa`)

## Generating SSH Keys

```bash
# Generate a new ED25519 key (recommended)
ssh-keygen -t ed25519 -C "claude-code@example.com" -f deploy_key -N ""

# Or generate RSA key (for compatibility)
ssh-keygen -t rsa -b 4096 -C "claude-code@example.com" -f deploy_key -N ""

# Add the public key (deploy_key.pub) to GitHub/GitLab as a deploy key
# Use the private key (deploy_key) in the sshKey payload field
```

## Example: Complete Workflow

```bash
# 1. Generate deploy key
ssh-keygen -t ed25519 -C "deploy" -f deploy_key -N ""

# 2. Add public key to GitHub
# Go to: Repository Settings → Deploy Keys → Add deploy key
# Paste contents of deploy_key.pub

# 3. Use private key in request
SSH_KEY=$(cat deploy_key)
curl -X POST "https://your-service-url/run" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{
    \"prompt\": \"Run integration tests\",
    \"gitRepo\": \"git@github.com:myorg/myrepo.git\",
    \"gitBranch\": \"main\",
    \"sshKey\": \"$SSH_KEY\",
    \"environmentSecrets\": {
      \"DATABASE_URL\": \"postgres://...\",
      \"API_KEY\": \"sk-...\"
    }
  }"
```

## Troubleshooting

### "Permission denied (publickey)" Error

This means the SSH key doesn't have access to the repository:
1. Verify the public key is added to GitHub/GitLab
2. Check that the private key matches the public key: `ssh-keygen -y -f deploy_key`
3. Ensure the key format is correct (OpenSSH format)

### "Repository not found" Error

1. Check that the repository URL is correct
2. Verify the SSH key has read access to the repository
3. For private repositories, ensure an SSH key is provided

### HTTPS URL with SSH Key

The service automatically converts HTTPS to SSH format when an SSH key is provided, so this should work seamlessly. If it doesn't:
1. Check that the URL is a valid GitHub URL
2. Manually convert to SSH format: `git@github.com:owner/repo.git`
