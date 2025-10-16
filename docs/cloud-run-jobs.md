# Cloud Run Jobs Architecture

This guide explains how the service uses Cloud Run Jobs for task execution.

## Table of Contents

1. [Overview](#overview)
2. [Why Cloud Run Jobs](#why-cloud-run-jobs)
3. [Architecture](#architecture)
4. [Request Flow](#request-flow)
5. [Benefits](#benefits)
6. [Monitoring](#monitoring)
7. [Troubleshooting](#troubleshooting)

## Overview

The Claude Code service uses **Cloud Run Jobs architecture** where API requests trigger isolated job executions instead of running tasks in-process. Both `/run` and `/run-async` endpoints use this architecture.

**Key Components:**
- **API Service:** Receives requests, encrypts payloads, triggers jobs
- **Cloud Run Job:** Executes tasks in isolated containers
- **Cloud KMS:** Encrypts task payloads for secure transfer
- **GCS:** Stores encrypted payloads and task logs

## Why Cloud Run Jobs

### Traditional In-Process Execution (Old)

```
Client → API Service → Execute Task In-Process
                    ↓
                 Stream Output
```

**Problems:**
- Blocks HTTP connection for entire task duration
- Requires CPU-always-allocated for background tasks
- Limited resource isolation between tasks
- Difficult to scale execution independently

### Cloud Run Jobs Architecture (New)

```
Client → API Service → Encrypt Payload → Trigger Job
                                          ↓
                                    Job Worker
                                       → Decrypt
                                       → Execute
                                       → Stream to GCS
```

**Benefits:**
- ✅ No blocked HTTP connections
- ✅ No CPU-always-allocated needed
- ✅ Complete resource isolation per task
- ✅ Independent scaling of API and execution
- ✅ Better security with KMS encryption
- ✅ Automatic timeout and failure handling

## Architecture

### Components

**1. API Service (Cloud Run Service)**
- Handles `/run` and `/run-async` requests
- Encrypts task payloads with Cloud KMS
- Stores encrypted payloads in GCS
- Triggers Cloud Run Job executions
- For `/run`: Polls GCS logs and streams via SSE
- For `/run-async`: Returns 202 immediately

**2. Job Worker (Cloud Run Job)**
- Reads encrypted payload from GCS
- Decrypts with Cloud KMS
- Creates ephemeral workspace
- Clones git repositories if specified
- Executes Claude Code CLI
- Streams output to GCS
- Executes post-execution actions (git, file uploads)
- Calls webhook (for async tasks)
- Cleans up workspace and exits

**3. Cloud KMS**
- Encrypts task payloads before storage
- Decrypts payloads in job worker
- Ensures credentials never stored unencrypted

**4. GCS Bucket**
- Stores encrypted payloads temporarily
- Stores task logs (JSONL format)
- Stores uploaded files (post-execution actions)
- Lifecycle policies auto-delete old data

### Diagram

```
┌──────────────────────────────────────────────────────────────┐
│                       Client Application                     │
└──────────────────────┬───────────────────────────────────────┘
                       │
                       │ POST /run or /run-async
                       │ (prompt, config, credentials)
                       ▼
┌────────────────────────────────────────────────────────────────┐
│              API Service (Cloud Run Service)                   │
│                                                                │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 1. Validate request                                     │   │
│  │ 2. Generate task ID                                     │   │
│  │ 3. Encrypt payload with KMS                             │   │
│  │ 4. Store encrypted payload in GCS                       │   │
│  │ 5. Trigger Cloud Run Job                                │   │
│  │ 6. Return 202 (async) or poll logs (sync)               │   │
│  └─────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────┘
                       │
                       │ Triggers
                       ▼
┌────────────────────────────────────────────────────────────────┐
│              Job Worker (Cloud Run Job)                        │
│                                                                │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 1. Read encrypted payload from GCS                      │   │
│  │ 2. Decrypt payload with KMS                             │   │
│  │ 3. Create ephemeral workspace (/tmp/ws-{taskId})        │   │
│  │ 4. Clone git repository (if specified)                  │   │
│  │ 5. Execute Claude Code CLI                              │   │
│  │ 6. Stream output to GCS (JSONL)                         │   │
│  │ 7. Post-execution actions:                              │   │
│  │    - Git commit/push                                    │   │
│  │    - File uploads to GCS                                │   │
│  │ 8. Call webhook (async only)                            │   │
│  │ 9. Cleanup workspace                                    │   │
│  │ 10. Exit                                                │   │
│  └─────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────┘
                       │
                       │ Logs/Results
                       ▼
               ┌────────────────┐
               │   GCS Bucket   │
               │                │
               │  sessions/     │
               │  └─{taskId}/   │
               │    ├─encrypted │
               │    ├─*.jsonl   │
               │    ├─uploads/  │
               │    └─metadata  │
               └────────────────┘
```

## Request Flow

### Sync Request (/run)

1. Client POSTs to `/run`
2. API service:
   - Validates request
   - Encrypts payload with KMS
   - Stores in GCS
   - Triggers Cloud Run Job
3. API service polls GCS for logs
4. API service streams logs to client via SSE
5. Job worker:
   - Reads encrypted payload
   - Decrypts with KMS
   - Executes task
   - Writes logs to GCS
   - Exits
6. API service detects completion, closes SSE connection

### Async Request (/run-async)

1. Client POSTs to `/run-async`
2. API service:
   - Validates request
   - Encrypts payload with KMS
   - Stores in GCS
   - Triggers Cloud Run Job
   - **Returns 202 immediately**
3. Job worker (background):
   - Reads encrypted payload
   - Decrypts with KMS
   - Executes task
   - Writes logs to GCS
   - Executes post-execution actions
   - POSTs webhook callback
   - Exits
4. Client receives webhook when complete

## Benefits

### 1. No CPU-Always-Allocated

**Before (In-Process):**
- Background tasks required CPU-always-allocated
- Billing for idle time
- $50-100/month minimum

**After (Cloud Run Jobs):**
- Jobs billed only during execution
- API service scales to zero
- ~$5-10/month typical usage

### 2. Better Resource Isolation

**Before:**
- Tasks share container resources
- One heavy task affects others
- Memory/CPU contention possible

**After:**
- Each task in separate container
- Dedicated resources per task
- No interference between tasks

### 3. Independent Scaling

**Before:**
- API and execution coupled
- Scale API = scale execution capacity

**After:**
- API service scales independently
- Job execution scales independently
- Optimize each component separately

### 4. Improved Security

**Before:**
- Credentials in memory during task
- Shared process space

**After:**
- Credentials encrypted at rest (KMS)
- Decrypted only in job container
- Automatic cleanup after execution

### 5. Automatic Timeout Handling

**Before:**
- Manual timeout management
- Complex cleanup logic

**After:**
- Cloud Run Jobs handle timeout automatically
- Guaranteed cleanup on timeout
- Consistent error handling

## Monitoring

### API Service Logs

```bash
# View API service logs
gcloud run services logs read claude-code-service --region=us-central1

# Filter for job triggers
gcloud run services logs read claude-code-service --region=us-central1 | grep "Triggering job"
```

### Job Execution Logs

```bash
# List recent job executions
gcloud run jobs executions list claude-code-job --region=us-central1 --limit=10

# View specific execution logs
gcloud run jobs executions logs read EXECUTION_NAME --region=us-central1

# Stream logs from latest execution
gcloud run jobs executions logs tail EXECUTION_NAME --region=us-central1
```

### Job Metrics

```bash
# Describe job to see execution stats
gcloud run jobs describe claude-code-job --region=us-central1

# View recent executions with status
gcloud run jobs executions list claude-code-job --region=us-central1 --format="table(name,status,completionTime)"
```

### GCS Logs

```bash
# List all tasks
gcloud storage ls gs://your-bucket/sessions/

# View specific task logs
gcloud storage cat gs://your-bucket/sessions/TASK_ID/*.jsonl

# View task metadata
gcloud storage cat gs://your-bucket/sessions/TASK_ID/metadata.json
```

## Troubleshooting

### Job Not Executing

**Symptoms:**
- API returns 202 but job never runs
- No job execution logs

**Solutions:**
1. Check job exists:
   ```bash
   gcloud run jobs list --region=us-central1
   ```

2. Check IAM permissions:
   ```bash
   ./scripts/grant-job-permissions.sh
   ```

3. Verify service account has `run.jobs.run` permission

### Job Fails Immediately

**Symptoms:**
- Job starts but fails within seconds
- Error in job logs about missing payload

**Solutions:**
1. Check encrypted payload in GCS:
   ```bash
   gcloud storage ls gs://your-bucket/encrypted-payloads/
   ```

2. Verify KMS permissions:
   ```bash
   gcloud kms keys list --location=global --keyring=claude-code
   ```

3. Check job logs for specific error:
   ```bash
   gcloud run jobs executions logs read EXECUTION_NAME --region=us-central1
   ```

### Job Timeouts

**Symptoms:**
- Job runs for 60 minutes then fails
- Logs show incomplete task

**Solutions:**
1. Reduce task complexity or split into smaller tasks
2. Check `timeoutMinutes` in request (max: 60)
3. Verify job timeout configuration:
   ```bash
   gcloud run jobs describe claude-code-job --region=us-central1 --format="value(template.template.spec.timeoutSeconds)"
   ```

### High Costs

**Symptoms:**
- Unexpected GCP bill
- Many job executions

**Solutions:**
1. Check job execution frequency:
   ```bash
   gcloud run jobs executions list claude-code-job --region=us-central1 --limit=100
   ```

2. Review GCS bucket size:
   ```bash
   gcloud storage du -sh gs://your-bucket
   ```

3. Verify lifecycle policies:
   ```bash
   gcloud storage buckets describe gs://your-bucket --format="value(lifecycle)"
   ```

4. Consider reducing:
   - Task frequency
   - maxTurns per task
   - Log retention period

## Best Practices

1. **Monitor Job Executions**
   - Set up alerting for failed jobs
   - Track execution duration
   - Monitor resource usage

2. **Optimize Job Configuration**
   - Set appropriate memory/CPU per job
   - Use timeout values wisely
   - Clean up old logs regularly

3. **Handle Failures Gracefully**
   - Implement retry logic in webhook handler
   - Log all errors for debugging
   - Alert on high failure rates

4. **Security**
   - Keep KMS keys secure
   - Rotate keys periodically
   - Use least-privilege IAM roles
   - Monitor access to GCS bucket

5. **Cost Management**
   - Set GCS lifecycle policies (30-day deletion)
   - Monitor job execution costs
   - Optimize task complexity
   - Use appropriate concurrency limits

## Next Steps

- See [Deployment Guide](./deployment.md) for setup instructions
- See [KMS Setup Guide](./kms-setup.md) for KMS configuration
- See [API Reference](./api-reference.md) for endpoint documentation
- See [Async Tasks Guide](./async-tasks.md) for async usage patterns
