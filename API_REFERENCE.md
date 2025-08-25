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

Execute a Claude Code prompt with streaming response.

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
| `mcpConfigJson` | object | No | - | MCP server configuration |
| `maxTurns` | number | No | 6 | Maximum conversation turns |
| `model` | string | No | - | Specific Claude model to use |
| `fallbackModel` | string | No | - | Fallback model if primary fails |
| `useNamedPipe` | boolean | No | true | Use named pipe for prompt delivery |
| `timeoutMinutes` | number | No | 10 | Process timeout in minutes |

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

### With MCP Server Configuration

```bash
curl -X POST https://YOUR-SERVICE-URL.run.app/run \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $(gcloud auth print-identity-token)" \
  -d '{
    "prompt": "Query the database for users",
    "mcpConfigJson": {
      "mcpServers": {
        "sqlite": {
          "command": "uvx",
          "args": ["mcp-server-sqlite", "--db-path", "/tmp/database.db"]
        }
      }
    }
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
- **MCP Tools**: Any tools exposed by configured MCP servers

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

## Rate Limiting

The service inherits rate limiting from:
1. Cloud Run concurrency settings
2. Anthropic API rate limits
3. Any configured Cloud Run quotas

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
6. **Configure MCP Servers**: Use `mcpConfigJson` for database or API access
7. **Monitor Health Endpoint**: Regularly check `/health` for service status

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

To work with persistent data, consider:
- Using MCP servers for database access
- Mounting Cloud Storage buckets
- Using environment variables for configuration