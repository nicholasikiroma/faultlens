// @ts-check

/**
 * @typedef {{ kind: 'response', status: number, outcome: string | null }} ResponseObservation
 * @typedef {{ kind: 'timeout' }} TimeoutObservation
 * @typedef {{ kind: 'unreachable', code: string }} UnreachableObservation
 * @typedef {ResponseObservation | TimeoutObservation | UnreachableObservation} Observation
 * @typedef {{ n: number, elapsedMs: number, observed: Observation }} Attempt
 * @typedef {{
 *   index: number,
 *   eventId: string | null,
 *   payloadSha256: string,
 *   verdict: 'acked' | 'rejected' | 'gave-up',
 *   traceId: string,
 *   attempts: Attempt[],
 * }} Send
 * @typedef {'stored' | 'duplicate' | 'conflict' | 'invalid'} RowOutcome
 * @typedef {{
 *   id: number,
 *   eventId: string | null,
 *   senderAttempt: number | null,
 *   payloadSha256: string,
 *   outcome: RowOutcome,
 *   receivedAtMs: number,
 *   recordedAtMs: number,
 * }} AttemptRow
 * @typedef {{ sends: Send[], rows: AttemptRow[] }} Evidence
 * @typedef {{ kind: 'row', row: AttemptRow } | { kind: 'none' } | { kind: 'ambiguous', rowIds: number[] }} RowLink
 * @typedef {{ send: Send, attempt: Attempt, link: RowLink }} Touch
 * @typedef {{ touches: Touch[], orphanRows: AttemptRow[] }} Joined
 * @typedef {{ send: number, attempt: number }} At
 * @typedef {{ kind: 'before-give-up', rowId: number, outcome: 'stored' | 'duplicate', inFlightMs: number }
 *   | { kind: 'after-give-up', rowId: number, outcome: 'stored' | 'duplicate', inFlightMs: number }
 *   | { kind: 'not-recorded' }
 *   | { kind: 'ambiguous', rowIds: number[] }} Commit
 * @typedef {{ kind: 'acked', at: At, status: number, outcome: string | null, rowId: number | null }
 *   | { kind: 'rejected', at: At, status: number }
 *   | { kind: 'gave-up', attempts: number }} Resolution
 * @typedef {{
 *   pattern: 'timeout',
 *   at: At,
 *   elapsedMs: number,
 *   commit: Commit,
 *   resolution: Resolution,
 *   traceId: string,
 * }} TimeoutFinding
 * @typedef {{
 *   pattern: 'validation-error',
 *   at: At,
 *   status: 400,
 *   rowId: number,
 *   payloadSha256: string,
 * }} ValidationFinding
 * @typedef {{
 *   pattern: 'duplicate-delivery',
 *   eventId: string,
 *   payloadSha256: string,
 *   winner: { at: At, rowId: number },
 *   repeats: Array<{ at: At, rowId: number }>,
 *   overlap: boolean,
 * }} DuplicateFinding
 * @typedef {TimeoutFinding | ValidationFinding | DuplicateFinding} Finding
 * @typedef {{ kind: 'attempt', at: At, observed: Observation, link: RowLink }
 *   | { kind: 'orphan', row: AttemptRow }} Unexplained
 * @typedef {{
 *   sendCount: number,
 *   rowCount: number,
 *   traceIds: string[],
 *   findings: Finding[],
 *   unexplained: Unexplained[],
 * }} Report
 */

/**
 * @param {Evidence} evidence
 * @returns {Report}
 */
export function diagnose(evidence) {
  for (const row of evidence.rows) assertRow(row);
  const joined = join(evidence.sends, evidence.rows);
  const findings = [
    ...timeoutFindings(joined),
    ...validationFindings(joined),
    ...duplicateFindings(joined),
  ].sort(compareFindings);
  return {
    sendCount: evidence.sends.length,
    rowCount: evidence.rows.length,
    traceIds: traceIdsOf(evidence.sends),
    findings,
    unexplained: listUnexplained(joined, findings),
  };
}

/**
 * @param {Report} report
 * @returns {string}
 */
export function renderReport(report) {
  /** @type {string[]} */
  const lines = [renderHeader(report)];
  if (report.findings.length === 0 && report.unexplained.length === 0) {
    lines.push('Delivered cleanly.');
  } else if (report.findings.length === 0) {
    lines.push('No known pattern.');
  }
  for (const finding of report.findings) lines.push(renderFinding(finding));
  if (report.unexplained.length === 0) lines.push('Unexplained: none');
  else lines.push(...report.unexplained.map(renderUnexplained));
  return `${lines.join('\n')}\n`;
}

/**
 * @param {AttemptRow} row
 */
function assertRow(row) {
  switch (row.outcome) {
    case 'stored':
    case 'duplicate':
    case 'conflict':
      if (typeof row.eventId !== 'string') throw new Error(`row ${row.id} ${row.outcome} has no event`);
      return;
    case 'invalid':
      if (row.eventId !== null) throw new Error(`row ${row.id} invalid has event ${row.eventId}`);
      return;
    default: {
      /** @type {never} */
      const unreachable = row.outcome;
      throw new Error(`unknown outcome ${JSON.stringify(unreachable)}`);
    }
  }
}

/**
 * @param {Send[]} sends
 * @param {AttemptRow[]} rows
 * @returns {Joined}
 */
function join(sends, rows) {
  /** @type {Array<{ send: Send, attempt: Attempt }>} */
  const ordered = [];
  for (const send of sends) {
    for (const attempt of send.attempts) ordered.push({ send, attempt });
  }
  const named = ordered.filter((item) => namesRowOutcome(item.attempt.observed));
  const rest = ordered.filter((item) => !namesRowOutcome(item.attempt.observed));
  /** @type {Set<number>} */
  const taken = new Set();
  /** @type {Map<string, RowLink>} */
  const links = new Map();
  // Pass 1 claims attempts that name a row outcome so a timeout cannot take a row a 201 or 200 already owns.
  for (const item of [...named, ...rest]) {
    const candidates = rows.filter((row) => !taken.has(row.id) && isCandidate(item.send, item.attempt, row));
    const key = attemptKey({ send: item.send.index, attempt: item.attempt.n });
    if (candidates.length === 0) {
      links.set(key, { kind: 'none' });
    } else if (candidates.length === 1) {
      const row = candidates[0];
      taken.add(row.id);
      links.set(key, { kind: 'row', row });
    } else {
      links.set(key, {
        kind: 'ambiguous',
        rowIds: candidates.map((row) => row.id).sort((left, right) => left - right),
      });
    }
  }
  const touches = ordered.map((item) => {
    const link = links.get(attemptKey({ send: item.send.index, attempt: item.attempt.n }));
    if (link === undefined) throw new Error(`missing link for send ${item.send.index} attempt ${item.attempt.n}`);
    return { send: item.send, attempt: item.attempt, link };
  });
  return { touches, orphanRows: rows.filter((row) => !taken.has(row.id)) };
}

/**
 * @param {Observation} observed
 * @returns {boolean}
 */
function namesRowOutcome(observed) {
  switch (observed.kind) {
    case 'response':
      return observed.outcome === 'stored'
        || observed.outcome === 'duplicate'
        || observed.outcome === 'conflict'
        || observed.outcome === 'invalid';
    case 'timeout':
    case 'unreachable':
      return false;
    default: {
      /** @type {never} */
      const unreachable = observed;
      throw new Error(`unhandled observation ${JSON.stringify(unreachable)}`);
    }
  }
}

/**
 * @param {Send} send
 * @param {Attempt} attempt
 * @param {AttemptRow} row
 * @returns {boolean}
 */
function isCandidate(send, attempt, row) {
  if (row.senderAttempt !== attempt.n) return false;
  if (row.payloadSha256 !== send.payloadSha256) return false;
  if (!sameEvent(send.eventId, row)) return false;
  if (!namesRowOutcome(attempt.observed)) return true;
  return attempt.observed.kind === 'response' && attempt.observed.outcome === row.outcome;
}

/**
 * @param {string | null} eventId
 * @param {AttemptRow} row
 * @returns {boolean}
 */
function sameEvent(eventId, row) {
  if (eventId === null) return row.eventId === null;
  return row.eventId === eventId;
}

/**
 * @param {Joined} joined
 * @returns {TimeoutFinding[]}
 */
function timeoutFindings(joined) {
  /** @type {TimeoutFinding[]} */
  const findings = [];
  for (const touch of joined.touches) {
    if (touch.attempt.observed.kind !== 'timeout') continue;
    findings.push({
      pattern: 'timeout',
      at: atOf(touch),
      elapsedMs: touch.attempt.elapsedMs,
      commit: commitForTimeout(touch),
      resolution: resolutionFor(touch.send, joined),
      traceId: touch.send.traceId,
    });
  }
  return findings;
}

/**
 * @param {Touch} touch
 * @returns {Commit}
 */
function commitForTimeout(touch) {
  switch (touch.link.kind) {
    case 'none':
      return { kind: 'not-recorded' };
    case 'ambiguous':
      return { kind: 'ambiguous', rowIds: touch.link.rowIds };
    case 'row': {
      const outcome = touch.link.row.outcome;
      if (outcome !== 'stored' && outcome !== 'duplicate') {
        throw new Error(`timeout row ${touch.link.row.id} outcome ${outcome}`);
      }
      const inFlightMs = touch.link.row.recordedAtMs - touch.link.row.receivedAtMs;
      // Compare durations. Subtracting the sender clock from the database clock would mix two clocks.
      const kind = inFlightMs < touch.attempt.elapsedMs ? 'before-give-up' : 'after-give-up';
      return { kind, rowId: touch.link.row.id, outcome, inFlightMs };
    }
    default: {
      /** @type {never} */
      const unreachable = touch.link;
      throw new Error(`unhandled link ${JSON.stringify(unreachable)}`);
    }
  }
}

/**
 * @param {Send} send
 * @param {Joined} joined
 * @returns {Resolution}
 */
function resolutionFor(send, joined) {
  const last = send.attempts[send.attempts.length - 1];
  if (last === undefined) throw new Error(`send ${send.index} has no attempts`);
  switch (send.verdict) {
    case 'acked': {
      if (last.observed.kind !== 'response') throw new Error(`send ${send.index} acked without a response`);
      const touch = touchFor(joined, send.index, last.n);
      return {
        kind: 'acked',
        at: { send: send.index, attempt: last.n },
        status: last.observed.status,
        outcome: last.observed.outcome,
        rowId: touch.link.kind === 'row' ? touch.link.row.id : null,
      };
    }
    case 'rejected': {
      if (last.observed.kind !== 'response') throw new Error(`send ${send.index} rejected without a response`);
      return {
        kind: 'rejected',
        at: { send: send.index, attempt: last.n },
        status: last.observed.status,
      };
    }
    case 'gave-up':
      return { kind: 'gave-up', attempts: send.attempts.length };
    default: {
      /** @type {never} */
      const unreachable = send.verdict;
      throw new Error(`unhandled verdict ${JSON.stringify(unreachable)}`);
    }
  }
}

/**
 * @param {Joined} joined
 * @returns {ValidationFinding[]}
 */
function validationFindings(joined) {
  /** @type {ValidationFinding[]} */
  const findings = [];
  for (const touch of joined.touches) {
    const observed = touch.attempt.observed;
    if (observed.kind !== 'response' || observed.status !== 400 || observed.outcome !== 'invalid') continue;
    if (touch.link.kind !== 'row' || touch.link.row.outcome !== 'invalid') continue;
    findings.push({
      pattern: 'validation-error',
      at: atOf(touch),
      status: 400,
      rowId: touch.link.row.id,
      payloadSha256: touch.send.payloadSha256,
    });
  }
  return findings;
}

/**
 * @param {Joined} joined
 * @returns {DuplicateFinding[]}
 */
function duplicateFindings(joined) {
  /** @type {Map<string, Touch[]>} */
  const groups = new Map();
  for (const touch of joined.touches) {
    if (touch.link.kind !== 'row') continue;
    const row = touch.link.row;
    if ((row.outcome !== 'stored' && row.outcome !== 'duplicate') || row.eventId === null) continue;
    const key = `${row.eventId}\0${row.payloadSha256}`;
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [touch]);
    else group.push(touch);
  }
  /** @type {DuplicateFinding[]} */
  const findings = [];
  for (const group of groups.values()) {
    const sendIndexes = new Set(group.map((touch) => touch.send.index));
    if (sendIndexes.size < 2) continue;
    const winners = group.filter((touch) => touch.link.kind === 'row' && touch.link.row.outcome === 'stored');
    if (winners.length !== 1) continue;
    const winner = winners[0];
    if (winner.link.kind !== 'row' || winner.link.row.eventId === null) continue;
    const winnerRow = winner.link.row;
    /** @type {Array<{ at: At, rowId: number, receivedAtMs: number }>} */
    const repeats = [];
    for (const touch of group) {
      if (touch.link.kind !== 'row' || touch.link.row.outcome !== 'duplicate') continue;
      if (touch.send.index === winner.send.index) continue;
      repeats.push({ at: atOf(touch), rowId: touch.link.row.id, receivedAtMs: touch.link.row.receivedAtMs });
    }
    if (repeats.length === 0) continue;
    repeats.sort((left, right) => compareAt(left.at, right.at));
    findings.push({
      pattern: 'duplicate-delivery',
      eventId: winnerRow.eventId,
      payloadSha256: winnerRow.payloadSha256,
      winner: { at: atOf(winner), rowId: winnerRow.id },
      repeats: repeats.map((repeat) => ({ at: repeat.at, rowId: repeat.rowId })),
      overlap: repeats.some((repeat) => repeat.receivedAtMs < winnerRow.recordedAtMs),
    });
  }
  return findings;
}

/**
 * @param {Joined} joined
 * @param {Finding[]} findings
 * @returns {Unexplained[]}
 */
function listUnexplained(joined, findings) {
  const attempts = citedAttemptKeys(findings, joined);
  const rows = citedRowIds(findings, joined);
  /** @type {Unexplained[]} */
  const items = [];
  for (const touch of joined.touches) {
    if (isClean(touch)) continue;
    if (attempts.has(attemptKey(atOf(touch)))) continue;
    items.push({
      kind: 'attempt',
      at: atOf(touch),
      observed: touch.attempt.observed,
      link: touch.link,
    });
  }
  for (const row of joined.orphanRows) {
    if (rows.has(row.id)) continue;
    items.push({ kind: 'orphan', row });
  }
  items.sort(compareUnexplained);
  return items;
}

/**
 * @param {Touch} touch
 * @returns {boolean}
 */
function isClean(touch) {
  const observed = touch.attempt.observed;
  return observed.kind === 'response'
    && observed.status >= 200
    && observed.status < 300
    && observed.outcome === 'stored'
    && touch.link.kind === 'row'
    && touch.link.row.outcome === 'stored';
}

/**
 * @param {Finding[]} findings
 * @param {Joined} joined
 * @returns {Set<string>}
 */
function citedAttemptKeys(findings, joined) {
  /** @type {Set<string>} */
  const keys = new Set();
  for (const finding of findings) {
    switch (finding.pattern) {
      case 'timeout':
        keys.add(attemptKey(finding.at));
        for (const touch of joined.touches) {
          if (touch.send.index === finding.at.send && touch.attempt.n > finding.at.attempt) {
            keys.add(attemptKey(atOf(touch)));
          }
        }
        break;
      case 'validation-error':
        keys.add(attemptKey(finding.at));
        break;
      case 'duplicate-delivery':
        keys.add(attemptKey(finding.winner.at));
        for (const repeat of finding.repeats) keys.add(attemptKey(repeat.at));
        break;
      default: {
        /** @type {never} */
        const unreachable = finding;
        throw new Error(`unhandled finding ${JSON.stringify(unreachable)}`);
      }
    }
  }
  return keys;
}

/**
 * @param {Finding[]} findings
 * @param {Joined} joined
 * @returns {Set<number>}
 */
function citedRowIds(findings, joined) {
  /** @type {Set<number>} */
  const ids = new Set();
  for (const finding of findings) {
    switch (finding.pattern) {
      case 'timeout':
        citeTouch(ids, touchFor(joined, finding.at.send, finding.at.attempt));
        for (const touch of joined.touches) {
          if (touch.send.index === finding.at.send && touch.attempt.n > finding.at.attempt) citeTouch(ids, touch);
        }
        break;
      case 'validation-error':
        ids.add(finding.rowId);
        break;
      case 'duplicate-delivery':
        ids.add(finding.winner.rowId);
        for (const repeat of finding.repeats) ids.add(repeat.rowId);
        break;
      default: {
        /** @type {never} */
        const unreachable = finding;
        throw new Error(`unhandled finding ${JSON.stringify(unreachable)}`);
      }
    }
  }
  return ids;
}

/**
 * @param {Set<number>} ids
 * @param {Touch} touch
 */
function citeTouch(ids, touch) {
  switch (touch.link.kind) {
    case 'row':
      ids.add(touch.link.row.id);
      return;
    case 'none':
      return;
    case 'ambiguous':
      for (const id of touch.link.rowIds) ids.add(id);
      return;
    default: {
      /** @type {never} */
      const unreachable = touch.link;
      throw new Error(`unhandled link ${JSON.stringify(unreachable)}`);
    }
  }
}

/**
 * @param {Send[]} sends
 * @returns {string[]}
 */
function traceIdsOf(sends) {
  /** @type {string[]} */
  const ids = [];
  const seen = new Set();
  for (const send of sends) {
    if (seen.has(send.traceId)) continue;
    seen.add(send.traceId);
    ids.push(send.traceId);
  }
  return ids;
}

/**
 * @param {Finding} finding
 * @returns {At}
 */
function firstAt(finding) {
  switch (finding.pattern) {
    case 'timeout':
    case 'validation-error':
      return finding.at;
    case 'duplicate-delivery': {
      const points = [finding.winner.at, ...finding.repeats.map((repeat) => repeat.at)];
      points.sort(compareAt);
      const first = points[0];
      if (first === undefined) throw new Error('duplicate finding cites no attempt');
      return first;
    }
    default: {
      /** @type {never} */
      const unreachable = finding;
      throw new Error(`unhandled finding ${JSON.stringify(unreachable)}`);
    }
  }
}

/**
 * @param {Finding} left
 * @param {Finding} right
 * @returns {number}
 */
function compareFindings(left, right) {
  const byAt = compareAt(firstAt(left), firstAt(right));
  if (byAt !== 0) return byAt;
  if (left.pattern < right.pattern) return -1;
  if (left.pattern > right.pattern) return 1;
  return 0;
}

/**
 * @param {At} left
 * @param {At} right
 * @returns {number}
 */
function compareAt(left, right) {
  if (left.send !== right.send) return left.send - right.send;
  return left.attempt - right.attempt;
}

/**
 * @param {Unexplained} left
 * @param {Unexplained} right
 * @returns {number}
 */
function compareUnexplained(left, right) {
  const a = unexplainedRank(left);
  const b = unexplainedRank(right);
  if (a.group !== b.group) return a.group - b.group;
  if (a.send !== b.send) return a.send - b.send;
  if (a.attempt !== b.attempt) return a.attempt - b.attempt;
  return a.rowId - b.rowId;
}

/**
 * @param {Unexplained} item
 * @returns {{ group: number, send: number, attempt: number, rowId: number }}
 */
function unexplainedRank(item) {
  switch (item.kind) {
    case 'attempt':
      return { group: 0, send: item.at.send, attempt: item.at.attempt, rowId: linkRowId(item.link) };
    case 'orphan':
      return { group: 1, send: 0, attempt: 0, rowId: item.row.id };
    default: {
      /** @type {never} */
      const unreachable = item;
      throw new Error(`unhandled unexplained ${JSON.stringify(unreachable)}`);
    }
  }
}

/**
 * @param {RowLink} link
 * @returns {number}
 */
function linkRowId(link) {
  switch (link.kind) {
    case 'row':
      return link.row.id;
    case 'none':
      return 0;
    case 'ambiguous':
      return link.rowIds[0] ?? 0;
    default: {
      /** @type {never} */
      const unreachable = link;
      throw new Error(`unhandled link ${JSON.stringify(unreachable)}`);
    }
  }
}

/**
 * @param {Joined} joined
 * @param {number} send
 * @param {number} attempt
 * @returns {Touch}
 */
function touchFor(joined, send, attempt) {
  const touch = joined.touches.find((item) => item.send.index === send && item.attempt.n === attempt);
  if (touch === undefined) throw new Error(`missing touch for send ${send} attempt ${attempt}`);
  return touch;
}

/**
 * @param {Touch} touch
 * @returns {At}
 */
function atOf(touch) {
  return { send: touch.send.index, attempt: touch.attempt.n };
}

/**
 * @param {At} at
 * @returns {string}
 */
function attemptKey(at) {
  return `${at.send}:${at.attempt}`;
}

/**
 * @param {Report} report
 * @returns {string}
 */
function renderHeader(report) {
  const traces = report.traceIds.length === 0 ? 'none' : report.traceIds.join(', ');
  return `Sends ${report.sendCount}. Rows ${report.rowCount}. Traces ${traces}.`;
}

/**
 * @param {Finding} finding
 * @returns {string}
 */
function renderFinding(finding) {
  switch (finding.pattern) {
    case 'timeout':
      return [
        `Send ${finding.at.send} attempt ${finding.at.attempt} timed out after ${finding.elapsedMs} ms on trace ${finding.traceId}.`,
        renderCommit(finding.commit),
        renderResolution(finding.resolution),
      ].join('\n');
    case 'validation-error':
      return [
        `Send ${finding.at.send} attempt ${finding.at.attempt} returned status ${finding.status} outcome invalid for row ${finding.rowId} hash ${finding.payloadSha256}.`,
        'Reasons are not recorded.',
      ].join('\n');
    case 'duplicate-delivery':
      return renderDuplicate(finding);
    default: {
      /** @type {never} */
      const unreachable = finding;
      throw new Error(`unhandled finding ${JSON.stringify(unreachable)}`);
    }
  }
}

/**
 * @param {Commit} commit
 * @returns {string}
 */
function renderCommit(commit) {
  switch (commit.kind) {
    case 'before-give-up':
      return `Row ${commit.rowId} outcome ${commit.outcome} was in flight for ${commit.inFlightMs} ms and was recorded before the sender gave up.`;
    case 'after-give-up':
      return `Row ${commit.rowId} outcome ${commit.outcome} was in flight for ${commit.inFlightMs} ms and was recorded after the sender gave up.`;
    case 'not-recorded':
      return 'No row was linked.';
    case 'ambiguous':
      return `Rows ${commit.rowIds.join(', ')} are ambiguous.`;
    default: {
      /** @type {never} */
      const unreachable = commit;
      throw new Error(`unhandled commit ${JSON.stringify(unreachable)}`);
    }
  }
}

/**
 * @param {Resolution} resolution
 * @returns {string}
 */
function renderResolution(resolution) {
  switch (resolution.kind) {
    case 'acked': {
      const outcome = resolution.outcome === null ? 'none' : resolution.outcome;
      const row = resolution.rowId === null ? 'no row' : `row ${resolution.rowId}`;
      return `Send ${resolution.at.send} attempt ${resolution.at.attempt} returned status ${resolution.status} outcome ${outcome} and linked ${row}.`;
    }
    case 'rejected':
      return `Send ${resolution.at.send} attempt ${resolution.at.attempt} returned status ${resolution.status}.`;
    case 'gave-up':
      return `The send gave up after ${resolution.attempts} attempts.`;
    default: {
      /** @type {never} */
      const unreachable = resolution;
      throw new Error(`unhandled resolution ${JSON.stringify(unreachable)}`);
    }
  }
}

/**
 * @param {DuplicateFinding} finding
 * @returns {string}
 */
function renderDuplicate(finding) {
  /** @type {string[]} */
  const lines = [
    `Event ${finding.eventId} hash ${finding.payloadSha256} was delivered more than once.`,
    `Winner send ${finding.winner.at.send} attempt ${finding.winner.at.attempt} row ${finding.winner.rowId}.`,
  ];
  for (const repeat of finding.repeats) {
    lines.push(`Repeat send ${repeat.at.send} attempt ${repeat.at.attempt} row ${repeat.rowId}.`);
  }
  lines.push(finding.overlap
    ? 'A repeat arrived before the winner was recorded.'
    : 'No repeat arrived before the winner was recorded.');
  return lines.join('\n');
}

/**
 * @param {Unexplained} item
 * @returns {string}
 */
function renderUnexplained(item) {
  switch (item.kind) {
    case 'attempt':
      return `Send ${item.at.send} attempt ${item.at.attempt} ${renderObserved(item.observed)} and ${renderLink(item.link)}.`;
    case 'orphan':
      return `Row ${item.row.id} outcome ${item.row.outcome} has no send.`;
    default: {
      /** @type {never} */
      const unreachable = item;
      throw new Error(`unhandled unexplained ${JSON.stringify(unreachable)}`);
    }
  }
}

/**
 * @param {Observation} observed
 * @returns {string}
 */
function renderObserved(observed) {
  switch (observed.kind) {
    case 'response': {
      const outcome = observed.outcome === null ? 'none' : observed.outcome;
      return `saw status ${observed.status} outcome ${outcome}`;
    }
    case 'timeout':
      return 'saw a timeout';
    case 'unreachable':
      return `saw unreachable ${observed.code}`;
    default: {
      /** @type {never} */
      const unreachable = observed;
      throw new Error(`unhandled observation ${JSON.stringify(unreachable)}`);
    }
  }
}

/**
 * @param {RowLink} link
 * @returns {string}
 */
function renderLink(link) {
  switch (link.kind) {
    case 'row':
      return `linked row ${link.row.id}`;
    case 'none':
      return 'linked no row';
    case 'ambiguous':
      return `linked rows ${link.rowIds.join(', ')}`;
    default: {
      /** @type {never} */
      const unreachable = link;
      throw new Error(`unhandled link ${JSON.stringify(unreachable)}`);
    }
  }
}
