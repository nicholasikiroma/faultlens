import type { IncomingMessage } from 'node:http';
import type { Episode } from './types.js';
import { safeTry } from './safe.js';
import { StreamingHmac } from './crypto-sketch.js';

/**
 * Streams, Backpressure, and the Passive Body Tap
 *
 * THE STREAM TRAP (Why naive `req.on('data')` breaks host applications):
 * A Node.js `http.IncomingMessage` is a `Readable` stream that begins in paused mode
 * (`req.readableFlowing === null`).
 *
 * If an SDK middleware attaches `req.on('data', chunk => ...)` directly:
 *   1. Node immediately switches `req.readableFlowing = true` and starts draining the socket.
 *   2. If an async middleware or Guard awaits a Promise BEFORE the host's body parser
 *      (like `express.json()` or `raw-body`) attaches its own listener, the chunks are
 *      emitted into thin air and lost forever!
 *   3. The host's body parser either sees an empty body or hangs waiting for `'end'`.
 *
 * THE PASSIVE TAP SOLUTION:
 * Instead of adding a `'data'` listener that switches the stream into flowing mode,
 * we passively wrap `req.emit` (and inspect any pre-buffered chunks if the host rejects
 * early without reading).
 *   - `req.readableFlowing` remains `null` until the host itself starts reading.
 *   - Backpressure (`pause()` / `resume()` / `highWaterMark`) remains 100% controlled by the host.
 *   - We copy chunk bytes (`Buffer.from(chunk)`) up to `maxTapBytes` (64KB default) so a
 *     huge payload can never OOM the process, while feeding every chunk into `StreamingHmac`
 *     for a complete wire-body HMAC digest.
 */

const TAPPED_SYMBOL = Symbol.for('wiresleuth.stream_tapped');

export interface PassiveTapOptions {
  maxTapBytes?: number;
  digestKey?: string;
}

export function attachPassiveBodyTap(
  req: IncomingMessage,
  episode: Episode,
  options: PassiveTapOptions = {}
): { finalizeTap: () => void } {
  const maxTapBytes = options.maxTapBytes ?? 64 * 1024; // 64 KB cap
  const streamingHmac = new StreamingHmac(options.digestKey);
  const bufferedChunks: Buffer[] = [];
  let totalBytesSeen = 0;
  let tappedBytes = 0;
  let truncatedByCap = false;
  let finalized = false;

  const recordChunk = (chunk: unknown) => {
    safeTry(() => {
      if (finalized || !chunk) return;
      const buf = Buffer.isBuffer(chunk)
        ? chunk
        : typeof chunk === 'string'
          ? Buffer.from(chunk, 'utf8')
          : Buffer.from(chunk as Uint8Array);

      totalBytesSeen += buf.length;
      streamingHmac.update(buf);

      if (tappedBytes < maxTapBytes) {
        const remaining = maxTapBytes - tappedBytes;
        if (buf.length <= remaining) {
          bufferedChunks.push(Buffer.from(buf));
          tappedBytes += buf.length;
        } else {
          bufferedChunks.push(Buffer.from(buf.subarray(0, remaining)));
          tappedBytes += remaining;
          truncatedByCap = true;
        }
      } else {
        truncatedByCap = true;
      }
    });
  };

  const finalizeTap = () => {
    safeTry(() => {
      if (finalized) return;
      finalized = true;

      // If a Guard rejected the request before the host body-parser ever read the stream,
      // check if Node's HTTP parser already placed initial chunks into `_readableState.buffer`
      // so we can still extract event identity without disturbing the stream.
      if (totalBytesSeen === 0) {
        const readableState = (req as unknown as {
          _readableState?: { buffer?: { head?: { data: Buffer; next?: any } } | Buffer[] };
        })._readableState;
        const bufList = readableState?.buffer;
        if (Array.isArray(bufList)) {
          for (const item of bufList) recordChunk(item);
        } else if (bufList && typeof bufList === 'object' && 'head' in bufList) {
          let curr = bufList.head;
          while (curr) {
            recordChunk(curr.data);
            curr = curr.next;
          }
        }
      }

      episode.bodyTap.totalBytesSeen = totalBytesSeen;
      episode.bodyTap.tappedBytes = tappedBytes;
      episode.bodyTap.truncatedByCap = truncatedByCap;
      episode.bodyTap.wireBodyHmac =
        totalBytesSeen > 0 ? streamingHmac.digest() : '';

      if (bufferedChunks.length > 0) {
        episode.bodyTap.capturedBytes = Buffer.concat(bufferedChunks);
      }

      if (tappedBytes > 0 && !truncatedByCap) {
        const rawText = Buffer.concat(bufferedChunks).toString('utf8').trim();
        if (rawText.startsWith('{') && rawText.endsWith('}')) {
          safeTry(() => {
            const parsed = JSON.parse(rawText) as Record<string, unknown>;
            episode.bodyTap.previewJson = parsed;
            extractJsonIdentityIntoEpisode(parsed, episode);
          });
        }
      }
    });
  };

  safeTry(() => {
    const taggedReq = req as IncomingMessage & { [TAPPED_SYMBOL]?: boolean };
    if (taggedReq[TAPPED_SYMBOL]) return;
    taggedReq[TAPPED_SYMBOL] = true;

    const originalEmit = req.emit;
    req.emit = function passiveTappedEmit(
      this: IncomingMessage,
      event: string | symbol,
      ...args: any[]
    ): boolean {
      if (event === 'data') {
        recordChunk(args[0]);
      } else if (event === 'end') {
        finalizeTap();
      }
      return originalEmit.apply(this, [event, ...args]);
    };
  });

  return { finalizeTap };
}

/**
 * Helper for Web-Standard Request adapters (e.g., Hono `c.req.raw.clone()`)
 * or pre-buffered streams to populate `episode.bodyTap` and `episode.identity`
 * using the exact same byte cap and keyed HMAC rules.
 */
export function recordRawBodyBytes(
  rawBytes: Buffer | string,
  episode: Episode,
  options: PassiveTapOptions = {}
): void {
  safeTry(() => {
    const maxTapBytes = options.maxTapBytes ?? 64 * 1024;
    const buf =
      typeof rawBytes === 'string' ? Buffer.from(rawBytes, 'utf8') : rawBytes;
    const hmac = new StreamingHmac(options.digestKey);
    hmac.update(buf);

    episode.bodyTap.totalBytesSeen = buf.length;
    episode.bodyTap.tappedBytes = Math.min(buf.length, maxTapBytes);
    episode.bodyTap.truncatedByCap = buf.length > maxTapBytes;
    episode.bodyTap.wireBodyHmac = buf.length > 0 ? hmac.digest() : '';
    episode.bodyTap.capturedBytes = Buffer.from(buf.subarray(0, maxTapBytes));

    if (buf.length > 0 && buf.length <= maxTapBytes) {
      const text = buf.toString('utf8').trim();
      if (text.startsWith('{') && text.endsWith('}')) {
        safeTry(() => {
          const parsed = JSON.parse(text) as Record<string, unknown>;
          episode.bodyTap.previewJson = parsed;
          extractJsonIdentityIntoEpisode(parsed, episode);
        });
      }
    }
  });
}

/**
 * Automatically populates `episode.identity` from standard webhook JSON payload shapes
 * (e.g. Stripe `id`, `type`, `created`, `data.object.id`) if not already set by the host.
 */
export function extractJsonIdentityIntoEpisode(
  parsed: Record<string, unknown>,
  episode: Episode
): void {
  safeTry(() => {
    const rawId = parsed.event_id ?? parsed.id;
    if (!episode.identity.eventId && typeof rawId === 'string') {
      episode.identity.eventId = rawId;
      if (rawId.startsWith('evt_') && episode.identity.provider === 'unknown') {
        episode.identity.provider = 'stripe';
      }
    }
    const rawType = parsed.type ?? parsed.eventType;
    if (!episode.identity.eventType && typeof rawType === 'string') {
      episode.identity.eventType = rawType;
    }
    const rawCreated = parsed.created;
    if (
      episode.identity.providerCreatedAtSec === undefined &&
      typeof rawCreated === 'number'
    ) {
      episode.identity.providerCreatedAtSec = rawCreated;
    }
    // Extract resourceId from Stripe-style `data.object.id` or top-level `resourceId`
    if (!episode.identity.resourceId) {
      const dataObj = (parsed.data as Record<string, unknown> | undefined)?.object as
        | Record<string, unknown>
        | undefined;
      if (dataObj && typeof dataObj.id === 'string') {
        episode.identity.resourceId = dataObj.id;
      } else if (typeof parsed.resourceId === 'string') {
        episode.identity.resourceId = parsed.resourceId;
      }
    }
  });
}
