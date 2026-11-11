import crypto from 'node:crypto';
import type { SubHttpFailureType } from './types.js';

/**
 * Cryptography, Error Classification, and Deduplication/Ordering Sketch
 */

const DEFAULT_PROCESS_HMAC_KEY = crypto.randomBytes(32).toString('hex');

/**
 * Computes a keyed HMAC-SHA256 digest.
 *
 * Why HMAC-SHA256 instead of plain SHA-256?
 * Small webhook payloads (e.g. `{"id":"evt_1","status":"paid"}`) have low entropy.
 * If an exported diagnostic episode contained an unkeyed SHA-256 hash, an attacker
 * could brute-force candidate payloads offline. A keyed HMAC prevents offline guessing
 * while still producing deterministic digests for identical payloads within the host.
 */
export function computeHmacSha256(
  data: Buffer | string,
  key: string = DEFAULT_PROCESS_HMAC_KEY
): string {
  return crypto.createHmac('sha256', key).update(data).digest('hex');
}

/**
 * Incremental HMAC builder used by the passive stream tap so we can compute
 * a full-stream digest even if `MAX_TAP_BYTES` truncates the in-memory preview buffer.
 */
export class StreamingHmac {
  private hmac: crypto.Hmac;
  constructor(key: string = DEFAULT_PROCESS_HMAC_KEY) {
    this.hmac = crypto.createHmac('sha256', key);
  }
  update(chunk: Buffer): void {
    this.hmac.update(chunk);
  }
  digest(): string {
    return this.hmac.digest('hex');
  }
}

/**
 * KNOWN_ERRORS structural lookup table.
 *
 * Instead of fragile regex matching on human-readable `err.message` strings
 * (which change across Node/OpenSSL versions and locales), we inspect structural
 * properties like `err.code` and `err.name`.
 */
export const KNOWN_CRYPTO_ERROR_CODES = new Set([
  'ERR_OSSL_EVP_BAD_DECRYPT', // Node crypto.DecipherGCM bad auth tag / key
  'ERR_CRYPTO_INVALID_AUTH_TAG',
  'ERR_JWE_DECRYPTION_FAILED',
  'ERR_JWE_INVALID',
]);

export function isKnownDecryptError(err: unknown): {
  isDecryptFailure: boolean;
  errorCode: string;
} {
  if (!err || typeof err !== 'object') {
    return { isDecryptFailure: false, errorCode: 'UNKNOWN' };
  }
  const e = err as { code?: string; name?: string; message?: string };
  if (e.code && KNOWN_CRYPTO_ERROR_CODES.has(e.code)) {
    return { isDecryptFailure: true, errorCode: e.code };
  }
  // WebCrypto SubtleCrypto.decrypt throws DOMException with name === 'OperationError'
  if (e.name === 'OperationError') {
    return { isDecryptFailure: true, errorCode: 'WEBCRYPTO_OPERATION_ERROR' };
  }
  // Node's Decipheriv.final() in some OpenSSL 3 builds sets message 'Unsupported state or unable to authenticate data' without a code
  if (
    e.message &&
    e.message.includes('unable to authenticate data')
  ) {
    return { isDecryptFailure: true, errorCode: 'GCM_AUTH_TAG_FAILED' };
  }
  return { isDecryptFailure: false, errorCode: e.code || e.name || 'UNKNOWN_ERROR' };
}

/**
 * Maps low-level Node/Undici socket & network error codes to SubHttpFailureType.
 */
export function classifySubHttpError(err: unknown): {
  errorCode: string;
  subType: SubHttpFailureType;
  message: string;
} {
  if (!err || typeof err !== 'object') {
    return {
      errorCode: 'UNKNOWN',
      subType: 'UNKNOWN_NETWORK_ERROR',
      message: String(err),
    };
  }
  const e = err as {
    code?: string;
    name?: string;
    message?: string;
    cause?: { code?: string; message?: string };
  };
  const code = e.code || e.cause?.code || e.name || 'UNKNOWN';
  const message = e.cause?.message || e.message || 'Network error';

  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return { errorCode: code, subType: 'DNS_FAILURE', message };
  }
  if (code === 'ECONNREFUSED' || code === 'ECONNRESET') {
    return { errorCode: code, subType: 'TCP_REFUSED', message };
  }
  if (
    code.startsWith('CERT_') ||
    code.startsWith('ERR_TLS_') ||
    code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
    code === 'DEPTH_ZERO_SELF_SIGNED_CERT'
  ) {
    return { errorCode: code, subType: 'TLS_ERROR', message };
  }
  if (
    code === 'UND_ERR_CONNECT_TIMEOUT' ||
    code === 'UND_ERR_HEADERS_TIMEOUT' ||
    code === 'UND_ERR_BODY_TIMEOUT' ||
    code === 'UND_ERR_SOCKET' ||
    code === 'ETIMEDOUT' ||
    code === 'AbortError' ||
    code === 'TimeoutError'
  ) {
    return { errorCode: code, subType: 'SOCKET_TIMEOUT', message };
  }
  return { errorCode: code, subType: 'UNKNOWN_NETWORK_ERROR', message };
}

/**
 * Bounded Ring-Buffer Sketch for Duplicate Delivery & Out-of-Order Detection.
 *
 * Why a bounded sketch?
 * Because the SDK lives inside the host's process memory, tracking seen webhook
 * deliveries must never grow unboundedly. A fixed-capacity ring buffer / LRU map
 * catches retries and out-of-order arrivals within the active window with O(1) memory.
 */
export class DeliveryHistorySketch {
  private seenDeliveries = new Set<string>();
  private deliveryQueue: string[] = [];
  private latestResourceTimestamp = new Map<string, number>();

  constructor(private readonly maxCapacity = 2048) {}

  /**
   * Checks if a delivery key has already been seen, and records it.
   * Priority of keys:
   *   1. Case A: `provider + plaintextEventId` (best for both plaintext & encrypted webhooks)
   *   2. Case B: `provider + plaintextDigestHmac` (for encrypted webhooks without an event ID)
   *   3. Fallback: `provider + wireBodyHmac` (only valid for unencrypted payloads!)
   */
  checkAndRecordDuplicate(dedupKey: string): boolean {
    if (this.seenDeliveries.has(dedupKey)) {
      return true;
    }
    if (this.deliveryQueue.length >= this.maxCapacity) {
      const oldest = this.deliveryQueue.shift();
      if (oldest) this.seenDeliveries.delete(oldest);
    }
    this.seenDeliveries.add(dedupKey);
    this.deliveryQueue.push(dedupKey);
    return false;
  }

  /**
   * Checks if a webhook event arrived out-of-order relative to a newer event
   * for the same resource (`resourceId`), comparing the provider's creation timestamp
   * (`providerCreatedAtSec`) rather than host arrival time.
   */
  checkAndRecordOrdering(
    resourceId: string,
    providerCreatedAtSec: number
  ): { isOutOfOrder: boolean; lastSeenTimestampSec?: number } {
    const prev = this.latestResourceTimestamp.get(resourceId);
    if (prev !== undefined && providerCreatedAtSec < prev) {
      return { isOutOfOrder: true, lastSeenTimestampSec: prev };
    }
    if (prev === undefined || providerCreatedAtSec > prev) {
      if (this.latestResourceTimestamp.size >= this.maxCapacity) {
        const firstKey = this.latestResourceTimestamp.keys().next().value;
        if (firstKey !== undefined) this.latestResourceTimestamp.delete(firstKey);
      }
      this.latestResourceTimestamp.set(resourceId, providerCreatedAtSec);
    }
    return { isOutOfOrder: false, lastSeenTimestampSec: prev };
  }

  clear(): void {
    this.seenDeliveries.clear();
    this.deliveryQueue = [];
    this.latestResourceTimestamp.clear();
  }
}

/**
 * Helper to encrypt a payload with AES-256-GCM using a random 12-byte IV.
 */
export function encryptAes256Gcm(
  plaintext: string | Buffer,
  key32Bytes: Buffer
): { ivHex: string; ciphertextHex: string; authTagHex: string } {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key32Bytes, iv);
  const encrypted = Buffer.concat([
    cipher.update(typeof plaintext === 'string' ? Buffer.from(plaintext, 'utf8') : plaintext),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return {
    ivHex: iv.toString('hex'),
    ciphertextHex: encrypted.toString('hex'),
    authTagHex: authTag.toString('hex'),
  };
}

/**
 * Helper to decrypt an AES-256-GCM payload.
 */
export function decryptAes256Gcm(
  envelope: { ivHex: string; ciphertextHex: string; authTagHex: string },
  key32Bytes: Buffer
): string {
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    key32Bytes,
    Buffer.from(envelope.ivHex, 'hex')
  );
  decipher.setAuthTag(Buffer.from(envelope.authTagHex, 'hex'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertextHex, 'hex')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

