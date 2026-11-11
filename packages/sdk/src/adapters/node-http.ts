import type { IncomingMessage, ServerResponse } from 'node:http';
import { recordError, runInEpisode } from '../episode.js';
import type { FlightRecorder } from '../index.js';

/**
 * Framework Adapter: Raw `node:http` (`IncomingMessage` & `ServerResponse`)
 *
 * Integrates at the lowest Node.js HTTP layer:
 *   1. Opens the Episode and attaches the passive body tap (`req.emit` wrapper)
 *      and socket observer (`res.once('finish')` & `res.once('close')`).
 *   2. Runs the host listener inside `runInEpisode(episode, ...)`.
 *   3. Tracks handler settlement (`markHandlerSettled()`) so post-abort commits
 *      (`committedAfterAbort: true`) are accurately detected.
 */
export function withFlightRecorderNodeHttp(
  recorder: FlightRecorder,
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void> | void,
  options: { routeTemplate?: string } = {}
): (req: IncomingMessage, res: ServerResponse) => void {
  return (req: IncomingMessage, res: ServerResponse) => {
    const { episode, markHandlerSettled } = recorder.beginNodeEpisode(
      req,
      res,
      'node-http',
      () => options.routeTemplate ?? req.url?.split('?')[0]
    );

    runInEpisode(episode, () => {
      Promise.resolve()
        .then(() => handler(req, res))
        .catch((err: unknown) => {
          recordError(err, 'CONTROLLER');
          if (!res.headersSent && !res.writableEnded) {
            res.writeHead(500, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: 'Internal Server Error' }));
          }
        })
        .finally(() => {
          markHandlerSettled();
        });
    });
  };
}

