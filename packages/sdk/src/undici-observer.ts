import diagnostics_channel from 'node:diagnostics_channel';
import crypto from 'node:crypto';
import type { DownstreamSpan, Episode } from './types.js';
import { getCurrentEpisode } from './episode.js';
import { safeTry } from './safe.js';
import { classifySubHttpError } from './crypto-sketch.js';

/**
 * `diagnostics_channel` and `undici` Outbound Attribution
 *
 * Why this matters ("One Hop Deeper"):
 * Suppose a webhook arrives from Stripe. Your controller calls Stripe's REST API
 * (fetch('https://api.stripe.com/v1/charges')) using an expired API key, receives a
 * 401 Unauthorized, catches the error, logs a warning, and returns 200 OK.
 *
 * Without outbound attribution:
 *   - To an HTTP access log, POST /webhooks/stripe -> 200 OK looks 100% healthy!
 *   - Or if the controller doesn't catch the 401 and returns 500 Internal Server Error,
 *     it looks like a bug in your code rather than an upstream AUTH_FAILURE or RATE_LIMIT.
 *
 * How diagnostics_channel + AsyncLocalStorage work together:
 *   1. diagnostics_channel.subscribe('undici:request:create', ...) is a PROCESS-WIDE listener.
 *      It fires for EVERY fetch() / undici call across all concurrent requests.
 *   2. Because undici:request:create fires synchronously when fetch() is invoked,
 *      getCurrentEpisode() reads the active Episode from AsyncLocalStorage!
 *   3. We link the undici request object to { episode, span } inside a WeakMap
 *      (zero memory leaks), so when undici:request:headers, undici:request:trailers,
 *      or undici:request:error fires later, we update the exact DownstreamSpan.
 */

interface UndiciRequestLike {
  origin?: string;
  method?: string;
  path?: string;
}

interface UndiciResponseLike {
  statusCode?: number;
}

const inflightRequests = new WeakMap<
  object,
  { episode: Episode; span: DownstreamSpan }
>();

let undiciSubscribed = false;

export function ensureUndiciObserverSubscribed(): void {
  if (undiciSubscribed) return;
  undiciSubscribed = true;

  safeTry(() => {
    // 1. Outbound request created synchronously inside fetch() / undici.request()
    diagnostics_channel.subscribe('undici:request:create', (message: unknown) => {
      safeTry(() => {
        const episode = getCurrentEpisode();
        if (!episode || episode.sealed) return;

        const { request } = message as { request?: UndiciRequestLike & object };
        if (!request || typeof request !== 'object') return;

        const span: DownstreamSpan = {
          spanId: `span_${crypto.randomBytes(4).toString('hex')}`,
          method: String(request.method || 'GET'),
          origin: String(request.origin || 'unknown'),
          path: String(request.path || '/'),
          startedAtMs: Date.now(),
        };

        episode.downstreamCalls.push(span);
        inflightRequests.set(request, { episode, span });
      });
    });

    // 2. Response status and headers received from downstream server
    diagnostics_channel.subscribe('undici:request:headers', (message: unknown) => {
      safeTry(() => {
        const { request, response } = message as {
          request?: object;
          response?: UndiciResponseLike;
        };
        if (!request) return;
        const tracked = inflightRequests.get(request);
        if (!tracked) return;

        if (response && typeof response.statusCode === 'number') {
          tracked.span.statusCode = response.statusCode;
        }
        tracked.span.durationMs = Date.now() - tracked.span.startedAtMs;
      });
    });

    // 3. Request body & trailers completed
    diagnostics_channel.subscribe('undici:request:trailers', (message: unknown) => {
      safeTry(() => {
        const { request } = message as { request?: object };
        if (!request) return;
        const tracked = inflightRequests.get(request);
        if (!tracked) return;

        tracked.span.durationMs = Date.now() - tracked.span.startedAtMs;
      });
    });

    // 4. Sub-HTTP / Socket / DNS / TLS / Timeout Failure (undici:request:error)
    diagnostics_channel.subscribe('undici:request:error', (message: unknown) => {
      safeTry(() => {
        const { request, error } = message as {
          request?: object;
          error?: unknown;
        };
        if (!request) return;
        const tracked = inflightRequests.get(request);
        if (!tracked) return;

        tracked.span.durationMs = Date.now() - tracked.span.startedAtMs;
        const classified = classifySubHttpError(error);
        tracked.span.errorCode = classified.errorCode;
        tracked.span.errorMessage = classified.message;
        tracked.span.subHttpFailureType = classified.subType;
      });
    });
  });
}

