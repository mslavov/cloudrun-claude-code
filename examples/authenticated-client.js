import { GoogleAuth } from 'google-auth-library';
import axios from 'axios';
import fs from 'fs';
import path from 'path';

/**
 * Example of authenticating to the Cloud Run service using a service account
 */
async function authenticatedRequest() {
  // Determine the service account key path
  // Supports both: SERVICE_ACCOUNT_PATH env var, project-specific keys, or default symlink
  let keyFilename = process.env.SERVICE_ACCOUNT_PATH;

  if (!keyFilename) {
    // Try to read project ID from .env for project-specific key
    if (fs.existsSync('.env')) {
      const envContent = fs.readFileSync('.env', 'utf8');
      const projectIdMatch = envContent.match(/^PROJECT_ID=(.+)$/m);
      if (projectIdMatch) {
        const projectId = projectIdMatch[1].trim();
        const projectSpecificPath = `service_accounts/${projectId}_service_account.json`;
        if (fs.existsSync(projectSpecificPath)) {
          keyFilename = projectSpecificPath;
        }
      }
    }

    // Fall back to default symlink
    if (!keyFilename && fs.existsSync('service_account.json')) {
      keyFilename = 'service_account.json';
    }
  }

  if (!keyFilename) {
    console.error('Error: No service account key found.');
    console.error('Run ./scripts/download-service-account-key.sh to download it');
    process.exit(1);
  }

  console.log(`Using service account key: ${keyFilename}`);

  // Initialize the Google Auth client with the service account key
  const auth = new GoogleAuth({
    keyFilename
  });

  // Get your Cloud Run service URL (replace with your actual URL)
  const SERVICE_URL = process.env.SERVICE_URL || 'https://your-service-name-xxxxx.run.app';
  
  try {
    // Get an ID token for the service URL
    const client = await auth.getIdTokenClient(SERVICE_URL);
    const headers = await client.getRequestHeaders();

    // Make a request to your service
    const response = await axios.post(
      `${SERVICE_URL}/run`,
      {
        prompt: 'What is 5+5?',
        maxTurns: 1,
        mcpConfigJson: { mcpServers: {} },
        allowedTools: [],
        permissionMode: 'acceptEdits'
      },
      {
        headers: {
          ...headers,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log('Response:', response.data);
  } catch (error) {
    console.error('Error:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
  }
}

// Run the example
authenticatedRequest();