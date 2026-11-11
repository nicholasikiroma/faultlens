import type { IncomingMessage, ServerResponse } from 'node:http';
import { getCurrentEpisode, recordError, runInEpisode } from '../episode.js';
import type { FlightRecorder } from '../index.js';

export interface NestRequestLike extends IncomingMessage {
  baseUrl?: string;
  route?: { path?: string };
}

export interface NestResponseLike extends ServerResponse {}

/**
 * Framework Adapter: NestJS (`@nestjs/common`, `@nestjs/core`, `rxjs`)
 *
 * Middleware + Interceptor factory with zero-overhead typing:
 *   - Level 0 (Middleware): Opens Episode, attaches Passive Stream Tap & Socket Observer, enters ALS.
 *   - Level 1 (Guards): Host Signature Guard calls `recordVerification(...)` inside Episode.
 *   - Level 2 (Interceptors): Records controller exceptions via `recordError(err, 'INTERCEPTOR')`
 *     and observes handler settlement after socket aborts.
 */
export function createFlightRecorderNestMiddleware(recorder: FlightRecorder) {
  return class FlightRecorderNestMiddleware {
    use(req: NestRequestLike, res: NestResponseLike, next: (err?: unknown) => void): void {
      const { episode, markHandlerSettled } = recorder.beginNodeEpisode(
        req,
        res,
        'nestjs',
        () => {
          if (req.route && typeof req.route.path === 'string') {
            return `${req.baseUrl || ''}${req.route.path}`;
          }
          return undefined;
        }
      );

      res.once('finish', () => {
        markHandlerSettled();
      });

      runInEpisode(episode, () => {
        next();
      });
    }
  };
}

export function createFlightRecorderRxjsInterceptor(rxjs?: {
  throwError?: (fn: () => unknown) => any;
  catchError?: (fn: (err: unknown) => any) => any;
  finalize?: (fn: () => void) => any;
}) {
  return class FlightRecorderRxjsInterceptor {
    intercept(context: any, next: any): any {
      const httpCtx = context?.switchToHttp?.();
      const req = httpCtx?.getRequest?.() as NestRequestLike | undefined;
      const ep = getCurrentEpisode();

      if (ep && req?.route?.path) {
        ep.routeTemplate = `${req.baseUrl || ''}${req.route.path}`;
      }

      const stream = next?.handle?.();
      if (!stream || typeof stream.pipe !== 'function') {
        return stream;
      }

      if (rxjs?.catchError && rxjs?.finalize && rxjs?.throwError) {
        return stream.pipe(
          rxjs.catchError((err: unknown) => {
            recordError(err, 'INTERCEPTOR');
            return rxjs.throwError!(() => err);
          }),
          rxjs.finalize(() => {
            if (ep) {
              ep.socket.handlerSettled = true;
              ep.socket.handlerSettledAtMs = Date.now();
              if (ep.socket.closeFired && !ep.socket.writableEndedAtClose) {
                ep.socket.committedAfterAbort = true;
              }
            }
          })
        );
      }

      return stream;
    }
  };
}

