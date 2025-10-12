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

### POST /run

Execute a Claude Code prompt with streaming response, optionally cloning a git repository with environment variables and SSH authentication.

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
| `gitRepo` | string | No | - | Git repository URL to clone (SSH or HTTPS) |
| `gitBranch` | string | No | main | Git branch to checkout |
| `gitDepth` | number | No | 1 | Clone depth for shallow cloning |
| `environmentSecrets` | object | No | {} | Environment variables to inject as key-value pairs |
| `sshKey` | string | No | - | SSH private key for git authentication (PEM format) |
| `metadata` | object | No | - | Optional metadata for logging/tracking |

#### SSH Key and Environment Variables

The service supports passing SSH keys and environment variables directly in the request payload. This is the recommended approach when integrating with orchestration systems like Agent Forge.

**SSH Key Format:**
```json
{
  "sshKey": "-----BEGIN OPENSSH PRIVATE KEY-----\nMIIEpAIBAAKC...\n-----END OPENSSH PRIVATE KEY-----"
}
```

**Environment Secrets Format:**
```json
{
  "environmentSecrets": {
    "DATABASE_URL": "postgres://...",
    "API_KEY": "sk-...",
    "REDIS_URL": "redis://..."
  }
}
```

When both `sshKey` and `gitRepo` are provided:
- The SSH key is written to the workspace with proper permissions (0600)
- HTTPS URLs are automatically converted to SSH format if an SSH key is provided
- Git operations use the provided SSH key for authentication
- The key is cleaned up automatically after request completion

Environment secrets are:
- Injected as environment variables for the Claude process
- Written to `.env` file in the workspace root
- Available to any scripts or commands Claude executes

#### Response

Server-Sent Events (SSE) stream with the following event types:

- `message`: Claude's text output
- `error`: Error messages
- `done`: Completion signal

### POST /run-async

Execute a Claude Code prompt asynchronously with background execution. Returns immediately with task ID while execution continues in background. Results are POSTed to callback URL when complete.

**IMPORTANT**: Requires `GCS_LOGS_BUCKET` environment variable to be configured in Cloud Run. Service account must have `roles/storage.objectAdmin` on the GCS bucket.

#### Request

**Headers:**
- `Content-Type: application/json`
- `Authorization: Bearer IDENTITY_TOKEN` (required)

**Body Parameters:**

All parameters from `/run` endpoint plus:

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `callbackUrl` | string | Yes | - | Webhook URL to POST results when task completes |
| `taskId` | string | No | Auto-generated UUID | Custom task ID (must be URL-safe: alphanumeric, underscore, hyphen only) |
| `metadata` | object | No | - | Custom metadata object returned in callback payload |

All other parameters (prompt, anthropicApiKey, etc.) work the same as `/run` endpoint.

#### Response (202 Accepted)

```json
{
  "taskId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "pending",
  "logsPath": "gs://your-bucket/sessions/550e8400-e29b-41d4-a716-446655440000/",
  "createdAt": "2025-01-10T12:34:56.789Z"
}
```

#### Callback Webhook Payload

When task completes, the service POSTs the following payload to your `callbackUrl` with HMAC authentication headers.

**Request Headers:**
```
POST {callbackUrl}
Content-Type: application/json
X-Webhook-Signature: sha256={hmac-sha256-signature}
X-Webhook-Timestamp: {unix-timestamp}
User-Agent: cloudrun-claude-code/async-task
```

**HMAC Authentication:**
The service signs webhook callbacks with HMAC-SHA256 to ensure authenticity:
- Signature format: `HMAC-SHA256(CLOUDRUN_CALLBACK_SECRET, timestamp + "." + JSON.stringify(payload))`
- Your webhook handler should verify this signature before processing
- See `docs/async-tasks.md` for signature verification examples in Node.js and Python

**Request Body:**
```json
{
  "taskId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "completed",
  "exitCode": 0,
  "logsPath": "gs://your-bucket/sessions/550e8400-e29b-41d4-a716-446655440000/",
  "summary": {
    "durationMs": 45000,
    "turns": 15,
    "errors": 0,
    "startedAt": "2025-01-10T12:34:56.789Z",
    "completedAt": "2025-01-10T12:35:41.789Z"
  },
  "error": "Error message if task failed",
  "metadata": {
    "your": "custom",
    "metadata": "here"
  }
}
```

**Status values:**
- `completed`: Task finished successfully (exitCode 0)
- `failed`: Task failed (exitCode non-zero)
- `cancelled`: Task was cancelled via `/cancel/:taskId` endpoint (exitCode 130)

**Security:**
Always verify the HMAC signature before processing webhook payloads to ensure they originate from your Cloud Run service. Reject requests with:
- Missing `X-Webhook-Signature` or `X-Webhook-Timestamp` headers
- Invalid signatures
- Timestamps older than 5 minutes (prevents replay attacks)

#### Logs Retrieval

Task logs are streamed to Google Cloud Storage in JSONL format:

```bash
# List all log chunks for a task
gcloud storage ls gs://your-bucket/sessions/TASK_ID/

# Read all logs
gcloud storage cat gs://your-bucket/sessions/TASK_ID/*.jsonl

# Read metadata
gcloud storage cat gs://your-bucket/sessions/TASK_ID/metadata.json
```

Log chunks are named with format: `001-20250110-123456.jsonl` (sequential number + timestamp)


### POST /cancel/:taskId

Cancel a running async task. This endpoint stops the Claude process and updates the task status to 'cancelled'. A webhook notification is sent to the callback URL with cancellation details.

**Only works for async tasks created via `/run-async`. Sync tasks cannot be cancelled** via this endpoint (they can be cancelled by closing the HTTP connection).

#### Request

**Headers:**
- `Authorization: Bearer IDENTITY_TOKEN` (required)

**URL Parameters:**
- `taskId`: The task ID to cancel (from `/run-async` response)

#### Response

**Success (200 OK):**
```json
{
  "message": "Task cancelled successfully",
  "taskId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "cancelled"
}
```

**Task Not Found (404):**
```json
{
  "error": "Task not found",
  "message": "Task 550e8400-e29b-41d4-a716-446655440000 is not currently running or has already completed",
  "taskId": "550e8400-e29b-41d4-a716-446655440000"
}
```

**Invalid Task ID (400):**
```json
{
  "error": "Invalid taskId format. Must be alphanumeric with underscores and hyphens only."
}
```

#### Callback Webhook on Cancellation

When a task is cancelled, the service POSTs a webhook to the original `callbackUrl` with status `'cancelled'`:

```json
{
  "taskId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "cancelled",
  "exitCode": 130,
  "logsPath": "gs://your-bucket/sessions/550e8400-e29b-41d4-a716-446655440000/",
  "summary": {
    "durationMs": 12000,
    "turns": 3,
    "errors": 0,
    "startedAt": "2025-01-10T12:34:56.789Z",
    "completedAt": "2025-01-10T12:35:08.789Z",
    "cancelledAt": "2025-01-10T12:35:08.789Z"
  },
  "error": "Task cancelled by user",
  "metadata": {
    "your": "custom",
    "metadata": "here"
  }
}
```

Exit code 130 indicates termination by SIGTERM (standard cancellation signal).

#### Example

```bash
# Start an async task
curl -X POST https://YOUR-SERVICE-URL.run.app/run-async \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $(gcloud auth print-identity-token)" \
  -d '{
    "prompt": "This will take a long time...",
    "anthropicApiKey": "sk-ant-your-key-here",
    "callbackUrl": "https://your-app.com/webhooks/claude-complete",
    "maxTurns": 50
  }'

# Response: { "taskId": "abc-123", ... }

# Cancel the task
curl -X POST https://YOUR-SERVICE-URL.run.app/cancel/abc-123 \
  -H "Authorization: Bearer $(gcloud auth print-identity-token)"

# Your webhook will receive the cancellation notification
```

### GET /tasks/status

Get statistics about active tasks running on the service. Useful for monitoring and debugging.

#### Request

**Headers:**
- `Authorization: Bearer IDENTITY_TOKEN` (required)

#### Response (200 OK)

```json
{
  "active": 1,
  "max": 1,
  "tasks": [
    {
      "taskId": "550e8400-e29b-41d4-a716-446655440000",
      "type": "async",
      "startedAt": "2025-01-10T12:34:56.789Z",
      "cancelling": false
    }
  ]
}
```

**Response Fields:**
- `active`: Number of currently running tasks
- `max`: Maximum concurrent tasks allowed (configured via `MAX_CONCURRENT_TASKS` env var, default: 1)
- `tasks`: Array of active task details
  - `taskId`: The task identifier
  - `type`: Either `'sync'` or `'async'`
  - `startedAt`: ISO timestamp when task started
  - `cancelling`: Boolean indicating if task is being cancelled

#### Example

```bash
curl -X GET https://YOUR-SERVICE-URL.run.app/tasks/status \
  -H "Authorization: Bearer $(gcloud auth print-identity-token)"
```

#### Use Cases

- **Monitoring**: Check if service is busy before submitting a task
- **Debugging**: Identify long-running or stuck tasks
- **Load Balancing**: Determine which service instance has capacity
- **Health Checks**: Verify task execution is functioning

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
    "prompt": "Create a simple Python hello world script",
    "anthropicApiKey": "sk-ant-your-key-here"
  }'
```

### Async Task Execution

```bash
# Create async task
curl -X POST https://YOUR-SERVICE-URL.run.app/run-async \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $(gcloud auth print-identity-token)" \
  -d '{
    "prompt": "Analyze this large codebase and generate comprehensive documentation",
    "anthropicApiKey": "sk-ant-your-key-here",
    "callbackUrl": "https://your-app.com/webhooks/claude-complete",
    "gitRepo": "https://github.com/your-org/large-repo",
    "gitBranch": "main",
    "maxTurns": 25,
    "allowedTools": ["Read", "Write", "Grep", "Bash"],
    "metadata": {
      "requestId": "doc-gen-123",
      "userId": "user-456",
      "environment": "production"
    }
  }'

# Returns immediately:
# {
#   "taskId": "550e8400-e29b-41d4-a716-446655440000",
#   "status": "pending",
#   "logsPath": "gs://your-bucket/sessions/550e8400-e29b-41d4-a716-446655440000/",
#   "createdAt": "2025-01-10T12:34:56.789Z"
# }

# Later, when task completes, your webhook receives:
# POST https://your-app.com/webhooks/claude-complete
# {
#   "taskId": "550e8400-e29b-41d4-a716-446655440000",
#   "status": "completed",
#   "exitCode": 0,
#   "logsPath": "gs://your-bucket/sessions/550e8400-e29b-41d4-a716-446655440000/",
#   "summary": { ... },
#   "metadata": { ... }
# }
```

### Async Task with Custom ID

```bash
curl -X POST https://YOUR-SERVICE-URL.run.app/run-async \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $(gcloud auth print-identity-token)" \
  -d '{
    "prompt": "Run comprehensive test suite and generate report",
    "anthropicApiKey": "sk-ant-your-key-here",
    "callbackUrl": "https://your-app.com/webhooks/test-complete",
    "taskId": "test-run-prod-2025-01-10",
    "gitRepo": "git@github.com:your-org/backend.git",
    "sshKey": "-----BEGIN OPENSSH PRIVATE KEY-----\n...\n-----END OPENSSH PRIVATE KEY-----",
    "environmentSecrets": {
      "DATABASE_URL": "postgres://prod.example.com/db",
      "API_KEY": "sk-prod-..."
    },
    "maxTurns": 20
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

### With Git Repository Clone (Public Repository)

```bash
curl -X POST https://YOUR-SERVICE-URL.run.app/run \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $(gcloud auth print-identity-token)" \
  -d '{
    "prompt": "Analyze the code structure and suggest improvements",
    "gitRepo": "https://github.com/user/public-repo.git",
    "gitBranch": "main",
    "gitDepth": 1
  }'
```

### With Private Repository and SSH Key

```bash
curl -X POST https://YOUR-SERVICE-URL.run.app/run \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $(gcloud auth print-identity-token)" \
  -d '{
    "prompt": "Run tests and fix any failing ones",
    "gitRepo": "git@github.com:myorg/private-repo.git",
    "gitBranch": "feature-branch",
    "gitDepth": 1,
    "sshKey": "-----BEGIN OPENSSH PRIVATE KEY-----\nMIIEpAIBAAKCAQEA...\n-----END OPENSSH PRIVATE KEY-----"
  }'
```

### With Environment Variables

```bash
curl -X POST https://YOUR-SERVICE-URL.run.app/run \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $(gcloud auth print-identity-token)" \
  -d '{
    "prompt": "Test database connectivity and run migrations",
    "gitRepo": "git@github.com:myorg/backend.git",
    "gitBranch": "staging",
    "sshKey": "-----BEGIN OPENSSH PRIVATE KEY-----\n...\n-----END OPENSSH PRIVATE KEY-----",
    "environmentSecrets": {
      "DATABASE_URL": "postgres://staging.example.com/db",
      "API_KEY": "sk-staging-...",
      "REDIS_URL": "redis://staging.example.com:6379"
    }
  }'
```

### Complete Example with All Options

```bash
curl -X POST https://YOUR-SERVICE-URL.run.app/run \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $(gcloud auth print-identity-token)" \
  -d '{
    "prompt": "Run integration tests and deploy to staging",
    "gitRepo": "https://github.com/myorg/app.git",
    "gitBranch": "develop",
    "gitDepth": 1,
    "sshKey": "-----BEGIN OPENSSH PRIVATE KEY-----\n...\n-----END OPENSSH PRIVATE KEY-----",
    "environmentSecrets": {
      "DATABASE_URL": "postgres://...",
      "API_KEY": "sk-...",
      "DEPLOY_TOKEN": "..."
    },
    "allowedTools": ["Read", "Grep", "Bash", "Write"],
    "permissionMode": "bypassPermissions",
    "maxTurns": 15,
    "timeoutMinutes": 45,
    "metadata": {
      "requestId": "deploy-123",
      "user": "agent-forge",
      "environment": "staging"
    }
  }'
```

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
    const lines = chunk.split('\\n');

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

// Usage with git repository and SSH key
const sshKey = fs.readFileSync('.ssh/deploy_key', 'utf8');
const envSecrets = {
  DATABASE_URL: 'postgres://...',
  API_KEY: 'sk-...'
};

runClaudeCode('Run tests and fix any failures', {
  gitRepo: 'git@github.com:myorg/repo.git',
  gitBranch: 'main',
  sshKey: sshKey,
  environmentSecrets: envSecrets,
  allowedTools: ['Read', 'Write', 'Edit', 'Bash'],
  permissionMode: 'bypassPermissions'
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

# Usage with git repository and SSH key
with open('.ssh/deploy_key', 'r') as f:
    ssh_key = f.read()

env_secrets = {
    'DATABASE_URL': 'postgres://...',
    'API_KEY': 'sk-...'
}

run_claude_code(
    'Run tests and fix any failures',
    gitRepo='git@github.com:myorg/repo.git',
    gitBranch='main',
    sshKey=ssh_key,
    environmentSecrets=env_secrets,
    allowedTools=['Read', 'Write', 'Edit', 'Bash'],
    permissionMode='bypassPermissions'
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

1. **Pass Secrets in Payload**: For orchestration systems, pass SSH keys and environment variables directly in the request payload
2. **Use Named Pipes for Large Prompts**: Set `useNamedPipe: true` (default) for prompts over 1KB
3. **Set Appropriate Timeouts**: Increase `timeoutMinutes` for complex tasks
4. **Restrict Tools for Security**: Use `allowedTools` to limit permissions
5. **Handle Streaming Properly**: Implement proper SSE parsing in clients
6. **Use Plan Mode for Review**: Set `permissionMode: "plan"` to preview changes
7. **Monitor Health Endpoint**: Regularly check `/health` for service status
8. **SSH Key Security**: Ensure SSH keys are transmitted securely and never logged

## Security Considerations

1. **Never expose API keys in client-side code**
2. **Use Cloud Run IAM for service-to-service auth**
3. **Restrict tools based on use case**
4. **Validate and sanitize prompts**
5. **Set appropriate timeouts to prevent resource exhaustion**
6. **Use private Cloud Run endpoints when possible**
7. **Enable Cloud Run authentication for production**
8. **SSH keys are ephemeral and cleaned up after each request**
9. **Environment secrets are isolated per request**
10. **All credentials are stored in memory only, never on disk (except ephemeral workspace)**

## Workspace Management

Each request creates an ephemeral workspace at `/tmp/ws-{requestId}` that is:
- Isolated from other requests
- Automatically cleaned up after completion
- Limited to the request's lifecycle
- Not persisted between requests
- Can be initialized with a git repository using `gitRepo` parameter
- Can include runtime environment variables via `environmentSecrets` parameter
- Can use SSH authentication via `sshKey` parameter

To work with persistent data, consider:
- Mounting Cloud Storage buckets
- Using environment variables for configuration
- Committing changes back to git repositories

## Git Repository Support

The service supports cloning git repositories into the workspace with flexible authentication:

### SSH Key Configuration

**Payload-Based (Recommended for Orchestration):**
Pass SSH keys directly in the request payload. The service will:
1. Write the key to the workspace with secure permissions (0600)
2. Configure git to use the key for the clone operation
3. Automatically convert HTTPS URLs to SSH format if an SSH key is provided
4. Clean up the key after request completion

**Global SSH Key (Optional):**
For backward compatibility, you can mount a global SSH key at `/home/appuser/.ssh/id_rsa` via Secret Manager. This key will be used as a fallback if no `sshKey` is provided in the payload.

### HTTPS to SSH Conversion

When an SSH key is provided but the `gitRepo` uses HTTPS format, the service automatically converts:
```
https://github.com/owner/repo.git → git@github.com:owner/repo.git
```

This allows seamless authentication without manual URL conversion.

### Environment Variables

Environment variables can be passed directly in the request payload:

**Payload-Based (Recommended):**
```json
{
  "environmentSecrets": {
    "DATABASE_URL": "postgres://...",
    "API_KEY": "sk-..."
  }
}
```

The service:
- Injects these as environment variables for the Claude process
- Writes them to a `.env` file in the workspace root
- Makes them available to any scripts or commands Claude executes
- Cleans them up automatically after request completion

### Example: Full Git + SSH + Environment Setup

```bash
curl -X POST https://YOUR-SERVICE-URL.run.app/run \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "prompt": "Run integration tests",
    "gitRepo": "https://github.com/myorg/backend.git",
    "gitBranch": "staging",
    "gitDepth": 1,
    "sshKey": "-----BEGIN OPENSSH PRIVATE KEY-----\n...\n-----END OPENSSH PRIVATE KEY-----",
    "environmentSecrets": {
      "DATABASE_URL": "postgres://staging.db.example.com/mydb",
      "API_KEY": "sk-staging-key",
      "REDIS_URL": "redis://staging.cache.example.com:6379"
    }
  }'
```

The service will:
1. Accept the HTTPS URL and automatically convert it to SSH format
2. Write the SSH key securely to the workspace
3. Clone the repository using SSH authentication
4. Write environment variables to `.env` file
5. Inject environment variables into Claude's process
6. Execute the prompt with full repository and environment access
7. Clean up all sensitive data after completion
