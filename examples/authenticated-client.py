import os
import json
import requests
import re
from pathlib import Path
from google.auth import jwt
from google.auth.transport.requests import Request

def authenticated_request():
    """
    Example of authenticating to the Cloud Run service using a service account
    """
    # Determine the service account key path
    # Supports both: SERVICE_ACCOUNT_PATH env var, project-specific keys, or default symlink
    SERVICE_ACCOUNT_FILE = os.environ.get('SERVICE_ACCOUNT_PATH')

    if not SERVICE_ACCOUNT_FILE:
        # Try to read project ID from .env for project-specific key
        env_file = Path('.env')
        if env_file.exists():
            with open(env_file, 'r') as f:
                env_content = f.read()
                match = re.search(r'^PROJECT_ID=(.+)$', env_content, re.MULTILINE)
                if match:
                    project_id = match.group(1).strip()
                    project_specific_path = f'service_accounts/{project_id}_service_account.json'
                    if Path(project_specific_path).exists():
                        SERVICE_ACCOUNT_FILE = project_specific_path

        # Fall back to default symlink
        if not SERVICE_ACCOUNT_FILE and Path('service_account.json').exists():
            SERVICE_ACCOUNT_FILE = 'service_account.json'

    if not SERVICE_ACCOUNT_FILE:
        print('Error: No service account key found.')
        print('Run ./scripts/download-service-account-key.sh to download it')
        return

    print(f'Using service account key: {SERVICE_ACCOUNT_FILE}')
    
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