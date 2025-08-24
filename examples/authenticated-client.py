import os
import json
import requests
from google.auth import jwt
from google.auth.transport.requests import Request

def authenticated_request():
    """
    Example of authenticating to the Cloud Run service using a service account
    """
    # Path to your service account key file
    SERVICE_ACCOUNT_FILE = 'service_account.json'
    
    # Your Cloud Run service URL (replace with your actual URL)
    SERVICE_URL = os.environ.get('SERVICE_URL', 'https://your-service-name-xxxxx.run.app')
    
    try:
        # Load the service account credentials
        with open(SERVICE_ACCOUNT_FILE, 'r') as f:
            service_account_info = json.load(f)
        
        # Create credentials object
        credentials = jwt.Credentials.from_service_account_info(
            service_account_info,
            audience=SERVICE_URL
        )
        
        # Refresh the credentials to get an ID token
        credentials.refresh(Request())
        
        # Make a request to your service
        headers = {
            'Authorization': f'Bearer {credentials.token}',
            'Content-Type': 'application/json'
        }
        
        data = {
            # Your request body here
            'command': 'echo "Hello from authenticated Python client"',
            'directory': '/tmp'
        }
        
        response = requests.post(
            f'{SERVICE_URL}/process',
            headers=headers,
            json=data
        )
        
        print('Response:', response.json())
        
    except FileNotFoundError:
        print(f'Error: Service account file {SERVICE_ACCOUNT_FILE} not found')
        print('Run ./scripts/download-service-account-key.sh to download it')
    except Exception as e:
        print(f'Error: {str(e)}')

if __name__ == '__main__':
    authenticated_request()