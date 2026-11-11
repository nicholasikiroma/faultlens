import type { IncomingMessage, ServerResponse } from 'node:http';
import { recordError, runInEpisode } from '../episode.js';
import type { Episode } from '../types.js';
import type { FlightRecorder } from '../index.js';

export interface FastifyRequestLike {
  raw: IncomingMessage;
  url: string;
  routeOptions?: { url?: string };
}

export interface FastifyReplyLike {
  raw: ServerResponse;
}

export interface FastifyInstanceLike {
  addHook(hook: 'onRequest', fn: (req: FastifyRequestLike, reply: FastifyReplyLike, done: (err?: unknown) => void) => void): void;
  addHook(hook: 'preParsing', fn: (req: FastifyRequestLike, reply: FastifyReplyLike, payload: unknown, done: (err: unknown, payload?: unknown) => void) => void): void;
  addHook(hook: 'onError', fn: (req: FastifyRequestLike, reply: FastifyReplyLike, error: unknown, done: () => void) => void): void;
  addHook(hook: 'onResponse', fn: (req: FastifyRequestLike, reply: FastifyReplyLike, done: () => void) => void): void;
}

const EPISODE_SYM = Symbol('wiresleuth.fastify_episode');

/**
 * Framework Adapter: Fastify (`fastify`)
 *
 * Fastify Hook Runner Mechanics:
 *   1. `onRequest(request, reply, done)`:
 *      Fastify's hook runner is callback-driven (`done()`). To ensure the Episode's
 *      `AsyncLocalStorage` context propagates into subsequent hooks and route handler,
 *      we MUST invoke `runInEpisode(episode, done)`!
 *   2. `preParsing(request, reply, payload, done)`:
 *      Runs before Fastify's body parser reads the stream. We pass `payload`
 *      through `done(null, payload)` untouched.
 *   3. `onError(request, reply, error, done)`:
 *      Records the error into the episode and calls `done()`.
 */
export function registerFlightRecorderFastify(
  fastify: FastifyInstanceLike,
  recorder: FlightRecorder
): void {
  fastify.addHook('onRequest', (request, reply, done) => {
    const { episode, markHandlerSettled } = recorder.beginNodeEpisode(
      request.raw,
      reply.raw,
      'fastify',
      () => request.routeOptions?.url ?? request.url
    );

    (request as unknown as Record<symbol, unknown>)[EPISODE_SYM] = {
      episode,
      markHandlerSettled,
    };

    runInEpisode(episode, done);
  });

  fastify.addHook('preParsing', (request, _reply, payload, done) => {
    const ctx = (request as unknown as Record<symbol, { episode: Episode } | undefined>)[
      EPISODE_SYM
    ];
    if (!ctx) {
      done(null, payload);
      return;
    }
    runInEpisode(ctx.episode, () => {
      done(null, payload);
    });
  });

  fastify.addHook('onError', (_request, _reply, error, done) => {
    recordError(error, 'ERROR_FILTER');
    done();
  });

  fastify.addHook('onResponse', (request, _reply, done) => {
    const ctx = (
      request as unknown as Record<
        symbol,
        { markHandlerSettled: () => void } | undefined
      >
    )[EPISODE_SYM];
    ctx?.markHandlerSettled();
    done();
  });
}

