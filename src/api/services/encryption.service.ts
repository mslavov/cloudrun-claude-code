import { KeyManagementServiceClient } from '@google-cloud/kms';
import { logger } from '../../utils/logger.js';

/**
 * EncryptionService
 * Handles encryption/decryption of sensitive task payloads using Google Cloud KMS
 */
export class EncryptionService {
  private kmsClient: KeyManagementServiceClient;
  private projectId: string;
  private locationId: string;
  private keyRingId: string;
  private keyId: string;

  constructor() {
    this.kmsClient = new KeyManagementServiceClient();
    this.projectId = process.env.PROJECT_ID || process.env.GCS_PROJECT_ID || '';
    this.locationId = process.env.REGION || 'europe-west3';
    this.keyRingId = 'cloudrun-claude-code-keys';
    this.keyId = 'async-task-payload-key';

    if (!this.projectId) {
      throw new Error('PROJECT_ID or GCS_PROJECT_ID environment variable is required');
    }

    logger.debug('EncryptionService initialized', {
      projectId: this.projectId,
      location: this.locationId,
      keyRing: this.keyRingId,
      key: this.keyId
    });
  }

  /**
   * Encrypt task payload using Cloud KMS
   * @param payload - The task payload to encrypt (will be JSON-stringified)
   * @returns Encrypted data as Buffer
   */
  async encryptPayload(payload: any): Promise<Buffer> {
    const keyName = this.kmsClient.cryptoKeyPath(
      this.projectId,
      this.locationId,
      this.keyRingId,
      this.keyId
    );

    logger.debug('Encrypting payload with KMS key:', keyName);

    // Convert payload to JSON string, then to Buffer
    const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');

    try {
      const [result] = await this.kmsClient.encrypt({
        name: keyName,
        plaintext
      });

      if (!result.ciphertext) {
        throw new Error('KMS encryption returned no ciphertext');
      }

      const encryptedBuffer = Buffer.from(result.ciphertext as Uint8Array);
      logger.debug('Payload encrypted successfully', {
        plaintextSize: plaintext.length,
        encryptedSize: encryptedBuffer.length
      });

      return encryptedBuffer;
    } catch (error: any) {
      logger.error('Failed to encrypt payload:', error.message);
      throw new Error(`KMS encryption failed: ${error.message}`);
    }
  }

  /**
   * Decrypt task payload using Cloud KMS
   * @param encryptedData - The encrypted data as Buffer
   * @returns Decrypted and parsed payload object
   */
  async decryptPayload(encryptedData: Buffer): Promise<any> {
    const keyName = this.kmsClient.cryptoKeyPath(
      this.projectId,
      this.locationId,
      this.keyRingId,
      this.keyId
    );

    logger.debug('Decrypting payload with KMS key:', keyName);

    try {
      const [result] = await this.kmsClient.decrypt({
        name: keyName,
        ciphertext: encryptedData
      });

      if (!result.plaintext) {
        throw new Error('KMS decryption returned no plaintext');
      }

      const plaintextBuffer = Buffer.from(result.plaintext as Uint8Array);
      const plaintextString = plaintextBuffer.toString('utf8');

      logger.debug('Payload decrypted successfully', {
        decryptedSize: plaintextBuffer.length
      });

      // Parse JSON
      const payload = JSON.parse(plaintextString);
      return payload;
    } catch (error: any) {
      logger.error('Failed to decrypt payload:', error.message);
      throw new Error(`KMS decryption failed: ${error.message}`);
    }
  }

  /**
   * Get KMS key resource name (for IAM binding and debugging)
   * @returns Full KMS key resource name
   */
  getKeyName(): string {
    return this.kmsClient.cryptoKeyPath(
      this.projectId,
      this.locationId,
      this.keyRingId,
      this.keyId
    );
  }

  /**
   * Get KMS configuration details
   * @returns Configuration object
   */
  getConfig() {
    return {
      projectId: this.projectId,
      location: this.locationId,
      keyRing: this.keyRingId,
      key: this.keyId,
      keyName: this.getKeyName()
    };
  }
}
