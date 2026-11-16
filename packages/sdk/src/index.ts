import type { IncomingMessage, ServerResponse } from 'node:http';
import crypto from 'node:crypto';
import { INGEST_SIGNATURE_HEADER, MAX_INGEST_BODY_BYTES } from '#domain';
import type {
  DiagnosisDecision,
  Episode,
  FlightRecorderOptions,
} from './types.js';
import {
  bindToEpisode,
  createEpisode,
  ensureProcessMonitorsInstalled,
  getCurrentEpisode,
  recordEncryption,
  recordError,
  recordIdempotency,
  recordIdentity,
  recordVerification,
  runInEpisode,
} from './episode.js';
import {
  attachPassiveBodyTap,
  extractJsonIdentityIntoEpisode,
  recordRawBodyBytes,
} from './tap-stream.js';
import { ensureUndiciObserverSubscribed } from './undici-observer.js';
import { attachSocketObserver } from './socket-observer.js';
import {
  classifySubHttpError,
  computeHmacSha256,
  decryptAes256Gcm,
  DeliveryHistorySketch,
  encryptAes256Gcm,
  isKnownDecryptError,
  StreamingHmac,
} from './crypto-sketch.js';
import { decide } from './decide.js';
import { formatEpisodeReport } from './printer.js';
import { safeTry, sanitizeHeaders } from './safe.js';
import {
  createTransport,
  type DeliveryResult,
  type Transport,
  type TransportOptions,
} from './transport.js';
import {
  createWebhookCapture,
  type WebhookCapture,
  type WebhookOptions,
} from './webhooks.js';
import {
  withFlightRecorderNodeHttp,
  flightRecorderExpressMiddleware,
  flightRecorderExpressErrorObserver,
  registerFlightRecorderFastify,
  flightRecorderHonoMiddleware,
  createFlightRecorderNestMiddleware,
  createFlightRecorderRxjsInterceptor,
  type ExpressMiddlewareHandler,
  type ExpressErrorHandler,
  type FastifyInstanceLike,
  type HonoMiddlewareHandler,
} from './adapters/index.js';

export * from './types.js';
export * from './adapters/index.js';
export {
  createEpisode,
  runInEpisode,
  bindToEpisode,
  getCurrentEpisode,
  recordVerification,
  recordIdentity,
  recordEncryption,
  recordIdempotency,
  recordError,
  ensureProcessMonitorsInstalled,
  attachPassiveBodyTap,
  recordRawBodyBytes,
  extractJsonIdentityIntoEpisode,
  ensureUndiciObserverSubscribed,
  attachSocketObserver,
  DeliveryHistorySketch,
  computeHmacSha256,
  StreamingHmac,
  isKnownDecryptError,
  classifySubHttpError,
  encryptAes256Gcm,
  decryptAes256Gcm,
  decide,
  formatEpisodeReport,
  safeTry,
  sanitizeHeaders,
  createTransport,
  createWebhookCapture,
};
export type { Transport, TransportOptions, DeliveryResult, WebhookCapture, WebhookOptions };

export interface FaultLensClientOptions extends Partial<TransportOptions>, FlightRecorderOptions {
  /** Opt into webhook observations / signing */
  webhooks?: WebhookOptions;
  /** Integration signing secret for webhook ingestion */
  signingSecret?: string;
}

export interface FaultLensMiddlewareBundle {
  nodeHttp: (
    handler: (req: IncomingMessage, res: ServerResponse) => Promise<void> | void,
    options?: { routeTemplate?: string }
  ) => (req: IncomingMessage, res: ServerResponse) => void;
  express: () => ExpressMiddlewareHandler;
  expressError: () => ExpressErrorHandler;
  fastify: (fastify: FastifyInstanceLike) => void;
  hono: () => HonoMiddlewareHandler;
  nestMiddleware: () => ReturnType<typeof createFlightRecorderNestMiddleware>;
  nestInterceptor: (rxjs?: any) => ReturnType<typeof createFlightRecorderRxjsInterceptor>;
}

/**
 * High-level FlightRecorder Coordinator ("Deep Module" Facade).
 *
 * Manages the process-wide `undici` subscription, bounded deduplication/ordering
 * sketch, framework middleware adapters, and episode sealing lifecycle.
 */
export class FlightRecorder {
  public readonly sketch: DeliveryHistorySketch;
  public readonly shippedEpisodes: Episode[] = [];
  public readonly allObservedEpisodes: Episode[] = [];
  public readonly transport?: Transport;
  public readonly signingSecret?: string;
  public readonly webhooks?: WebhookCapture;
  public readonly middleware: FaultLensMiddlewareBundle;

  constructor(public readonly options: FaultLensClientOptions = {}) {
    this.sketch = new DeliveryHistorySketch();
    ensureUndiciObserverSubscribed();
    ensureProcessMonitorsInstalled();

    if (options.baseUrl !== undefined || options.apiKey !== undefined) {
      this.transport = createTransport({
        baseUrl: options.baseUrl ?? '',
        apiKey: options.apiKey ?? '',
        timeoutMs: options.timeoutMs,
        maxInFlight: options.maxInFlight,
      });
    }

    this.signingSecret = options.webhooks?.signingSecret ?? options.signingSecret;

    if (options.webhooks !== undefined) {
      if (!this.transport) {
        throw new Error('baseUrl and apiKey are required when enabling webhooks');
      }
      this.webhooks = createWebhookCapture(this.transport, options.webhooks);
    }

    const self = this;
    this.middleware = Object.freeze({
      nodeHttp(
        handler: (req: IncomingMessage, res: ServerResponse) => Promise<void> | void,
        opts?: { routeTemplate?: string }
      ) {
        return withFlightRecorderNodeHttp(self, handler, opts);
      },
      express() {
        return flightRecorderExpressMiddleware(self);
      },
      expressError() {
        return flightRecorderExpressErrorObserver();
      },
      fastify(fastifyInstance: FastifyInstanceLike) {
        registerFlightRecorderFastify(fastifyInstance, self);
      },
      hono() {
        return flightRecorderHonoMiddleware(self);
      },
      nestMiddleware() {
        return createFlightRecorderNestMiddleware(self);
      },
      nestInterceptor(rxjs?: any) {
        return createFlightRecorderRxjsInterceptor(rxjs);
      },
    });
  }

  /**
   * Opens and instruments an Episode for a standard Node `IncomingMessage` / `ServerResponse`.
   */
  public beginNodeEpisode(
    req: IncomingMessage,
    res: ServerResponse,
    framework: Episode['framework'],
    resolveRouteTemplate?: () => string | undefined
  ): {
    episode: Episode;
    markHandlerSettled: () => void;
    sealNow: () => void;
  } {
    const episode = createEpisode({
      framework,
      method: req.method || 'POST',
      rawUrl: req.url || '/',
      headers: req.headers,
    });

    const { finalizeTap } = attachPassiveBodyTap(req, episode, {
      maxTapBytes: this.options.maxTapBytes,
      digestKey: this.options.digestKey,
    });

    let sealedOnce = false;
    const sealNow = () => {
      safeTry(() => {
        if (sealedOnce) return;
        sealedOnce = true;
        finalizeTap();
        if (resolveRouteTemplate && !episode.routeTemplate) {
          episode.routeTemplate = safeTry(resolveRouteTemplate);
        }
        this.finalizeAndExport(episode);
      });
    };

    const { markHandlerSettled } = attachSocketObserver(req, res, episode, () => {
      // When `close` fires (or when the handler settles after an abort):
      // - If `writableEnded` is true (normal completion) OR `handlerSettled` is true,
      //   seal on next tick so any trailing hook or microtask finishes first.
      // - Otherwise (`writableEnded` is false and handler is still running!), wait a
      //   grace window so we can observe whether the in-flight handler commits
      //   after the abort (`committedAfterAbort = true`)!
      if (res.writableEnded || episode.socket.handlerSettled) {
        setImmediate(sealNow);
      } else {
        const abortGraceTimer = setTimeout(sealNow, 130);
        abortGraceTimer.unref();
      }
    });

    const wrappedMarkHandlerSettled = () => {
      markHandlerSettled();
      if (episode.socket.closeFired) {
        setImmediate(sealNow);
      }
    };

    return {
      episode,
      markHandlerSettled: wrappedMarkHandlerSettled,
      sealNow,
    };
  }

  public finalizeAndExport(episode: Episode): DiagnosisDecision {
    const decision =
      safeTry(() =>
        decide(episode, {
          sketch: this.sketch,
          signatureToleranceSec: this.options.signatureToleranceSec,
        })
      ) ?? {
        shouldShip: false,
        primaryClass: 'HEALTHY',
        secondaryClasses: [],
        rootCauseSummary: 'Fallback healthy decision',
        autoReplaySafe: false,
        replayGateReasons: [],
        evidenceChain: [],
      };

    safeTry(() => {
      this.allObservedEpisodes.push(episode);
      if (decision.shouldShip) {
        this.shippedEpisodes.push(episode);
      }

      // Non-blocking shipping to FaultLens backend if transport and signingSecret are available
      if (decision.shouldShip && this.transport && this.signingSecret) {
        const captured = episode.bodyTap.capturedBytes;
        const rawBody: Buffer = captured && captured.length > 0
          ? captured
          : Buffer.from(JSON.stringify({
              event_id: episode.identity.eventId || episode.episodeId,
              type: episode.identity.eventType || "flight_recorder.episode",
            }));

        if (rawBody.byteLength <= MAX_INGEST_BODY_BYTES) {
          const signature = crypto
            .createHmac('sha256', this.signingSecret)
            .update(rawBody)
            .digest('hex');

          const episodeMeta = Buffer.from(
            JSON.stringify({
              episodeId: episode.episodeId,
              primaryClass: decision.primaryClass,
              secondaryClasses: decision.secondaryClasses,
              rootCauseSummary: decision.rootCauseSummary,
              timeoutAttribution: decision.timeoutAttribution,
              autoReplaySafe: decision.autoReplaySafe,
              replayGateReasons: decision.replayGateReasons,
              statusCode: episode.statusCode,
              framework: episode.framework,
              downstreamCalls: episode.downstreamCalls,
              exceptions: episode.exceptions,
              wireBodyHmac: episode.bodyTap.wireBodyHmac,
            })
          ).toString('base64');

          void this.transport.deliver(() => ({
            path: '/v1/ingest',
            body: new Uint8Array(rawBody),
            headers: {
              'content-type': 'application/json',
              [INGEST_SIGNATURE_HEADER]: signature,
              'x-faultlens-episode': episodeMeta,
            },
          }));
        }
      }

      if (
        this.options.onEpisodeSealed &&
        (decision.shouldShip || this.options.observeAllInHook)
      ) {
        this.options.onEpisodeSealed(episode, decision);
      }
    });

    return decision;
  }
}

export type FaultLensClient = FlightRecorder;

export function createFaultLensClient(
  options: FaultLensClientOptions & { webhooks: WebhookOptions }
): FaultLensClient & { readonly webhooks: WebhookCapture };
export function createFaultLensClient(options: FaultLensClientOptions): FaultLensClient;
export function createFaultLensClient(options: FaultLensClientOptions): FaultLensClient {
  return new FlightRecorder(options);
}
