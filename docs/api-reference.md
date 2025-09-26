# API Reference

## Base URL

```
https://YOUR-SERVICE-URL.run.app
```

## Authentication

The Cloud Run service requires authentication via Google Cloud IAM. All requests must include a valid identity token.

### Using Service Account JSON File

When you're provided with a `service_account.json` file, you need to exchange it for an identity token to authenticate with the Cloud Run service.

#### Node.js/JavaScript
```javascript
const { GoogleAuth } = require('google-auth-library');
const fs = require('fs');

// Load service account credentials
const serviceAccount = JSON.parse(fs.readFileSync('service_account.json'));

async function getIdentityToken() {
  const auth = new GoogleAuth({
    credentials: serviceAccount,
    scopes: ['https://www.googleapis.com/auth/cloud-platform']
  });
  
  const client = await auth.getIdTokenClient('https://YOUR-SERVICE-URL.run.app');
  const tokenResponse = await client.getAccessToken();
  return tokenResponse.token;
}

// Use the token in your request
const token = await getIdentityToken();
const response = await fetch('https://YOUR-SERVICE-URL.run.app/run', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ prompt: 'Your prompt here' })
});
```

#### Python
```python
from google.oauth2 import service_account
from google.auth.transport.requests import Request
import json

# Load service account credentials
with open('service_account.json', 'r') as f:
    service_account_info = json.load(f)

def get_identity_token():
    credentials = service_account.IDTokenCredentials.from_service_account_info(
        service_account_info,
        target_audience='https://YOUR-SERVICE-URL.run.app'
    )
    
    request = Request()
    credentials.refresh(request)
    return credentials.token

# Use the token in your request
import requests

token = get_identity_token()
response = requests.post(
    'https://YOUR-SERVICE-URL.run.app/run',
    headers={
        'Authorization': f'Bearer {token}',
        'Content-Type': 'application/json'
    },
    json={'prompt': 'Your prompt here'},
    stream=True
)
```

#### Using gcloud CLI with Service Account
```bash
# Activate the service account
gcloud auth activate-service-account --key-file=service_account.json

# Get identity token
TOKEN=$(gcloud auth print-identity-token)

# Make authenticated request
curl -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -X POST https://YOUR-SERVICE-URL.run.app/run \
  -d '{"prompt": "Your prompt here"}'
```

### Using gcloud CLI (for development)
```bash
# For developers with gcloud configured
curl -H "Authorization: Bearer $(gcloud auth print-identity-token)" \
  https://YOUR-SERVICE-URL.run.app/run
```

## Endpoints

### Secret Management Endpoints

The service provides a RESTful API for managing environment secrets that are automatically loaded when cloning git repositories.

#### GET /api/secrets

List all secrets, optionally filtered by organization, repository, and type.

**Query Parameters:**
- `org` (string, optional): Filter by organization name
- `repo` (string, optional): Filter by repository name
- `type` (string, optional): Secret type - 'env' or 'ssh' (defaults to all types)

**Response:**
```json
{
  "secrets": [
    "env_myorg_myrepo",
    "env_myorg_myrepo_staging",
    "env_myorg_myrepo_customers__acme__main",
    "ssh_myorg_myrepo"
  ]
}
```

**Example:**
```bash
# List all secrets
curl -H "Authorization: Bearer $TOKEN" \
  "https://YOUR-SERVICE-URL/api/secrets"

# List only environment secrets for an org
curl -H "Authorization: Bearer $TOKEN" \
  "https://YOUR-SERVICE-URL/api/secrets?type=env&org=myorg"
```

#### GET /api/secrets/:id

Get a specific secret by its ID.

**Path Parameters:**
- `id` (string, required): Secret ID in format `{type}_{org}_{repo}[_{branch}]`
  - Examples: `env_myorg_myrepo`, `ssh_myorg_backend`, `env_myorg_api_staging`

**Response:**

For environment secrets (type=env):
```json
{
  "id": "env_myorg_myrepo_staging",
  "type": "env",
  "org": "myorg",
  "repo": "myrepo",
  "branch": "staging",
  "env": {
    "DATABASE_URL": "postgres://...",
    "API_KEY": "..."
  }
}
```

For SSH keys (type=ssh):
```json
{
  "id": "ssh_myorg_myrepo",
  "type": "ssh",
  "org": "myorg",
  "repo": "myrepo",
  "secretContent": "-----BEGIN OPENSSH PRIVATE KEY-----\n...\n-----END OPENSSH PRIVATE KEY-----"
}
```

**Example:**
```bash
# Get environment variables for main branch
curl -H "Authorization: Bearer $TOKEN" \
  "https://YOUR-SERVICE-URL/api/secrets/env_myorg_myrepo"

# Get SSH key
curl -H "Authorization: Bearer $TOKEN" \
  "https://YOUR-SERVICE-URL/api/secrets/ssh_myorg_myrepo"

# Get branch-specific environment
curl -H "Authorization: Bearer $TOKEN" \
  "https://YOUR-SERVICE-URL/api/secrets/env_myorg_myrepo_customers__acme"
```

#### POST /api/secrets

Create a new secret.

**Request Body:**
```json
{
  "org": "myorg",
  "repo": "myrepo",
  "type": "env",
  "branch": "customers/acme/main",
  "secretContent": "DATABASE_URL=postgres://...\nAPI_KEY=sk-..."
}
```

**Parameters:**
- `org` (string, required): Organization name
- `repo` (string, required): Repository name
- `type` (string, optional): Secret type - 'env' or 'ssh' (defaults to 'env')
- `branch` (string, optional): Branch name for environment secrets
- `secretContent` (string, required): The secret content (environment variables or SSH key)

**Response:**
```json
{
  "success": true,
  "secretName": "env_myorg_myrepo_customers__acme__main"
}
```

**Status Codes:**
- `201 Created`: Secret successfully created
- `400 Bad Request`: Invalid parameters

**Examples:**

```bash
# Create environment secret
curl -X POST "https://YOUR-SERVICE-URL/api/secrets" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "org": "myorg",
    "repo": "backend",
    "type": "env",
    "secretContent": "DATABASE_URL=postgres://...\nAPI_KEY=sk-..."
  }'

# Create SSH deployment key
curl -X POST "https://YOUR-SERVICE-URL/api/secrets" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "org": "myorg",
    "repo": "backend",
    "type": "ssh",
    "secretContent": "-----BEGIN OPENSSH PRIVATE KEY-----\n...\n-----END OPENSSH PRIVATE KEY-----"
  }'
```

#### PUT /api/secrets/:id

Update an existing secret.

**Path Parameters:**
- `id` (string, required): Secret ID in format `{type}_{org}_{repo}[_{branch}]`

**Request Body:**
```json
{
  "secretContent": "DATABASE_URL=postgres://...\nAPI_KEY=sk-..."
}
```

**Response:**
```json
{
  "success": true,
  "version": "2"
}
```

**Example:**
```bash
# Update environment variables
curl -X PUT "https://YOUR-SERVICE-URL/api/secrets/env_myorg_myrepo_staging" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "secretContent": "DATABASE_URL=postgres://new...\nAPI_KEY=sk-new..."
  }'

# Update SSH key
curl -X PUT "https://YOUR-SERVICE-URL/api/secrets/ssh_myorg_myrepo" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "secretContent": "-----BEGIN OPENSSH PRIVATE KEY-----\n...new key...\n-----END OPENSSH PRIVATE KEY-----"
  }'
```

#### DELETE /api/secrets/:id

Delete a secret.

**Path Parameters:**
- `id` (string, required): Secret ID in format `{type}_{org}_{repo}[_{branch}]`

**Response:**
- `204 No Content`: Secret successfully deleted
- `404 Not Found`: Secret does not exist

**Example:**
```bash
# Delete environment secret
curl -X DELETE "https://YOUR-SERVICE-URL/api/secrets/env_myorg_myrepo_staging" \
  -H "Authorization: Bearer $TOKEN"

# Delete SSH key
curl -X DELETE "https://YOUR-SERVICE-URL/api/secrets/ssh_myorg_myrepo" \
  -H "Authorization: Bearer $TOKEN"
```

### POST /run

Execute a Claude Code prompt with streaming response, optionally cloning a git repository and loading runtime environment variables.

#### Request

**Headers:**
- `Content-Type: application/json`
- `Authorization: Bearer IDENTITY_TOKEN` (required)

**Body Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `prompt` | string | Yes | - | The prompt for Claude to execute |
| `systemPrompt` | string | No | Built-in | Custom system prompt to replace the default |
| `appendSystemPrompt` | string | No | - | Text to append to the system prompt |
| `allowedTools` | string[] | No | Environment | List of allowed tools Claude can use |
| `disallowedTools` | string[] | No | - | List of tools to explicitly block |
| `permissionMode` | string | No | Environment | Permission mode: `acceptEdits`, `bypassPermissions`, or `plan` |
| `maxTurns` | number | No | 6 | Maximum conversation turns |
| `model` | string | No | - | Specific Claude model to use |
| `fallbackModel` | string | No | - | Fallback model if primary fails |
| `useNamedPipe` | boolean | No | true | Use named pipe for prompt delivery |
| `timeoutMinutes` | number | No | 55 | Process timeout in minutes (max 60 per Cloud Run) |
| `gitRepo` | string | No | - | SSH git repository URL to clone (e.g., `git@github.com:user/repo.git`) |
| `gitBranch` | string | No | main | Git branch to checkout |
| `gitDepth` | number | No | 1 | Clone depth for shallow cloning |

#### Response

Server-Sent Events (SSE) stream with the following event types:

- `message`: Claude's text output
- `error`: Error messages
- `done`: Completion signal

### GET /health

Health check endpoint.

#### Response

```json
{
  "status": "ok"
}
```

### GET /

Welcome message endpoint.

#### Response

```json
{
  "message": "Claude Code Cloud Run Service",
  "endpoints": {
    "run": "POST /run",
    "health": "GET /health"
  }
}
```

## Examples

### Basic Prompt Execution

```bash
curl -X POST https://YOUR-SERVICE-URL.run.app/run \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $(gcloud auth print-identity-token)" \
  -d '{
    "prompt": "Create a simple Python hello world script"
  }'
```

### With Custom System Prompt

```bash
curl -X POST https://YOUR-SERVICE-URL.run.app/run \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $(gcloud auth print-identity-token)" \
  -d '{
    "prompt": "Analyze this codebase for security issues",
    "systemPrompt": "You are a security expert. Focus only on identifying potential vulnerabilities."
  }'
```

### With Tool Restrictions

```bash
curl -X POST https://YOUR-SERVICE-URL.run.app/run \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $(gcloud auth print-identity-token)" \
  -d '{
    "prompt": "Help me understand this code",
    "allowedTools": ["Read", "Grep", "LS"],
    "disallowedTools": ["Write", "Edit", "Bash"]
  }'
```

### Plan Mode Example

```bash
curl -X POST https://YOUR-SERVICE-URL.run.app/run \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $(gcloud auth print-identity-token)" \
  -d '{
    "prompt": "Create a REST API with authentication",
    "permissionMode": "plan",
    "maxTurns": 10
  }'
```

### With Extended Timeout

```bash
curl -X POST https://YOUR-SERVICE-URL.run.app/run \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $(gcloud auth print-identity-token)" \
  -d '{
    "prompt": "Perform comprehensive code refactoring",
    "timeoutMinutes": 30,
    "maxTurns": 20
  }'
```

### Appending to System Prompt

```bash
curl -X POST https://YOUR-SERVICE-URL.run.app/run \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $(gcloud auth print-identity-token)" \
  -d '{
    "prompt": "Review this pull request",
    "appendSystemPrompt": "Focus on performance implications and potential bottlenecks. Always suggest specific improvements with code examples."
  }'
```

### Using Specific Model

```bash
curl -X POST https://YOUR-SERVICE-URL.run.app/run \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $(gcloud auth print-identity-token)" \
  -d '{
    "prompt": "Generate comprehensive test suite",
    "model": "claude-3-5-sonnet-latest",
    "fallbackModel": "claude-3-5-haiku-latest"
  }'
```

### With Git Repository Clone

```bash
curl -X POST https://YOUR-SERVICE-URL.run.app/run \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $(gcloud auth print-identity-token)" \
  -d '{
    "prompt": "Run tests and fix any failing ones",
    "gitRepo": "git@github.com:myorg/myproject.git",
    "gitBranch": "feature-branch",
    "gitDepth": 1
  }'
```

**Note**: Requires SSH key to be configured as a secret (`GIT_SSH_KEY`) and mounted to the container at `/home/appuser/.ssh/id_rsa`.

### With Automatic Environment Variables

```bash
curl -X POST https://YOUR-SERVICE-URL.run.app/run \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $(gcloud auth print-identity-token)" \
  -d '{
    "prompt": "Test database connectivity and run migrations",
    "gitRepo": "git@github.com:myorg/myproject.git",
    "gitBranch": "staging"
  }'
```

**Note**: Environment variables are automatically loaded based on the repository URL using hierarchical resolution:
- `env_{org}_{repo}` - Default environment for the repository
- `env_{org}_{repo}_{branch}` - Branch-specific environment (branch slashes replaced with `__`)

The service uses hierarchical resolution, trying from most specific to least specific secret, allowing inheritance of common variables.

## Client Examples

### JavaScript/TypeScript (Full Example with Service Account)

```javascript
const { GoogleAuth } = require('google-auth-library');
const fs = require('fs');

// Load service account
const serviceAccount = JSON.parse(fs.readFileSync('service_account.json'));

async function getIdentityToken(targetUrl) {
  const auth = new GoogleAuth({
    credentials: serviceAccount,
    scopes: ['https://www.googleapis.com/auth/cloud-platform']
  });
  
  const client = await auth.getIdTokenClient(targetUrl);
  const tokenResponse = await client.getAccessToken();
  return tokenResponse.token;
}

async function runClaudeCode(prompt, options = {}) {
  const serviceUrl = 'https://YOUR-SERVICE-URL.run.app';
  const identityToken = await getIdentityToken(serviceUrl);
  
  const response = await fetch(`${serviceUrl}/run`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${identityToken}`
    },
    body: JSON.stringify({
      prompt,
      ...options
    })
  });

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    
    const chunk = decoder.decode(value);
    const lines = chunk.split('\n');
    
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6);
        if (data === '[DONE]') {
          console.log('Stream completed');
        } else {
          console.log(data);
        }
      }
    }
  }
}

// Usage
runClaudeCode('Create a React component for a todo list', {
  allowedTools: ['Write', 'Edit'],
  permissionMode: 'acceptEdits'
});
```

### Python (Full Example with Service Account)

```python
from google.oauth2 import service_account
from google.auth.transport.requests import Request
import requests
import json

# Load service account
with open('service_account.json', 'r') as f:
    service_account_info = json.load(f)

def get_identity_token(target_url):
    """Get identity token from service account"""
    credentials = service_account.IDTokenCredentials.from_service_account_info(
        service_account_info,
        target_audience=target_url
    )
    
    request = Request()
    credentials.refresh(request)
    return credentials.token

def run_claude_code(prompt, **options):
    service_url = 'https://YOUR-SERVICE-URL.run.app'
    token = get_identity_token(service_url)
    
    payload = {
        'prompt': prompt,
        **options
    }
    
    headers = {
        'Content-Type': 'application/json',
        'Authorization': f'Bearer {token}'
    }
    
    response = requests.post(
        f'{service_url}/run',
        json=payload,
        headers=headers,
        stream=True
    )
    
    for line in response.iter_lines():
        if line:
            line = line.decode('utf-8')
            if line.startswith('data: '):
                data = line[6:]
                if data == '[DONE]':
                    print('Stream completed')
                else:
                    print(data)

# Usage
run_claude_code(
    'Optimize this Python function for performance',
    allowedTools=['Read', 'Edit'],
    maxTurns=10
)

# Required packages:
# pip install google-auth google-auth-httplib2 requests
```

### Using with curl and jq

```bash
# Stream and parse JSON responses
curl -X POST https://YOUR-SERVICE-URL.run.app/run \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $(gcloud auth print-identity-token)" \
  -d '{
    "prompt": "List all Python files in the project"
  }' \
  --no-buffer 2>/dev/null | \
  while IFS= read -r line; do
    if [[ $line == data:* ]]; then
      echo "${line:6}"
    fi
  done
```

## Tool Permissions

### Available Tools

The following tools can be configured via `allowedTools` and `disallowedTools`:

- **File Operations**: `Read`, `Write`, `Edit`, `MultiEdit`
- **Search**: `Grep`, `Glob`, `LS`
- **Execution**: `Bash`, `BashOutput`, `KillBash`
- **Web**: `WebSearch`, `WebFetch`
- **Task Management**: `TodoWrite`, `Task`
- **Planning**: `ExitPlanMode`
- **Notebook**: `NotebookEdit`

### Permission Modes

- **`acceptEdits`**: Default mode, Claude asks for permission before making changes
- **`bypassPermissions`**: Claude can make changes without asking
- **`plan`**: Claude plans the task but doesn't execute

## Error Handling

### Error Response Format

```json
{
  "error": "Error message",
  "details": "Additional error details"
}
```

### Common Error Codes

| Status Code | Description |
|-------------|-------------|
| 400 | Bad Request - Invalid parameters |
| 401 | Unauthorized - Missing or invalid authentication |
| 408 | Request Timeout - Process exceeded timeout |
| 500 | Internal Server Error |

### Handling Streaming Errors

Errors during streaming will be sent as SSE events:

```
event: error
data: {"error": "Process timeout", "code": "TIMEOUT"}
```

## Rate Limiting & Concurrency

The service inherits rate limiting from:
1. Cloud Run concurrency settings (optimized at 3 concurrent requests per instance)
2. Anthropic API rate limits
3. Any configured Cloud Run quotas

### Concurrency Configuration
- **Recommended**: CONCURRENCY=3 for Claude workloads
- Each request gets ~1.3GB RAM and 0.66 CPU cores
- Total capacity: 30 concurrent requests (10 instances × 3 each)
- Lower concurrency ensures better performance for AI code generation tasks

## Required Dependencies

### Node.js/JavaScript
```bash
npm install google-auth-library
# or
yarn add google-auth-library
```

### Python
```bash
pip install google-auth google-auth-httplib2 requests
```

## Best Practices

1. **Use Named Pipes for Large Prompts**: Set `useNamedPipe: true` (default) for prompts over 1KB
2. **Set Appropriate Timeouts**: Increase `timeoutMinutes` for complex tasks
3. **Restrict Tools for Security**: Use `allowedTools` to limit permissions
4. **Handle Streaming Properly**: Implement proper SSE parsing in clients
5. **Use Plan Mode for Review**: Set `permissionMode: "plan"` to preview changes
6. **Monitor Health Endpoint**: Regularly check `/health` for service status

## Security Considerations

1. **Never expose API keys in client-side code**
2. **Use Cloud Run IAM for service-to-service auth**
3. **Restrict tools based on use case**
4. **Validate and sanitize prompts**
5. **Set appropriate timeouts to prevent resource exhaustion**
6. **Use private Cloud Run endpoints when possible**
7. **Enable Cloud Run authentication for production**

## Workspace Management

Each request creates an ephemeral workspace at `/tmp/ws-{requestId}` that is:
- Isolated from other requests
- Automatically cleaned up after completion
- Limited to the request's lifecycle
- Not persisted between requests
- Can be initialized with a git repository using `gitRepo` parameter
- Can include runtime environment variables via automatic secret loading

To work with persistent data, consider:
- Mounting Cloud Storage buckets
- Using environment variables for configuration

## Git Repository Support

The service supports cloning git repositories into the workspace:

### SSH Key Configuration

1. **Create SSH Key Secret**:
   ```bash
   # Generate SSH key pair if needed
   ssh-keygen -t ed25519 -C "claude-code@example.com" -f claude_key
   
   # Create secret in Google Cloud
   gcloud secrets create GIT_SSH_KEY \
     --data-file=claude_key \
     --project=YOUR-PROJECT-ID
   ```

2. **Add Public Key to Git Provider**:
   - GitHub: Settings → SSH and GPG keys → New SSH key
   - GitLab: Settings → SSH Keys
   - Bitbucket: Personal settings → SSH keys

3. **Deploy with SSH Key Mounted**:
   The deployment script automatically mounts the SSH key at `/home/appuser/.ssh/id_rsa`

### Dynamic Environment Secrets

Environment variables are now fetched dynamically based on the repository URL. The service uses underscores as separators and supports hierarchical resolution:

**Naming Convention:**
- `env_{org}_{repo}` - Default environment for a repository
- `env_{org}_{repo}_{branch}` - Branch-specific environment (branch slashes replaced with `__`)

**Examples:**
- Repository default: `env_mycompany_backend`
- Main branch: `env_mycompany_backend` (uses repository default)
- Feature branch: `env_mycompany_backend_feature__auth`
- Customer branch: `env_mycompany_backend_customers__acme__main`

**Hierarchical Resolution:**
For complex branch structures like `customers/acme/feature/auth`, the service tries:
1. `env_mycompany_backend_customers__acme__feature__auth` (most specific)
2. `env_mycompany_backend_customers__acme__feature`
3. `env_mycompany_backend_customers__acme`
4. `env_mycompany_backend_customers`
5. `env_mycompany_backend` (repository default)

This allows you to define common environment variables at higher levels and override specific ones at branch levels.

#### Managing Environment Secrets via API

```bash
# Create repository-level secret
curl -X POST https://YOUR-SERVICE-URL/api/secrets \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "org": "mycompany",
    "repo": "backend",
    "type": "env",
    "secretContent": "DATABASE_URL=postgres://prod...\nAPI_KEY=sk-prod..."
  }'

# Create customer-specific secret
curl -X POST https://YOUR-SERVICE-URL/api/secrets \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "org": "mycompany",
    "repo": "backend",
    "type": "env",
    "branch": "customers/acme",
    "secretContent": "DATABASE_URL=postgres://acme...\nCUSTOMER_ID=acme"
  }'

# The service will automatically inherit from parent levels
```

#### Direct Management with gcloud

```bash
# Create environment secret with new naming convention
cat .env | gcloud secrets create env_mycompany_backend \
  --data-file=- \
  --project=YOUR-PROJECT-ID \
  --labels="type=env,org=mycompany,repo=backend"

# Create branch-specific secret
cat .env.staging | gcloud secrets create env_mycompany_backend_staging \
  --data-file=- \
  --project=YOUR-PROJECT-ID

# Create customer-specific secret
cat .env.customer | gcloud secrets create env_mycompany_backend_customers__acme \
  --data-file=- \
  --project=YOUR-PROJECT-ID

# Update secret version
cat .env | gcloud secrets versions add env_mycompany_backend \
  --data-file=- \
  --project=YOUR-PROJECT-ID
```

The service automatically:
- Parses the repository URL to determine org/repo
- Fetches the appropriate secret from Secret Manager
- Falls back from branch-specific to repository default
- Writes to workspace as `.env`
- Injects as environment variables for Claude

#### Required IAM Permissions

The Cloud Run service account needs:
```bash
gcloud projects add-iam-policy-binding YOUR-PROJECT-ID \
  --member="serviceAccount:YOUR-SERVICE-ACCOUNT@YOUR-PROJECT-ID.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```