# Authentication Examples

This directory contains examples of how to authenticate and call your Cloud Run service.

## Prerequisites

1. Deploy your service and set up authentication:
   ```bash
   ./scripts/deploy-service.sh
   ./scripts/setup-service-account.sh
   ./scripts/download-service-account-key.sh
   ```

2. Get your service URL from the deployment output or run:
   ```bash
   gcloud run services describe YOUR_SERVICE_NAME --region=YOUR_REGION --format="value(status.url)"
   ```

## Setting the Service URL

You can provide the service URL in two ways:

1. **Environment variable** (recommended):
   ```bash
   export SERVICE_URL="https://your-service-xxxxx.run.app"
   ```

2. **Edit the examples** directly and replace `https://your-service-name-xxxxx.run.app` with your actual URL

## Examples

### Shell/Curl with gcloud authentication
```bash
./authenticated-curl.sh
```
Uses `gcloud auth print-identity-token` for authentication. Best for developers and testing.

### Node.js/JavaScript with service account
```bash
npm install google-auth-library axios
node authenticated-client.js
```
Uses `service_account.json` for authentication. Best for applications.

### Python with service account
```bash
pip install google-auth requests
python authenticated-client.py
```
Uses `service_account.json` for authentication. Best for Python applications.

## Notes

- The `service_account.json` file is required for the Node.js and Python examples
- Make sure you have the correct IAM permissions (Cloud Run Invoker role)
- The service must be deployed without `--allow-unauthenticated` flag