# Async Task Execution Guide

This guide covers async task execution with the Claude Code Cloud Run service. Async tasks run in the background and POST results to your webhook when complete.

## Table of Contents

1. [Overview](#overview)
2. [When to Use Async Tasks](#when-to-use-async-tasks)
3. [Architecture](#architecture)
4. [Setup](#setup)
5. [Creating Async Tasks](#creating-async-tasks)
6. [Webhook Integration](#webhook-integration)
7. [Log Retrieval](#log-retrieval)
8. [Error Handling](#error-handling)
9. [Best Practices](#best-practices)
10. [Monitoring](#monitoring)

## Overview

The async task system allows you to run long-running Claude Code tasks in the background without blocking your application. Instead of waiting for a streaming response, your application:

1. **Creates a task** - POST to `/run-async`, receive task ID immediately (202 Accepted)
2. **Task executes** - Claude Code runs in background, logs streamed to GCS
3. **Receives callback** - When complete, service POSTs results to your webhook URL

This enables:
- **Long-running tasks** up to Cloud Run's 60-minute limit
- **Non-blocking** application flows
- **Retry-able** tasks with persistent logs
- **Audit trail** with complete JSONL logs in GCS
- **Scalability** without blocking HTTP connections

## When to Use Async Tasks

### Use Async Tasks For:

✅ **Long-running analysis** (>30 seconds)
- Large codebase reviews
- Comprehensive documentation generation
- Multi-file refactoring tasks

✅ **Resource-intensive operations**
- Running extensive test suites
- Building and deploying applications
- Data processing pipelines

✅ **Batch operations**
- Processing multiple repositories
- Generating reports for multiple projects
- Automated code quality checks

✅ **Integration workflows**
- CI/CD pipeline integration
- Scheduled maintenance tasks
- Automated incident response

### Use Sync Tasks For:

✅ **Quick responses** (<30 seconds)
- Code suggestions
- Simple file operations
- Quick analysis tasks

✅ **Interactive workflows**
- Chat-based interactions
- Real-time code assistance
- Streaming output requirements

## Architecture

### Components - Cloud Run Jobs

The service uses **Cloud Run Jobs architecture** for task execution with Cloud KMS encryption:

```
┌─────────────┐
│   Client    │
│ Application │
└──────┬──────┘
       │
       │ POST /run-async
       │ (prompt, callback URL, postExecutionActions)
       │
       ▼
┌──────────────────────┐
│  API Service (Cloud  │
│    Run Service)      │
│                      │
│ ┌─EncryptionService │
│ └─ JobTriggerService │
└──────────┬───────────┘
           │
           │ 1. Encrypt payload with KMS
           │ 2. Store in GCS
           │ 3. Trigger Cloud Run Job
           ▼
┌──────────────────────┐
│  Job Worker (Cloud   │
│    Run Job)          │
│                      │
│ 1. Read encrypted    │
│    payload from GCS  │
│ 2. Decrypt with KMS  │
│ 3. Execute task      │
│ 4. Stream logs to GCS│
│ 5. Post-execution:   │
│    - Git commit/push │
│    - File uploads    │
│ 6. Call webhook      │
└──────────┬───────────┘
           │
           │ Streams logs
           ▼
    ┌─────────────┐
    │  GCS Bucket │
    │             │
    │  sessions/  │
    │  └─{taskId}/│
    │    ├─encrypted-payload.bin
    │    ├─*.jsonl (logs)
    │    ├─uploads/ (files)
    │    └─metadata.json
    └─────────────┘
           │
           │ On completion
           ▼
    ┌─────────────┐
    │   Webhook   │
    │  (callback  │
    │     URL)    │
    │  + HMAC auth│
    └─────────────┘
```

### Flow

1. **Task Creation** (`AsyncClaudeController`)
   - Validates request (prompt, callback URL, credentials)
   - Generates or validates task ID
   - **Encrypts payload with Cloud KMS**
   - **Stores encrypted payload in GCS**
   - **Triggers Cloud Run Job execution**
   - Returns 202 Accepted immediately

2. **Job Execution** (`job-worker.ts`)
   - **Reads encrypted payload from GCS**
   - **Decrypts with Cloud KMS**
   - Sets up workspace, clones git repo
   - Executes Claude Code CLI
   - Streams output to GCS

3. **Log Streaming** (`GCSLoggerService`)
   - Buffers JSONL output (100 lines per chunk)
   - Writes chunks to GCS as files
   - Saves task metadata (status, timestamps, errors)

4. **Post-Execution Actions** (if configured)
   - **Git operations:** Commit and/or push changes
   - **File uploads:** Upload files matching glob patterns to GCS
   - Results included in webhook callback

5. **Callback Notification**
   - On completion/failure, POSTs to callback URL
   - **Includes HMAC-SHA256 signature for authentication**
   - Includes task ID, status, logs path, summary, post-execution results
   - Payload encrypted in transit via HTTPS

## Setup

### Prerequisites

- Google Cloud Project with billing enabled
- Cloud Run service deployed (see [Deployment Guide](./deployment.md))
- GCS bucket for log storage

### 1. Create GCS Bucket

**Option A: Using setup-project.sh (Recommended)**

The easiest way is to let the setup script handle everything:

```bash
# 1. Add to .env
echo "GCS_LOGS_BUCKET=your-project-id-claude-logs" >> .env

# 2. Run setup script (safe on existing projects - it's idempotent)
./scripts/setup-project.sh

# This automatically:
# - Enables storage API
# - Creates GCS bucket
# - Sets 30-day lifecycle policy
# - Grants storage permissions
```

**Option B: Manual Creation**

If you prefer manual control:

```bash
# Set variables from your .env
PROJECT_ID="your-project-id"
REGION="us-central1"
BUCKET_NAME="${PROJECT_ID}-claude-logs"

# Create bucket
gcloud storage buckets create gs://${BUCKET_NAME} \
  --project=${PROJECT_ID} \
  --location=${REGION} \
  --uniform-bucket-level-access

# Set lifecycle policy to auto-delete old logs
cat > lifecycle.json << 'EOF'
{
  "lifecycle": {
    "rule": [{
      "action": {"type": "Delete"},
      "condition": {"age": 30}
    }]
  }
}
EOF

gcloud storage buckets update gs://${BUCKET_NAME} \
  --lifecycle-file=lifecycle.json

rm lifecycle.json
```

### 2. Configure Environment Variables

Add to your `.env` file:

```bash
# GCS bucket for async task logs
GCS_LOGS_BUCKET=your-project-id-claude-logs

# Webhook authentication secret (generate with: openssl rand -hex 32)
CLOUDRUN_CALLBACK_SECRET=your-generated-secret-here
```

### 3. Create Webhook Secret

```bash
# Create secret in Google Cloud Secret Manager
./scripts/create-secrets.sh
```

This script will:
- Enable Secret Manager API if needed
- Create `CLOUDRUN_CALLBACK_SECRET` from your `.env` file
- Make it available to Cloud Run during deployment

### 4. Grant Storage Permissions

**If you used Option A (setup-project.sh):** Permissions are already granted! Skip to step 5.

**If you used Option B (manual):** Grant permissions manually:

```bash
# Run the service account setup script (idempotent, safe to re-run)
./scripts/setup-service-account.sh
```

This grants `roles/storage.objectAdmin` on the GCS bucket to:
- Client service account for both Cloud Run invocation and GCS access

### 5. Redeploy Service

```bash
# Redeploy with updated environment variables and secrets
./scripts/deploy-service.sh
```

### 6. Test Setup

```bash
# Test async endpoint
./scripts/test.sh remote-async
```

## Creating Async Tasks

### Basic Example

```bash
AUTH_TOKEN=$(gcloud auth print-identity-token)
SERVICE_URL="https://your-service-url.run.app"

curl -X POST "${SERVICE_URL}/run-async" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${AUTH_TOKEN}" \
  -d '{
    "prompt": "Analyze this codebase and generate documentation",
    "anthropicApiKey": "sk-ant-your-key-here",
    "callbackUrl": "https://your-app.com/webhooks/claude-complete",
    "gitRepo": "https://github.com/your-org/your-repo",
    "maxTurns": 20
  }'
```

**Response (202 Accepted):**

```json
{
  "taskId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "pending",
  "logsPath": "gs://your-bucket/sessions/550e8400-e29b-41d4-a716-446655440000/",
  "createdAt": "2025-01-10T12:34:56.789Z"
}
```

### With Custom Task ID

```bash
curl -X POST "${SERVICE_URL}/run-async" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${AUTH_TOKEN}" \
  -d '{
    "prompt": "Run tests and deploy",
    "anthropicApiKey": "sk-ant-your-key-here",
    "callbackUrl": "https://your-app.com/webhooks/task-complete",
    "taskId": "deploy-prod-2025-01-10-001",
    "gitRepo": "git@github.com:your-org/backend.git",
    "sshKey": "-----BEGIN OPENSSH PRIVATE KEY-----\n...\n-----END OPENSSH PRIVATE KEY-----",
    "maxTurns": 15
  }'
```

**Important:** Custom task IDs must be:
- Unique (service doesn't check for conflicts)
- URL-safe (alphanumeric, underscore, hyphen only)
- Meaningful for your use case (e.g., `deploy-{env}-{date}-{seq}`)

### With Metadata

```bash
curl -X POST "${SERVICE_URL}/run-async" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${AUTH_TOKEN}" \
  -d '{
    "prompt": "Generate API documentation",
    "anthropicApiKey": "sk-ant-your-key-here",
    "callbackUrl": "https://your-app.com/webhooks/doc-complete",
    "maxTurns": 10,
    "metadata": {
      "requestId": "req-123-456",
      "userId": "user-789",
      "projectId": "proj-abc",
      "environment": "production",
      "createdBy": "automated-system"
    }
  }'
```

Metadata is:
- Stored with task logs
- Returned in callback payload
- Useful for correlation, tracking, debugging

### With Post-Execution Actions

Configure automated git operations and file uploads after task completion:

```bash
curl -X POST "${SERVICE_URL}/run-async" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${AUTH_TOKEN}" \
  -d '{
    "prompt": "Run Playwright tests and generate report",
    "anthropicApiKey": "sk-ant-your-key-here",
    "callbackUrl": "https://your-app.com/webhooks/test-complete",
    "gitRepo": "git@github.com:your-org/e2e-tests.git",
    "sshKey": "-----BEGIN OPENSSH PRIVATE KEY-----\n...\n-----END OPENSSH PRIVATE KEY-----",
    "maxTurns": 15,
    "postExecutionActions": {
      "git": {
        "commit": true,
        "commitMessage": "Update test snapshots",
        "push": true,
        "branch": "main"
      },
      "uploadFiles": {
        "glob Patterns": [".playwright/**/*.webm", "*.log", "coverage/**"],
        "gcsPrefix": "test-artifacts"
      }
    },
    "metadata": {
      "testRun": "nightly-2025-01-10",
      "environment": "staging"
    }
  }'
```

**Post-Execution Actions:**
- **Git operations:** Automatically commit and push changes made by Claude
- **File uploads:** Upload test artifacts, logs, or generated files to GCS
- **Behavior:** Only executes if task completes successfully (exit code 0)
- **Results:** Included in webhook callback payload

**Example callback with post-execution results:**

```json
{
  "taskId": "test-run-123",
  "status": "completed",
  "exitCode": 0,
  "logsPath": "gs://bucket/sessions/test-run-123/",
  "summary": {
    "durationMs": 180000,
    "turns": 12,
    "errors": 0,
    "startedAt": "2025-01-10T02:00:00.000Z",
    "completedAt": "2025-01-10T02:03:00.000Z"
  },
  "uploadedFiles": [
    {
      "originalPath": ".playwright/test-results/video-1.webm",
      "gcsPath": "gs://bucket/sessions/test-run-123/uploads/test-artifacts/.playwright/test-results/video-1.webm",
      "sizeBytes": 2457600
    },
    {
      "originalPath": "test-output.log",
      "gcsPath": "gs://bucket/sessions/test-run-123/uploads/test-artifacts/test-output.log",
      "sizeBytes": 15234
    }
  ],
  "gitCommit": {
    "sha": "a1b2c3d4e5f6",
    "message": "Update test snapshots",
    "pushed": true,
    "branch": "main"
  },
  "metadata": {
    "testRun": "nightly-2025-01-10",
    "environment": "staging"
  }
}
```

**Use Cases:**
- Automated test runs with artifact upload
- Code generation with automatic commits
- Build systems that push generated files
- CI/CD workflows with result preservation

See [Post-Execution Actions Guide](./post-execution-actions.md) for detailed documentation.

## Webhook Integration

### Callback Payload Format

Your webhook receives a POST with this payload when the task completes:

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
  "error": null,
  "metadata": {
    "requestId": "req-123-456",
    "userId": "user-789"
  }
}
```

**Status values:**
- `completed`: Task finished successfully (exitCode 0)
- `failed`: Task failed or errored (exitCode non-zero)

### Implementing a Webhook Handler

#### Node.js / Express

```javascript
const express = require('express');
const crypto = require('crypto');
const { Storage } = require('@google-cloud/storage');

const app = express();
app.use(express.json());

const storage = new Storage();

// Webhook signature verification function
function verifyWebhookSignature(req) {
  const signature = req.headers['x-webhook-signature'];
  const timestamp = req.headers['x-webhook-timestamp'];
  const secret = process.env.CLOUDRUN_CALLBACK_SECRET;

  if (!signature || !timestamp) {
    throw new Error('Missing signature or timestamp headers');
  }

  // Check timestamp is recent (prevent replay attacks)
  const now = Math.floor(Date.now() / 1000);
  const timeDiff = Math.abs(now - parseInt(timestamp));
  if (timeDiff > 300) { // 5 minutes tolerance
    throw new Error('Timestamp too old');
  }

  // Verify signature
  if (!signature.startsWith('sha256=')) {
    throw new Error('Invalid signature format');
  }

  const providedSignature = signature.slice(7);
  const payloadString = JSON.stringify(req.body);
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${payloadString}`)
    .digest('hex');

  // Constant-time comparison
  if (!crypto.timingSafeEqual(
    Buffer.from(providedSignature, 'hex'),
    Buffer.from(expectedSignature, 'hex')
  )) {
    throw new Error('Invalid signature');
  }

  return true;
}

app.post('/webhooks/claude-complete', async (req, res) => {
  try {
    // Verify webhook signature
    verifyWebhookSignature(req);

    const { taskId, status, exitCode, logsPath, summary, error, metadata } = req.body;

    console.log(`Task ${taskId} completed with status: ${status}`);

    if (status === 'completed') {
      // Task succeeded
      console.log(`Duration: ${summary.durationMs}ms, Turns: ${summary.turns}`);

      // Optionally fetch and process logs
      const logs = await fetchLogs(logsPath);
      await processCompletedTask(taskId, logs, metadata);

    } else if (status === 'failed') {
      // Task failed
      console.error(`Task failed with exit code ${exitCode}: ${error}`);
      await handleFailedTask(taskId, error, metadata);
    }

    // Always respond quickly to avoid timeout
    res.status(200).json({ received: true });

  } catch (error) {
    console.error('Webhook error:', error.message);
    res.status(401).json({ error: 'Unauthorized' });
  }
});

async function fetchLogs(logsPath) {
  // Parse GCS path: gs://bucket/sessions/taskId/
  const match = logsPath.match(/gs:\/\/([^\/]+)\/(.+)/);
  if (!match) return [];

  const [, bucketName, prefix] = match;
  const bucket = storage.bucket(bucketName);

  // List all JSONL chunks
  const [files] = await bucket.getFiles({ prefix });
  const jsonlFiles = files.filter(f => f.name.endsWith('.jsonl')).sort();

  // Read and parse all chunks
  const logs = [];
  for (const file of jsonlFiles) {
    const [content] = await file.download();
    const lines = content.toString().split('\n').filter(l => l.trim());
    logs.push(...lines.map(l => JSON.parse(l)));
  }

  return logs;
}

async function processCompletedTask(taskId, logs, metadata) {
  // Your business logic here
  console.log(`Processing task ${taskId} with ${logs.length} log entries`);

  // Example: Store results in database
  // await db.tasks.update(taskId, { status: 'completed', logs });

  // Example: Notify user
  // await notifyUser(metadata.userId, `Task ${taskId} completed`);
}

async function handleFailedTask(taskId, error, metadata) {
  // Your error handling logic
  console.error(`Handling failed task ${taskId}: ${error}`);

  // Example: Alert on failure
  // await sendAlert(`Task ${taskId} failed: ${error}`);
}

app.listen(3000, () => console.log('Webhook server running on port 3000'));
```

#### Python / Flask

```python
from flask import Flask, request, jsonify
from google.cloud import storage
import json
import hmac
import hashlib
import time
import os

app = Flask(__name__)
storage_client = storage.Client()

def verify_webhook_signature(request):
    """Verify HMAC signature from webhook request"""
    signature = request.headers.get('X-Webhook-Signature')
    timestamp = request.headers.get('X-Webhook-Timestamp')
    secret = os.environ['CLOUDRUN_CALLBACK_SECRET']

    if not signature or not timestamp:
        raise ValueError('Missing signature or timestamp headers')

    # Check timestamp is recent (prevent replay attacks)
    now = int(time.time())
    time_diff = abs(now - int(timestamp))
    if time_diff > 300:  # 5 minutes tolerance
        raise ValueError('Timestamp too old')

    # Verify signature format
    if not signature.startswith('sha256='):
        raise ValueError('Invalid signature format')

    provided_signature = signature[7:]  # Remove 'sha256=' prefix

    # Recompute signature
    payload_string = json.dumps(request.json, separators=(',', ':'))
    message = f"{timestamp}.{payload_string}"
    expected_signature = hmac.new(
        secret.encode('utf-8'),
        message.encode('utf-8'),
        hashlib.sha256
    ).hexdigest()

    # Constant-time comparison
    if not hmac.compare_digest(provided_signature, expected_signature):
        raise ValueError('Invalid signature')

    return True

@app.route('/webhooks/claude-complete', methods=['POST'])
def claude_complete():
    try:
        # Verify webhook signature
        verify_webhook_signature(request)

        data = request.json
        task_id = data['taskId']
        status = data['status']
        exit_code = data['exitCode']
        logs_path = data['logsPath']
        summary = data['summary']
        error = data.get('error')
        metadata = data.get('metadata', {})

        print(f"Task {task_id} completed with status: {status}")

        if status == 'completed':
            # Task succeeded
            print(f"Duration: {summary['durationMs']}ms, Turns: {summary.get('turns')}")

            # Optionally fetch and process logs
            logs = fetch_logs(logs_path)
            process_completed_task(task_id, logs, metadata)

        elif status == 'failed':
            # Task failed
            print(f"Task failed with exit code {exit_code}: {error}")
            handle_failed_task(task_id, error, metadata)

        # Always respond quickly
        return jsonify({'received': True}), 200

    except Exception as e:
        print(f"Webhook error: {e}")
        return jsonify({'error': 'Unauthorized'}), 401

def fetch_logs(logs_path):
    """Fetch JSONL logs from GCS"""
    # Parse GCS path: gs://bucket/sessions/taskId/
    parts = logs_path.replace('gs://', '').split('/', 1)
    bucket_name, prefix = parts[0], parts[1]

    bucket = storage_client.bucket(bucket_name)
    blobs = list(bucket.list_blobs(prefix=prefix))
    jsonl_files = sorted([b for b in blobs if b.name.endswith('.jsonl')])

    logs = []
    for blob in jsonl_files:
        content = blob.download_as_text()
        for line in content.strip().split('\n'):
            if line:
                logs.append(json.loads(line))

    return logs

def process_completed_task(task_id, logs, metadata):
    """Process completed task"""
    print(f"Processing task {task_id} with {len(logs)} log entries")
    # Your business logic here

def handle_failed_task(task_id, error, metadata):
    """Handle failed task"""
    print(f"Handling failed task {task_id}: {error}")
    # Your error handling logic

if __name__ == '__main__':
    app.run(port=3000)
```

### Webhook Security

The service automatically signs all webhook callbacks with HMAC-SHA256 authentication to ensure authenticity and prevent tampering.

**Webhook Headers:**
- `X-Webhook-Signature`: HMAC-SHA256 signature (format: `sha256={hex}`)
- `X-Webhook-Timestamp`: Unix timestamp when signature was generated
- `Content-Type`: application/json
- `User-Agent`: cloudrun-claude-code/async-task

**How HMAC Authentication Works:**

1. Service generates signature: `HMAC-SHA256(CLOUDRUN_CALLBACK_SECRET, timestamp + "." + payload)`
2. Signature sent in `X-Webhook-Signature` header as `sha256={hex}`
3. Timestamp sent in `X-Webhook-Timestamp` header
4. Your webhook verifies by recomputing the signature and comparing

**Signature Verification (Node.js):**

```javascript
const crypto = require('crypto');
const express = require('express');

const app = express();
app.use(express.json());

function verifyWebhookSignature(req) {
  const signature = req.headers['x-webhook-signature'];
  const timestamp = req.headers['x-webhook-timestamp'];
  const secret = process.env.CLOUDRUN_CALLBACK_SECRET;

  if (!signature || !timestamp) {
    throw new Error('Missing signature or timestamp headers');
  }

  // Check timestamp is recent (prevent replay attacks)
  const now = Math.floor(Date.now() / 1000);
  const timeDiff = Math.abs(now - parseInt(timestamp));
  if (timeDiff > 300) { // 5 minutes tolerance
    throw new Error('Timestamp too old or too far in future');
  }

  // Verify signature format
  if (!signature.startsWith('sha256=')) {
    throw new Error('Invalid signature format');
  }

  const providedSignature = signature.slice(7); // Remove 'sha256=' prefix

  // Recompute signature
  const payloadString = JSON.stringify(req.body);
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${payloadString}`)
    .digest('hex');

  // Constant-time comparison to prevent timing attacks
  if (!crypto.timingSafeEqual(
    Buffer.from(providedSignature, 'hex'),
    Buffer.from(expectedSignature, 'hex')
  )) {
    throw new Error('Invalid signature');
  }

  return true;
}

app.post('/webhooks/claude-complete', async (req, res) => {
  try {
    // Verify signature before processing
    verifyWebhookSignature(req);

    const { taskId, status, exitCode, logsPath, summary, error, metadata } = req.body;

    console.log(`Verified webhook for task ${taskId} with status: ${status}`);

    if (status === 'completed') {
      // Process successful task
      await processCompletedTask(taskId, logsPath, metadata);
    } else if (status === 'failed') {
      // Handle failed task
      await handleFailedTask(taskId, error, metadata);
    }

    // Always respond quickly
    res.status(200).json({ received: true });

  } catch (error) {
    console.error('Webhook verification failed:', error.message);
    res.status(401).json({ error: 'Unauthorized' });
  }
});
```

**Signature Verification (Python):**

```python
import hmac
import hashlib
import time
import json
from flask import Flask, request, jsonify

app = Flask(__name__)

def verify_webhook_signature(request):
    """Verify HMAC signature from webhook request"""
    signature = request.headers.get('X-Webhook-Signature')
    timestamp = request.headers.get('X-Webhook-Timestamp')
    secret = os.environ['CLOUDRUN_CALLBACK_SECRET']

    if not signature or not timestamp:
        raise ValueError('Missing signature or timestamp headers')

    # Check timestamp is recent (prevent replay attacks)
    now = int(time.time())
    time_diff = abs(now - int(timestamp))
    if time_diff > 300:  # 5 minutes tolerance
        raise ValueError('Timestamp too old or too far in future')

    # Verify signature format
    if not signature.startswith('sha256='):
        raise ValueError('Invalid signature format')

    provided_signature = signature[7:]  # Remove 'sha256=' prefix

    # Recompute signature
    payload_string = json.dumps(request.json, separators=(',', ':'))
    message = f"{timestamp}.{payload_string}"
    expected_signature = hmac.new(
        secret.encode('utf-8'),
        message.encode('utf-8'),
        hashlib.sha256
    ).hexdigest()

    # Constant-time comparison
    if not hmac.compare_digest(provided_signature, expected_signature):
        raise ValueError('Invalid signature')

    return True

@app.route('/webhooks/claude-complete', methods=['POST'])
def claude_complete():
    try:
        # Verify signature before processing
        verify_webhook_signature(request)

        data = request.json
        task_id = data['taskId']
        status = data['status']

        print(f"Verified webhook for task {task_id} with status: {status}")

        if status == 'completed':
            # Process successful task
            process_completed_task(task_id, data['logsPath'], data.get('metadata'))
        elif status == 'failed':
            # Handle failed task
            handle_failed_task(task_id, data.get('error'), data.get('metadata'))

        # Always respond quickly
        return jsonify({'received': True}), 200

    except Exception as e:
        print(f"Webhook verification failed: {e}")
        return jsonify({'error': 'Unauthorized'}), 401
```

**Best Practices:**

1. **Always verify HMAC signature** - Never process webhooks without verification
2. **Check timestamp** - Reject requests older than 5 minutes (prevents replay attacks)
3. **Use constant-time comparison** - Prevents timing attacks when comparing signatures
4. **Use HTTPS** - Always use HTTPS for webhook URLs
5. **Validate payload structure** - Check required fields exist
6. **Respond quickly** - Return 200 OK immediately (<1 second), process async
7. **Handle retries** - Make webhook idempotent (service doesn't retry currently)
8. **Log everything** - Log all webhook calls for debugging
9. **Secure your secret** - Store `CLOUDRUN_CALLBACK_SECRET` securely, never commit to code
10. **Monitor failures** - Alert on signature verification failures

## Log Retrieval

### Listing Logs

```bash
# List all log chunks for a task
gcloud storage ls gs://your-bucket/sessions/TASK_ID/

# Output:
# gs://your-bucket/sessions/TASK_ID/001-20250110-123456.jsonl
# gs://your-bucket/sessions/TASK_ID/002-20250110-123457.jsonl
# gs://your-bucket/sessions/TASK_ID/metadata.json
```

### Reading Logs

```bash
# Read all logs (concatenate all chunks)
gcloud storage cat gs://your-bucket/sessions/TASK_ID/*.jsonl

# Read specific chunk
gcloud storage cat gs://your-bucket/sessions/TASK_ID/001-20250110-123456.jsonl

# Read metadata
gcloud storage cat gs://your-bucket/sessions/TASK_ID/metadata.json
```

### Parsing Logs

Each line in the JSONL file is a JSON object:

```json
{"type":"session_init","timestamp":"2025-01-10T12:34:56.789Z"}
{"type":"assistant","text":"I'll help you with that task..."}
{"type":"tool_use","tool":"Read","args":{"file":"README.md"}}
{"type":"tool_result","tool":"Read","output":"# Project Title..."}
{"type":"turn_complete","turnNumber":1}
{"type":"error","error":"File not found","timestamp":"2025-01-10T12:35:00.123Z"}
```

### Programmatic Access

```javascript
const { Storage } = require('@google-cloud/storage');
const storage = new Storage();

async function getTaskLogs(taskId, bucketName) {
  const bucket = storage.bucket(bucketName);
  const prefix = `sessions/${taskId}/`;

  // Get all JSONL files
  const [files] = await bucket.getFiles({ prefix });
  const jsonlFiles = files
    .filter(f => f.name.endsWith('.jsonl'))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Read and parse all logs
  const logs = [];
  for (const file of jsonlFiles) {
    const [content] = await file.download();
    const lines = content.toString().split('\n');

    for (const line of lines) {
      if (line.trim()) {
        try {
          logs.push(JSON.parse(line));
        } catch (e) {
          console.error(`Failed to parse log line: ${line}`);
        }
      }
    }
  }

  return logs;
}

// Usage
const logs = await getTaskLogs('550e8400-e29b-41d4-a716-446655440000', 'your-bucket');
console.log(`Retrieved ${logs.length} log entries`);
```

## Error Handling

### Common Errors

#### 1. Missing GCS_LOGS_BUCKET

```json
{
  "error": "Async task support not configured (missing GCS_LOGS_BUCKET)"
}
```

**Solution:** Configure `GCS_LOGS_BUCKET` environment variable and redeploy.

#### 2. Permission Denied

```
Error: Permission denied writing to gs://bucket/sessions/...
```

**Solution:** Run `./scripts/setup-service-account.sh` (idempotent, safe to re-run)

#### 3. Invalid Callback URL

```json
{
  "error": "callbackUrl is not a valid URL"
}
```

**Solution:** Provide valid HTTP/HTTPS URL.

#### 4. Task Execution Failure

Webhook receives:

```json
{
  "status": "failed",
  "exitCode": 1,
  "error": "Claude process exited with code 1"
}
```

**Actions:**
- Check logs in GCS for detailed error
- Verify prompt and configuration
- Check tool permissions
- Ensure sufficient timeout

### Timeout Handling

Tasks have configurable timeout (default 55 min, max 60 min):

```json
{
  "prompt": "Long task...",
  "callbackUrl": "...",
  "timeoutMinutes": 45
}
```

If task exceeds timeout:
- Process is killed
- Webhook receives `status: "failed"`
- Logs available in GCS up to timeout point

## Best Practices

### Task Design

1. **Set appropriate timeouts**
   - Estimate task duration
   - Add buffer for variability
   - Don't exceed Cloud Run's 60-minute limit

2. **Use custom task IDs**
   - Include timestamp, environment, sequence
   - Makes debugging easier
   - Enables task correlation

3. **Include metadata**
   - Request ID for tracing
   - User ID for attribution
   - Environment (prod/staging)
   - Any context needed for callback processing

4. **Choose appropriate max turns**
   - More turns = more capability but longer runtime
   - Start conservative, increase as needed
   - Monitor turn usage in summary

### Webhook Design

1. **Respond immediately**
   - Return 200 OK quickly (<1 second)
   - Process async in background
   - Prevents timeout and retry issues

2. **Make idempotent**
   - Service doesn't currently retry
   - But good practice for future-proofing
   - Use task ID to track processed tasks

3. **Handle all status values**
   - `completed` - success path
   - `failed` - error path
   - Future states possible

4. **Log everything**
   - All webhook calls
   - All processing results
   - All errors

### Cost Optimization

1. **Lifecycle policies**
   - Delete logs after 30-90 days
   - Archive to Nearline/Coldline for compliance
   - Balance retention needs with cost

2. **Monitor storage usage**
   - Each task generates 1-10MB typically
   - 1000 tasks/day = ~5GB/day = ~150GB/month
   - At $0.023/GB/month = ~$3.45/month

3. **Batch operations**
   - Group related work in single task
   - Reduces overhead
   - Better logging

## Monitoring

### Key Metrics

1. **Task creation rate**
   - Track POST /run-async requests
   - Alert on unusual spikes

2. **Task duration**
   - Monitor `durationMs` in callbacks
   - Track p50, p95, p99 percentiles
   - Alert on timeouts

3. **Success rate**
   - Track `completed` vs `failed` status
   - Alert on increased failure rate
   - Investigate failed tasks

4. **Storage usage**
   - Monitor GCS bucket size
   - Track growth rate
   - Verify lifecycle policies working

### Logging

Enable structured logging in your webhook handler:

```javascript
app.post('/webhooks/claude-complete', async (req, res) => {
  const { taskId, status, summary } = req.body;

  console.log(JSON.stringify({
    event: 'task_completed',
    taskId,
    status,
    durationMs: summary.durationMs,
    turns: summary.turns,
    timestamp: new Date().toISOString()
  }));

  // Process...
  res.status(200).json({ received: true });
});
```

### Dashboards

Create dashboards to track:
- Task volume over time
- Task duration distribution
- Success/failure rates
- Storage usage trends
- Webhook latency

### Alerts

Set up alerts for:
- Webhook failures (non-200 responses)
- High task failure rate (>10%)
- Long task duration (>45 minutes)
- Storage quota approaching limit
- Unusual task volume spikes

## Next Steps

- See [API Reference](./api-reference.md) for full endpoint documentation
- See [Deployment Guide](./deployment.md) for setup instructions
- See [Testing Guide](./testing.md) for testing async tasks
- Check examples in `examples/` directory
