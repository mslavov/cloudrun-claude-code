# Post-Execution Actions Guide

This guide explains how to use post-execution actions to automate git operations and file uploads after task completion.

## Table of Contents

1. [Overview](#overview)
2. [Git Operations](#git-operations)
3. [File Uploads](#file-uploads)
4. [Configuration](#configuration)
5. [Examples](#examples)
6. [Best Practices](#best-practices)
7. [Troubleshooting](#troubleshooting)

## Overview

Post-execution actions allow you to automate operations after a Claude Code task completes successfully. This is particularly useful for CI/CD workflows, automated testing, and code generation tasks.

**Available Actions:**
- **Git Operations:** Commit and/or push changes to remote repository
- **File Uploads:** Upload files to GCS using glob patterns

**Key Features:**
- ✅ Only executes if task completes successfully (exit code 0)
- ✅ Results included in webhook callback
- ✅ Failures logged but don't fail the task
- ✅ Git identity configurable via `.gitconfig`
- ✅ SSH key authentication supported

## Git Operations

### Overview

The git service can automatically commit and push changes made by Claude during task execution.

**Capabilities:**
- Commit all changes or specific files
- Custom commit messages
- Push to any branch
- SSH key authentication
- Git identity from `.gitconfig` or defaults

### Configuration

```json
{
  "postExecutionActions": {
    "git": {
      "commit": true,
      "commitMessage": "Update generated code",
      "push": true,
      "branch": "main",
      "files": ["src/**", "tests/**"]
    }
  }
}
```

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `commit` | boolean | Yes | Whether to create a git commit |
| `commitMessage` | string | No | Custom commit message (default: auto-generated) |
| `push` | boolean | Yes | Whether to push commit to remote |
| `branch` | string | No | Branch to push to (default: "main") |
| `files` | string[] | No | Specific files to commit (default: all changes) |

### Git Identity

The service reads git identity from `.gitconfig` file in the repository root:

```ini
# .gitconfig in repository root
[user]
    name = Your Name
    email = your.email@example.com
```

If no `.gitconfig` exists, defaults are used:
- Name: `Claude Code`
- Email: `noreply@anthropic.com`

### How It Works

1. **Task executes** - Claude makes changes to files
2. **Check for changes** - `git status` to detect modifications
3. **Configure identity** - Read from `.gitconfig` or use defaults
4. **Stage files** - `git add` (all or specific files)
5. **Create commit** - `git commit -m "message"`
6. **Push to remote** - `git push origin branch` (if push: true)
7. **Return result** - Include commit SHA, message, pushed status in webhook

### Examples

#### Commit Only

```json
{
  "postExecutionActions": {
    "git": {
      "commit": true,
      "commitMessage": "Add test snapshots",
      "push": false
    }
  }
}
```

**Result in webhook:**
```json
{
  "gitCommit": {
    "sha": "a1b2c3d4e5f6",
    "message": "Add test snapshots",
    "pushed": false
  }
}
```

#### Commit and Push

```json
{
  "postExecutionActions": {
    "git": {
      "commit": true,
      "push": true,
      "branch": "develop"
    }
  }
}
```

#### Commit Specific Files

```json
{
  "postExecutionActions": {
    "git": {
      "commit": true,
      "commitMessage": "Update API documentation",
      "push": true,
      "branch": "docs-update",
      "files": ["docs/api/**", "README.md"]
    }
  }
}
```

## File Uploads

### Overview

Upload files from the workspace to GCS after task completion. Useful for preserving:
- Test artifacts (videos, screenshots)
- Generated files (reports, documentation)
- Build outputs (compiled binaries)
- Logs and debug files

### Configuration

```json
{
  "postExecutionActions": {
    "uploadFiles": {
      "globPatterns": [".playwright/**/*.webm", "*.log", "coverage/**"],
      "gcsPrefix": "test-artifacts"
    }
  }
}
```

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `glob Patterns` | string[] | Yes | Glob patterns for files to upload |
| `gcsPrefix` | string | No | Optional prefix in GCS bucket path |

### Glob Patterns

Supports standard glob syntax:
- `*.log` - All log files in root
- `**/*.webm` - All webm files recursively
- `.playwright/**/*` - All files in .playwright directory
- `coverage/**` - All files in coverage directory
- `dist/*.js` - JavaScript files in dist directory

### GCS Storage Location

Files are uploaded to:
```
gs://bucket/sessions/{taskId}/uploads/{gcsPrefix}/{relativePath}
```

**Example:**
- Task ID: `test-123`
- Glob pattern: `.playwright/**/*.webm`
- Matched file: `.playwright/test-results/video-1.webm`
- GCS prefix: `test-artifacts`
- Uploaded to: `gs://bucket/sessions/test-123/uploads/test-artifacts/.playwright/test-results/video-1.webm`

### Examples

#### Upload Test Videos

```json
{
  "postExecutionActions": {
    "uploadFiles": {
      "globPatterns": [".playwright/**/*.webm"],
      "gcsPrefix": "videos"
    }
  }
}
```

#### Upload Multiple Artifact Types

```json
{
  "postExecutionActions": {
    "uploadFiles": {
      "globPatterns": [
        "*.log",
        "coverage/**",
        "test-results/**/*.png",
        "dist/*.js"
      ],
      "gcsPrefix": "artifacts"
    }
  }
}
```

#### Upload Without Prefix

```json
{
  "postExecutionActions": {
    "uploadFiles": {
      "globPatterns": ["build/**"]
    }
  }
}
```

Files uploaded to: `gs://bucket/sessions/{taskId}/uploads/build/...`

## Configuration

### Complete Example

```json
{
  "prompt": "Run Playwright tests and update snapshots",
  "anthropicApiKey": "sk-ant-...",
  "callbackUrl": "https://app.example.com/webhooks/test-complete",
  "gitRepo": "git@github.com:org/repo.git",
  "gitBranch": "main",
  "sshKey": "-----BEGIN OPENSSH PRIVATE KEY-----\n...",
  "maxTurns": 20,
  "postExecutionActions": {
    "git": {
      "commit": true,
      "commitMessage": "Update Playwright snapshots\n\nGenerated by automated test run",
      "push": true,
      "branch": "main"
    },
    "uploadFiles": {
      "globPatterns": [
        ".playwright/**/*.webm",
        ".playwright/**/*.png",
        "playwright-report/**",
        "test-results/**"
      ],
      "gcsPrefix": "playwright-artifacts"
    }
  },
  "metadata": {
    "testRun": "nightly-2025-01-10",
    "environment": "staging"
  }
}
```

### Webhook Callback

When task completes, webhook receives:

```json
{
  "taskId": "test-run-123",
  "status": "completed",
  "exitCode": 0,
  "logsPath": "gs://bucket/sessions/test-run-123/",
  "summary": {
    "durationMs": 180000,
    "turns": 15,
    "errors": 0,
    "startedAt": "2025-01-10T02:00:00.000Z",
    "completedAt": "2025-01-10T02:03:00.000Z"
  },
  "uploadedFiles": [
    {
      "originalPath": ".playwright/test-results/video-1.webm",
      "gcsPath": "gs://bucket/sessions/test-run-123/uploads/playwright-artifacts/.playwright/test-results/video-1.webm",
      "sizeBytes": 2457600
    },
    {
      "originalPath": "test-results/results.json",
      "gcsPath": "gs://bucket/sessions/test-run-123/uploads/playwright-artifacts/test-results/results.json",
      "sizeBytes": 45231
    }
  ],
  "gitCommit": {
    "sha": "a1b2c3d4e5f6",
    "message": "Update Playwright snapshots\n\nGenerated by automated test run",
    "pushed": true,
    "branch": "main"
  },
  "metadata": {
    "testRun": "nightly-2025-01-10",
    "environment": "staging"
  }
}
```

## Examples

### Example 1: Automated Test Run

**Scenario:** Run Playwright tests nightly, commit snapshots, upload videos

```bash
curl -X POST https://service-url/run-async \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "prompt": "Run Playwright tests with npm test",
    "anthropicApiKey": "sk-ant-...",
    "callbackUrl": "https://app.com/webhooks/tests",
    "gitRepo": "git@github.com:org/e2e-tests.git",
    "sshKey": "...",
    "maxTurns": 15,
    "postExecutionActions": {
      "git": {
        "commit": true,
        "commitMessage": "Update test snapshots [skip ci]",
        "push": true,
        "branch": "main"
      },
      "uploadFiles": {
        "globPatterns": [".playwright/**/*.webm", "playwright-report/**"],
        "gcsPrefix": "nightly-tests"
      }
    },
    "metadata": {
      "testRun": "nightly",
      "date": "2025-01-10"
    }
  }'
```

### Example 2: Documentation Generation

**Scenario:** Generate API docs, commit to repo, upload HTML

```bash
curl -X POST https://service-url/run-async \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "prompt": "Generate API documentation using TypeDoc",
    "anthropicApiKey": "sk-ant-...",
    "callbackUrl": "https://app.com/webhooks/docs",
    "gitRepo": "https://github.com/org/api.git",
    "maxTurns": 10,
    "postExecutionActions": {
      "git": {
        "commit": true,
        "commitMessage": "Update API documentation",
        "push": true,
        "branch": "gh-pages",
        "files": ["docs/**"]
      },
      "uploadFiles": {
        "globPatterns": ["docs/**/*.html", "docs/**/*.css"],
        "gcsPrefix": "documentation"
      }
    }
  }'
```

### Example 3: Build and Deploy

**Scenario:** Build project, commit artifacts, upload dist files

```bash
curl -X POST https://service-url/run-async \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "prompt": "Run npm run build and commit the output",
    "anthropicApiKey": "sk-ant-...",
    "callbackUrl": "https://app.com/webhooks/build",
    "gitRepo": "git@github.com:org/webapp.git",
    "sshKey": "...",
    "environmentSecrets": {
      "NODE_ENV": "production",
      "API_URL": "https://api.example.com"
    },
    "maxTurns": 10,
    "postExecutionActions": {
      "git": {
        "commit": true,
        "commitMessage": "Build production assets",
        "push": true,
        "branch": "production",
        "files": ["dist/**"]
      },
      "uploadFiles": {
        "globPatterns": ["dist/**", "build-stats.json"],
        "gcsPrefix": "production-build"
      }
    }
  }'
```

## Best Practices

### 1. Use .gitconfig for Identity

Create `.gitconfig` in repository root:

```ini
[user]
    name = CI Bot
    email = ci@example.com
```

Benefits:
- Consistent authorship
- Easy to change without code changes
- Tracked in version control

### 2. Meaningful Commit Messages

```json
{
  "commitMessage": "Update test snapshots\n\nAutomated update from nightly test run\nTest suite: e2e-tests\nEnvironment: staging"
}
```

### 3. Use [skip ci] When Appropriate

Prevent infinite CI loops:

```json
{
  "commitMessage": "Update generated files [skip ci]"
}
```

### 4. Organize Uploads with Prefixes

```json
{
  "uploadFiles": {
    "globPatterns": ["coverage/**"],
    "gcsPrefix": "coverage/2025-01-10"  // Date-based organization
  }
}
```

### 5. Be Specific with Glob Patterns

```json
{
  // Good - specific
  "globPatterns": [".playwright/**/*.webm", "*.log"]

  // Bad - too broad
  "globPatterns": ["**/*"]  // Uploads everything!
}
```

### 6. Handle Webhook Results

```javascript
app.post('/webhooks/test-complete', async (req, res) => {
  const { uploadedFiles, gitCommit } = req.body;

  if (gitCommit && gitCommit.pushed) {
    console.log(`Pushed commit ${gitCommit.sha} to ${gitCommit.branch}`);
  }

  if (uploadedFiles && uploadedFiles.length > 0) {
    console.log(`Uploaded ${uploadedFiles.length} files`);
    for (const file of uploadedFiles) {
      console.log(`  ${file.originalPath} → ${file.gcsPath}`);
    }
  }

  // Process artifacts...
  res.status(200).json({ received: true });
});
```

## Troubleshooting

### No Changes to Commit

**Symptom:** Webhook shows `gitCommit: null`

**Cause:** Claude didn't modify any files

**Solution:**
- Check task logs to see what Claude did
- Ensure prompt clearly requests file modifications
- Verify git repo was cloned successfully

### Git Push Failed

**Symptom:** `gitCommit.pushed: false` in webhook

**Causes:**
- SSH key doesn't have write access
- Branch protection rules
- Authentication failure

**Solutions:**
1. Verify SSH key has push permissions
2. Check branch protection settings on GitHub
3. Review git operation logs in GCS

### Files Not Uploaded

**Symptom:** `uploadedFiles: []` in webhook

**Causes:**
- Glob pattern doesn't match any files
- Files don't exist in workspace

**Solutions:**
1. Check glob patterns are correct:
   ```json
   // Wrong
   "globPatterns": ["playwright/**"]  // Missing leading dot!

   // Right
   "globPatterns": [".playwright/**"]
   ```

2. Verify files exist in task logs
3. Check workspace path in logs

### Permission Denied

**Symptom:** Error in logs: "Permission denied writing to GCS"

**Solution:**
```bash
# Grant storage permissions
./scripts/grant-job-permissions.sh

# Verify permissions
gcloud projects get-iam-policy $PROJECT_ID \
  --flatten="bindings[].members" \
  --filter="bindings.role:roles/storage.objectAdmin"
```

## Use Cases

### CI/CD Integration

- Run tests, commit results, upload artifacts
- Build projects, push dist files
- Generate docs, publish to gh-pages

### Automated Maintenance

- Update dependencies, commit lock files
- Refactor code, commit changes
- Generate test data, commit fixtures

### Content Generation

- Generate documentation, commit markdown
- Create diagrams, commit images
- Build static sites, upload HTML

### Testing & QA

- Run visual tests, commit snapshots
- Generate coverage reports, upload HTML
- Create test reports, push to repo

## Next Steps

- See [Async Tasks Guide](./async-tasks.md) for full async task documentation
- See [API Reference](./api-reference.md) for complete parameter reference
- See [Git Service Code](../src/api/services/git.service.ts) for implementation details
- Check [examples/](../examples/) directory for working examples
