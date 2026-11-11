import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Episode } from './types.js';
import { safeTry } from './safe.js';

/**
 * ServerResponse close and finish, Post-Abort Settlement, and CPU vs Network Attribution
 *
 * Why close and finish both matter:
 *   - A webhook sender (like Stripe or GitHub) never sends a second packet saying "I timed out."
 *   - Instead, when its timeout expires, it simply closes the TCP connection.
 *   - On your Node.js server:
 *       * Normal delivery: res.end() completes -> 'finish' fires (writableEnded = true)
 *         -> 'close' fires (writableEnded = true).
 *       * Aborted/Timed-out delivery: 'finish' NEVER fires! 'close' fires with
 *         res.writableEnded === false. res.headersSent tells you whether a status code
 *         was ever flushed before the hangup.
 *
 * Why committedAfterAbort is a critical replay hazard:
 *   - Closing the socket does NOT cancel a running JavaScript Promise in your controller!
 *   - If the sender disconnects at t=100ms (close with writableEnded: false), your controller
 *     often finishes its database insert at t=250ms (handlerSettled = true, committedAfterAbort = true).
 *   - If an engineer blindly clicks "Replay Webhook", the side effect executes a second time!
 */

export interface SocketObserverController {
  /** Called by framework adapter when the handler promise/callback chain finishes */
  markHandlerSettled: () => void;
}

export function attachSocketObserver(
  _req: IncomingMessage,
  res: ServerResponse,
  episode: Episode,
  onReadyToSeal: () => void
): SocketObserverController {
  const startCpu = process.cpuUsage();
  let lastTick = performance.now();
  let maxLagMs = 0;

  // Lightweight event-loop lag probe while the request is in-flight
  const lagTimer = setInterval(() => {
    const now = performance.now();
    const expected = 15;
    const lag = Math.max(0, now - lastTick - expected);
    if (lag > maxLagMs) maxLagMs = lag;
    lastTick = now;
  }, 15);
  lagTimer.unref();

  const recordCpuAndStopTimer = () => {
    safeTry(() => {
      clearInterval(lagTimer);
      const finalDelta = Math.max(0, performance.now() - lastTick - 15);
      if (finalDelta > maxLagMs) maxLagMs = finalDelta;

      const cpuDiff = process.cpuUsage(startCpu);
      const totalCpuMs = (cpuDiff.user + cpuDiff.system) / 1000;
      episode.socket.activeCpuBlockMs = Math.round(totalCpuMs);
      episode.socket.eventLoopMaxLagMs = Math.round(maxLagMs);
    });
  };

  safeTry(() => {
    res.once('finish', () => {
      safeTry(() => {
        episode.socket.finishFired = true;
        episode.socket.finishAtMs = Date.now();
        episode.statusCode = res.statusCode;
      });
    });

    res.once('close', () => {
      safeTry(() => {
        recordCpuAndStopTimer();
        episode.socket.closeFired = true;
        episode.socket.closeAtMs = Date.now();
        episode.socket.writableEndedAtClose = Boolean(res.writableEnded);
        episode.socket.headersSentAtClose = Boolean(res.headersSent);
        if (res.headersSent || res.writableEnded) {
          episode.statusCode = res.statusCode;
        }
        onReadyToSeal();
      });
    });

    // If the sender aborts early (close fires with writableEnded: false),
    // Node will NOT emit 'finish' when the slow handler eventually calls res.end().
    // Observing res.end passively lets us detect the exact moment the handler finishes
    // after an abort (HANDLER_SETTLED + committedAfterAbort = true) in all frameworks!
    const origEnd = res.end;
    res.end = function passiveObservedEnd(this: ServerResponse, ...args: any[]): ServerResponse {
      const result = origEnd.apply(this, args as any);
      safeTry(() => {
        if (episode.socket.closeFired && !episode.socket.writableEndedAtClose) {
          markHandlerSettled();
        }
      });
      return result;
    } as typeof res.end;
  });

  const markHandlerSettled = () => {
    safeTry(() => {
      recordCpuAndStopTimer();
      episode.socket.handlerSettled = true;
      episode.socket.handlerSettledAtMs = Date.now();

      // If close already fired with writableEnded: false, the client hung up BEFORE
      // the handler finished executing!
      if (episode.socket.closeFired && !episode.socket.writableEndedAtClose) {
        episode.socket.committedAfterAbort = true;
        onReadyToSeal();
      }
    });
  };

  return { markHandlerSettled };
}

