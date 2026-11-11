import type { DiagnosisDecision, Episode } from './types.js';

/**
 * Flight-Recorder Timeline Printer
 *
 * Formats a sealed `Episode` and its `DiagnosisDecision` into a readable
 * step-by-step trace showing how evidence from Socket, Stream, Framework,
 * Host Code, and Downstream `undici` channels converged into the root-cause diagnosis.
 */

export function formatEpisodeReport(
  episode: Episode,
  decision: DiagnosisDecision = episode.decision!
): string {
  const lines: string[] = [];
  const bar = '─'.repeat(78);

  lines.push(`┌${bar}┐`);
  lines.push(
    `│ FLIGHT RECORDER EPISODE: ${episode.episodeId.padEnd(18)} Framework: ${episode.framework.padEnd(20)}│`
  );
  lines.push(`├${bar}┤`);
  lines.push(
    `│ Ingress Route : ${episode.method} ${episode.rawUrl}${
      episode.routeTemplate ? `  (template: ${episode.routeTemplate})` : ''
    }`
  );
  lines.push(
    `│ Host HTTP Out : status=${episode.statusCode ?? 'NONE (Aborted)'} | finish=${
      episode.socket.finishFired
    } | close=${episode.socket.closeFired} (writableEnded=${
      episode.socket.writableEndedAtClose
    })`
  );
  lines.push(
    `│ Identity      : provider=${episode.identity.provider} | eventId=${
      episode.identity.eventId ?? 'n/a'
    } | type=${episode.identity.eventType ?? 'n/a'}`
  );
  lines.push(
    `│ Body Tap      : seen=${episode.bodyTap.totalBytesSeen}B (tapped=${
      episode.bodyTap.tappedBytes
    }B, capped=${episode.bodyTap.truncatedByCap}) | hmac=${
      episode.bodyTap.wireBodyHmac ? episode.bodyTap.wireBodyHmac.slice(0, 16) + '...' : 'n/a'
    }`
  );
  lines.push(
    `│ Verification  : state=${episode.verification.state}${
      episode.verification.signatureTimestampSec
        ? ` (t=${episode.verification.signatureTimestampSec})`
        : ''
    }`
  );

  if (episode.encryption.scheme !== 'NONE') {
    lines.push(
      `│ Encryption    : scheme=${episode.encryption.scheme} | decryptedOk=${
        episode.encryption.decryptedOk
      } | authSender=${episode.encryption.authenticatesSender}${
        episode.encryption.errorCode ? ` | err=${episode.encryption.errorCode}` : ''
      }`
    );
  }

  if (episode.downstreamCalls.length > 0) {
    lines.push(`├${bar}┤`);
    lines.push(`│ DOWNSTREAM CALLS (captured via diagnostics_channel + ALS):`);
    for (const span of episode.downstreamCalls) {
      const outcome = span.subHttpFailureType
        ? `ERR ${span.subHttpFailureType} (${span.errorCode})`
        : `HTTP ${span.statusCode ?? 'PENDING'}`;
      lines.push(
        `│   -> [${span.spanId}] ${span.method} ${span.origin}${span.path} => ${outcome} (${
          span.durationMs ?? 0
        }ms)`
      );
    }
  }

  if (episode.exceptions.length > 0) {
    lines.push(`├${bar}┤`);
    lines.push(`│ HOST EXCEPTIONS OBSERVED:`);
    for (const ex of episode.exceptions) {
      lines.push(
        `│   -> [${ex.layer}] ${ex.name}: ${ex.message} (escapedAfterRes=${ex.escapedAfterResponse})`
      );
    }
  }

  lines.push(`├${bar}┤`);
  lines.push(
    `│ TAIL-SAMPLING DECISION : shouldShip=${decision.shouldShip} | PrimaryClass=${decision.primaryClass}`
  );
  if (decision.secondaryClasses.length > 0) {
    lines.push(
      `│ Secondary Classes      : ${decision.secondaryClasses.join(', ')}`
    );
  }
  lines.push(`│ Root Cause Summary     : ${decision.rootCauseSummary}`);
  lines.push(
    `│ Auto-Replay Safe?      : ${decision.autoReplaySafe}${
      decision.replayGateReasons.length > 0
        ? ` (Blocked by: ${decision.replayGateReasons.join(', ')})`
        : ' (All safety gates passed)'
    }`
  );
  lines.push(`├${bar}┤`);
  lines.push(`│ EVIDENCE CHAIN:`);
  for (const step of decision.evidenceChain) {
    lines.push(`│   * ${step}`);
  }
  lines.push(`└${bar}┘`);

  return lines.join('\n');
}

