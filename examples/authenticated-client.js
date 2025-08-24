import { GoogleAuth } from 'google-auth-library';
import axios from 'axios';

/**
 * Example of authenticating to the Cloud Run service using a service account
 */
async function authenticatedRequest() {
  // Initialize the Google Auth client with the service account key
  const auth = new GoogleAuth({
    keyFilename: 'service_account.json' // Path to your service account key file
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