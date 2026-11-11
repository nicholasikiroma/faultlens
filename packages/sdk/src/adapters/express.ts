import type { IncomingMessage, ServerResponse } from 'node:http';
import { recordError, runInEpisode } from '../episode.js';
import type { FlightRecorder } from '../index.js';

export interface ExpressRequestLike extends IncomingMessage {
  baseUrl?: string;
  route?: { path?: string };
}

export interface ExpressResponseLike extends ServerResponse {}

export type ExpressNextFunction = (err?: unknown) => void;

export type ExpressMiddlewareHandler = (
  req: ExpressRequestLike,
  res: ExpressResponseLike,
  next: ExpressNextFunction
) => void;

export type ExpressErrorHandler = (
  err: unknown,
  req: ExpressRequestLike,
  res: ExpressResponseLike,
  next: ExpressNextFunction
) => void;

/**
 * Framework Adapter: Express (`express`)
 *
 * Key Express Lifecycle Mechanics:
 *   1. Must mount BEFORE `express.json()` / `express.raw()` so `attachPassiveBodyTap`
 *      hooks `req.emit` before the body parser drains the stream.
 *   2. `req.route` is `undefined` when `app.use()` middleware first runs! Express only
 *      populates `req.route.path` AFTER the router matches a specific route.
 *      Therefore, we read `(req.baseUrl || '') + req.route.path` lazily at SEAL time!
 *   3. Error observation middleware calls `recordError(err)` and passes `next(err)`
 *      unchanged so the host's error response is never altered.
 */
export function flightRecorderExpressMiddleware(
  recorder: FlightRecorder
): ExpressMiddlewareHandler {
  return (req, res, next) => {
    const { episode, markHandlerSettled } = recorder.beginNodeEpisode(
      req,
      res,
      'express',
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
  };
}

export function flightRecorderExpressErrorObserver(): ExpressErrorHandler {
  return (err, _req, _res, next) => {
    recordError(err, 'ERROR_FILTER');
    next(err);
  };
}

