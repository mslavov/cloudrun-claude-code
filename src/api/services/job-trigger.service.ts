import { GoogleAuth } from 'google-auth-library';
import axios from 'axios';
import { logger } from '../../utils/logger.js';

/**
 * JobTriggerService
 * Triggers Cloud Run Job executions for async task processing
 */
export class JobTriggerService {
  private projectId: string;
  private region: string;
  private jobName: string;

  constructor() {
    this.projectId = process.env.PROJECT_ID || process.env.GCS_PROJECT_ID || '';
    this.region = process.env.REGION || 'europe-west3';
    this.jobName = process.env.CLOUDRUN_JOB_NAME || 'claude-code-async-worker';

    if (!this.projectId) {
      throw new Error('PROJECT_ID or GCS_PROJECT_ID environment variable is required');
    }

    logger.debug('JobTriggerService initialized', {
      projectId: this.projectId,
      region: this.region,
      jobName: this.jobName
    });
  }

  /**
   * Trigger a Cloud Run Job execution
   * Only passes non-sensitive data via environment variables
   *
   * @param taskId - Unique task identifier
   * @param encryptedPayloadPath - GCS path to encrypted payload
   * @returns Execution name (e.g., "projects/.../jobs/.../executions/xxx")
   */
  async triggerJobExecution(
    taskId: string,
    encryptedPayloadPath: string
  ): Promise<string> {
    logger.info(`[TASK ${taskId}] Triggering Cloud Run Job: ${this.jobName}`);

    try {
      // Get authenticated client
      const auth = new GoogleAuth({
        scopes: ['https://www.googleapis.com/auth/cloud-platform']
      });
      const client = await auth.getClient();
      const accessToken = await client.getAccessToken();

      if (!accessToken.token) {
        throw new Error('Failed to obtain access token');
      }

      // Construct Cloud Run Jobs API URL
      const url = `https://run.googleapis.com/v2/projects/${this.projectId}/locations/${this.region}/jobs/${this.jobName}:run`;

      logger.debug(`[TASK ${taskId}] Job API URL: ${url}`);

      // Trigger job with environment variable overrides
      // IMPORTANT: Only non-sensitive data passed here
      const response = await axios.post(url, {
        overrides: {
          containerOverrides: [{
            env: [
              { name: 'TASK_ID', value: taskId },
              { name: 'ENCRYPTED_PAYLOAD_PATH', value: encryptedPayloadPath }
              // NO SECRETS - only references to encrypted data
            ]
          }]
        }
      }, {
        headers: {
          'Authorization': `Bearer ${accessToken.token}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000 // 30 second timeout for API call
      });

      const executionName = response.data.name;
      logger.info(`[TASK ${taskId}] Job execution started: ${executionName}`);

      return executionName;

    } catch (error: any) {
      logger.error(`[TASK ${taskId}] Failed to trigger job:`, error.message);

      // Enhance error message for common issues
      if (error.response) {
        const status = error.response.status;
        const data = error.response.data;

        if (status === 404) {
          throw new Error(`Cloud Run Job "${this.jobName}" not found in ${this.region}. Create it first with scripts/create-job.sh`);
        } else if (status === 403) {
          throw new Error(`Permission denied to run job "${this.jobName}". Grant service account roles/run.developer permission.`);
        } else {
          throw new Error(`Job trigger failed (HTTP ${status}): ${JSON.stringify(data)}`);
        }
      }

      throw error;
    }
  }

  /**
   * Get job configuration (for debugging)
   */
  getConfig() {
    return {
      projectId: this.projectId,
      region: this.region,
      jobName: this.jobName,
      jobUrl: `https://console.cloud.google.com/run/jobs/details/${this.region}/${this.jobName}?project=${this.projectId}`
    };
  }

  /**
   * Cancel a running Cloud Run Job execution
   *
   * @param executionName - Full execution name (e.g., "projects/.../jobs/.../executions/xxx")
   * @returns true if cancelled successfully, false otherwise
   */
  async cancelJobExecution(executionName: string): Promise<boolean> {
    logger.info(`Cancelling job execution: ${executionName}`);

    try {
      // Get authenticated client
      const auth = new GoogleAuth({
        scopes: ['https://www.googleapis.com/auth/cloud-platform']
      });
      const client = await auth.getClient();
      const accessToken = await client.getAccessToken();

      if (!accessToken.token) {
        throw new Error('Failed to obtain access token');
      }

      // Construct cancel API URL
      const url = `https://run.googleapis.com/v2/${executionName}:cancel`;

      logger.debug(`Cancel API URL: ${url}`);

      const response = await axios.post(url, {}, {
        headers: {
          'Authorization': `Bearer ${accessToken.token}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000, // 30 second timeout
        validateStatus: () => true // Don't throw on any status code
      });

      if (response.status >= 200 && response.status < 300) {
        logger.info(`Job execution cancelled successfully: ${executionName}`);
        return true;
      } else if (response.status === 404) {
        logger.warn(`Job execution not found (may have already completed): ${executionName}`);
        return false;
      } else {
        logger.error(`Failed to cancel job execution (HTTP ${response.status}):`, response.data);
        return false;
      }

    } catch (error: any) {
      logger.error(`Error cancelling job execution ${executionName}:`, error.message);
      return false;
    }
  }

  /**
   * Get the status of a Cloud Run Job execution
   *
   * @param executionName - Full execution name (e.g., "projects/.../jobs/.../executions/xxx")
   * @returns Execution status object or null if not found
   */
  async getJobExecutionStatus(executionName: string): Promise<any | null> {
    logger.debug(`Getting status for job execution: ${executionName}`);

    try {
      // Get authenticated client
      const auth = new GoogleAuth({
        scopes: ['https://www.googleapis.com/auth/cloud-platform']
      });
      const client = await auth.getClient();
      const accessToken = await client.getAccessToken();

      if (!accessToken.token) {
        throw new Error('Failed to obtain access token');
      }

      // Construct get API URL
      const url = `https://run.googleapis.com/v2/${executionName}`;

      const response = await axios.get(url, {
        headers: {
          'Authorization': `Bearer ${accessToken.token}`
        },
        timeout: 30000,
        validateStatus: () => true
      });

      if (response.status >= 200 && response.status < 300) {
        logger.debug(`Job execution status retrieved: ${executionName}`);
        return response.data;
      } else if (response.status === 404) {
        logger.warn(`Job execution not found: ${executionName}`);
        return null;
      } else {
        logger.error(`Failed to get job execution status (HTTP ${response.status}):`, response.data);
        return null;
      }

    } catch (error: any) {
      logger.error(`Error getting job execution status ${executionName}:`, error.message);
      return null;
    }
  }
}
