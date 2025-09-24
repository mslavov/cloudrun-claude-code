# Per-Repository SSH Deployment Keys

This feature allows each repository to use its own SSH deployment key for secure git operations, reducing security blast radius by isolating keys per repository.

## Quick Start

### 1. Store SSH Key in Secret Manager

Using gcloud CLI:
```bash
# Create the secret
gcloud secrets create ssh_myorg_myrepo --replication-policy="automatic"

# Add the SSH private key
cat ~/.ssh/id_rsa | gcloud secrets versions add ssh_myorg_myrepo --data-file=-
```

Using the API:
```bash
curl -X POST "https://your-service-url/api/secrets" \
  -H "Content-Type: application/json" \
  -d '{
    "org": "myorg",
    "repo": "myrepo",
    "type": "ssh",
    "secretContent": "-----BEGIN OPENSSH PRIVATE KEY-----\n...\n-----END OPENSSH PRIVATE KEY-----"
  }'
```

### 2. Grant Service Account Access

```bash
PROJECT_ID=your-project-id
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${PROJECT_ID}-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

### 3. Use with /run Endpoint

When calling the `/run` endpoint with a repository, the service automatically checks for a per-repository SSH key:

```bash
curl -X POST "https://your-service-url/run" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Analyze this repository",
    "gitRepo": "git@github.com:myorg/myrepo.git"
  }'
```

The service will:
1. Look for `ssh_myorg_myrepo` secret in Secret Manager
2. If found, use it for cloning the repository
3. If not found, fall back to global SSH configuration

## API Reference

### Secret Types

All secret management endpoints now support a `type` parameter:
- `'env'` - Environment variables (default, backward compatible)
- `'ssh'` - SSH deployment keys

### Create SSH Key

```http
POST /api/secrets
{
  "org": "myorg",
  "repo": "myrepo",
  "type": "ssh",
  "secretContent": "-----BEGIN OPENSSH PRIVATE KEY-----..."
}
```

### List SSH Keys

```http
GET /api/secrets?type=ssh&org=myorg
```

### Get SSH Key

```http
GET /api/secrets/get?gitRepo=git@github.com:myorg/myrepo.git&type=ssh
```

### Update SSH Key

```http
PUT /api/secrets
{
  "org": "myorg",
  "repo": "myrepo",
  "type": "ssh",
  "secretContent": "-----BEGIN OPENSSH PRIVATE KEY-----..."
}
```

### Delete SSH Key

```http
DELETE /api/secrets?org=myorg&repo=myrepo&type=ssh
```

## Security Notes

- SSH keys are stored with `ssh_<org>_<repo>` naming convention (all lowercase)
- Keys are written to workspace with 0o600 permissions (readable only by owner)
- SSH directory created with 0o700 permissions
- Keys are automatically cleaned up with workspace after request completion
- StrictHostKeyChecking is disabled only for ephemeral operations
- Each request gets an isolated SSH configuration

## Backward Compatibility

The existing environment secret functionality remains unchanged:
- Environment secrets continue using `env_<org>_<repo>` naming
- The `type` parameter defaults to `'env'` when omitted
- `envContent` field is still supported for backward compatibility
- Branch-specific environment secrets continue to work as before

## Key Rotation

To rotate an SSH key:

```bash
# Add new version
gcloud secrets versions add ssh_myorg_myrepo --data-file=new_key.pem

# Optionally disable old versions
gcloud secrets versions disable ssh_myorg_myrepo 1
```

The service automatically uses the latest version of each secret.