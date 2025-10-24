import { KeyManagementServiceClient } from '@google-cloud/kms';
import { logger } from '../../utils/logger.js';
import * as crypto from 'crypto';

/**
 * EncryptionService
 * Handles encryption/decryption of sensitive task payloads using Google Cloud KMS
 * with envelope encryption for large payloads
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
    this.keyRingId = process.env.KMS_KEY_RING || 'cloudrun-claude-code-keys';
    this.keyId = process.env.KMS_KEY_NAME || 'async-task-payload-key';

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
   * Encrypt task payload using envelope encryption
   *
   * Uses envelope encryption pattern:
   * 1. Generate random Data Encryption Key (DEK)
   * 2. Encrypt DEK with Cloud KMS
   * 3. Encrypt payload with DEK using AES-256-GCM
   * 4. Return both encrypted DEK and encrypted payload
   *
   * This allows encrypting large payloads that exceed KMS's 64KB limit
   *
   * @param payload - The task payload to encrypt (will be JSON-stringified)
   * @returns Encrypted envelope data as Buffer (JSON with encryptedDek and encryptedData)
   */
  async encryptPayload(payload: any): Promise<Buffer> {
    const keyName = this.kmsClient.cryptoKeyPath(
      this.projectId,
      this.locationId,
      this.keyRingId,
      this.keyId
    );

    logger.debug('Encrypting payload with envelope encryption using KMS key:', keyName);

    // Convert payload to JSON string
    const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
    logger.debug('Payload size before encryption:', plaintext.length, 'bytes');

    try {
      // Step 1: Generate a random 32-byte Data Encryption Key (DEK)
      const dek = crypto.randomBytes(32);

      // Step 2: Encrypt the DEK with Cloud KMS
      const [kmsResult] = await this.kmsClient.encrypt({
        name: keyName,
        plaintext: dek
      });

      if (!kmsResult.ciphertext) {
        throw new Error('KMS encryption returned no ciphertext');
      }

      const encryptedDek = Buffer.from(kmsResult.ciphertext as Uint8Array);
      logger.debug('DEK encrypted with KMS', {
        dekSize: dek.length,
        encryptedDekSize: encryptedDek.length
      });

      // Step 3: Encrypt the payload with the DEK using AES-256-GCM
      const iv = crypto.randomBytes(12); // 12 bytes for GCM mode
      const cipher = crypto.createCipheriv('aes-256-gcm', dek, iv);

      const encryptedData = Buffer.concat([
        cipher.update(plaintext),
        cipher.final()
      ]);
      const authTag = cipher.getAuthTag();

      logger.debug('Payload encrypted with DEK', {
        plaintextSize: plaintext.length,
        encryptedSize: encryptedData.length,
        ivSize: iv.length,
        authTagSize: authTag.length
      });

      // Step 4: Create envelope with all components
      const envelope = {
        version: 'v2-envelope',
        encryptedDek: encryptedDek.toString('base64'),
        iv: iv.toString('base64'),
        authTag: authTag.toString('base64'),
        encryptedData: encryptedData.toString('base64')
      };

      const envelopeBuffer = Buffer.from(JSON.stringify(envelope), 'utf8');
      logger.debug('Envelope created', {
        totalSize: envelopeBuffer.length
      });

      return envelopeBuffer;
    } catch (error: any) {
      logger.error('Failed to encrypt payload:', error.message);
      throw new Error(`Envelope encryption failed: ${error.message}`);
    }
  }

  /**
   * Decrypt task payload using envelope encryption or legacy KMS decryption
   *
   * Supports both:
   * - v2-envelope: Envelope encryption (new format)
   * - legacy: Direct KMS encryption (for backward compatibility)
   *
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
      // Try to parse as JSON envelope first (new format)
      let envelope: any;
      try {
        envelope = JSON.parse(encryptedData.toString('utf8'));
      } catch (parseError) {
        // Not JSON, assume legacy direct KMS encryption
        envelope = null;
      }

      // Check if it's the new envelope format
      if (envelope && envelope.version === 'v2-envelope') {
        logger.debug('Detected v2-envelope format, using envelope decryption');

        // Step 1: Decrypt the DEK with Cloud KMS
        const encryptedDek = Buffer.from(envelope.encryptedDek, 'base64');
        const [kmsResult] = await this.kmsClient.decrypt({
          name: keyName,
          ciphertext: encryptedDek
        });

        if (!kmsResult.plaintext) {
          throw new Error('KMS decryption of DEK returned no plaintext');
        }

        const dek = Buffer.from(kmsResult.plaintext as Uint8Array);
        logger.debug('DEK decrypted with KMS', {
          dekSize: dek.length
        });

        // Step 2: Decrypt the payload with the DEK using AES-256-GCM
        const iv = Buffer.from(envelope.iv, 'base64');
        const authTag = Buffer.from(envelope.authTag, 'base64');
        const encryptedPayload = Buffer.from(envelope.encryptedData, 'base64');

        const decipher = crypto.createDecipheriv('aes-256-gcm', dek, iv);
        decipher.setAuthTag(authTag);

        const decryptedData = Buffer.concat([
          decipher.update(encryptedPayload),
          decipher.final()
        ]);

        logger.debug('Payload decrypted with DEK', {
          decryptedSize: decryptedData.length
        });

        // Parse and return JSON
        const payload = JSON.parse(decryptedData.toString('utf8'));
        return payload;

      } else {
        // Legacy format: Direct KMS decryption
        logger.debug('Detected legacy format, using direct KMS decryption');

        const [result] = await this.kmsClient.decrypt({
          name: keyName,
          ciphertext: encryptedData
        });

        if (!result.plaintext) {
          throw new Error('KMS decryption returned no plaintext');
        }

        const plaintextBuffer = Buffer.from(result.plaintext as Uint8Array);
        const plaintextString = plaintextBuffer.toString('utf8');

        logger.debug('Payload decrypted successfully (legacy)', {
          decryptedSize: plaintextBuffer.length
        });

        // Parse JSON
        const payload = JSON.parse(plaintextString);
        return payload;
      }
    } catch (error: any) {
      logger.error('Failed to decrypt payload:', error.message);
      throw new Error(`Payload decryption failed: ${error.message}`);
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
