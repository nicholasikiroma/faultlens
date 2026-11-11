import type { IncomingMessage, ServerResponse } from 'node:http';
import { recordError, runInEpisode } from '../episode.js';
import { recordRawBodyBytes } from '../tap-stream.js';
import { safeTry } from '../safe.js';
import type { FlightRecorder } from '../index.js';

export interface HonoContextLike {
  req: {
    raw: Request;
    routePath?: string;
    path?: string;
    url?: string;
    method?: string;
  };
  env?: {
    incoming?: IncomingMessage;
    outgoing?: ServerResponse;
  };
  res?: {
    status?: number;
  };
  error?: unknown;
}

export type HonoNext = () => Promise<void>;
export type HonoMiddlewareHandler = (c: HonoContextLike, next: HonoNext) => Promise<Response | void>;

/**
 * Framework Adapter: Hono (`hono` + `@hono/node-server`)
 *
 * Key Hono Lifecycle Mechanics:
 *   1. `c.env.incoming` and `c.env.outgoing` provide the underlying Node.js
 *      `IncomingMessage` and `ServerResponse` sockets when running on Node.
 *   2. `c.req.routePath` provides the matched route pattern (e.g., `/webhooks/:provider`).
 *   3. Because Hono wraps the body in a Web Standard `Request` (`c.req.raw`),
 *      we clone the request (`c.req.raw.clone().arrayBuffer()`) in the background
 *      so the host's `await c.req.text()` / `c.req.json()` is never locked or disturbed!
 *   4. After `await next()`, Hono populates `c.error` if the controller threw an
 *      exception, and `c.res.status` with the final HTTP status code.
 */
export function flightRecorderHonoMiddleware(
  recorder: FlightRecorder
): HonoMiddlewareHandler {
  return async (c, next) => {
    const incoming = c.env?.incoming;
    const outgoing = c.env?.outgoing;

    const extractRoute = () => c.req.routePath ?? c.req.path ?? '/';

    if (incoming && outgoing) {
      const { episode, markHandlerSettled } = recorder.beginNodeEpisode(
        incoming,
        outgoing,
        'hono',
        extractRoute
      );

      // Also safely tap via Web Request `.clone()` in case `@hono/node-server`
      // uses Web ReadableStream readers instead of emitting Node 'data' events:
      await safeTry(async () => {
        const clonedBuf = Buffer.from(await c.req.raw.clone().arrayBuffer());
        if (clonedBuf.length > 0 && episode.bodyTap.totalBytesSeen === 0) {
          recordRawBodyBytes(clonedBuf, episode, {
            maxTapBytes: recorder.options.maxTapBytes,
            digestKey: recorder.options.digestKey,
          });
        }
      });

      return runInEpisode(episode, async () => {
        try {
          await next();
          if (c.error) {
            recordError(c.error, 'ERROR_FILTER');
          }
          if (c.res?.status) {
            episode.statusCode = c.res.status;
          }
          episode.routeTemplate = extractRoute();
        } finally {
          markHandlerSettled();
        }
      });
    }

    return next();
  };
}

