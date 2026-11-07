// Rerun from unreliable-systems while the stack is up:
// node probe.mjs
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { renderReport } from "./diagnose/diagnose.js";
import { investigate } from "./diagnose/lab.js";

const exec = promisify(execFile);
const root = fileURLToPath(new URL(".", import.meta.url));

/** @type {string[]} */
const failures = [];

function assert(ok, message) {
  if (!ok) failures.push(message);
  console.log(`${ok ? "PASS" : "FAIL"} ${message}`);
}

async function examine(report) {
  const investigation = await investigate(report);
  process.stdout.write(renderReport(investigation));
  return investigation;
}

async function compose(...args) {
  const { stdout } = await exec("docker", ["compose", ...args], {
    cwd: root,
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout;
}

async function reset() {
  await compose(
    "exec",
    "-T",
    "postgres",
    "psql",
    "-U",
    "lab",
    "-d",
    "lab",
    "-c",
    "TRUNCATE events, delivery_attempts RESTART IDENTITY",
  );
}

async function rows() {
  const stdout = await compose(
    "exec",
    "-T",
    "postgres",
    "psql",
    "-U",
    "lab",
    "-d",
    "lab",
    "-A",
    "-F",
    ",",
    "-t",
    "-c",
    "SELECT a.sender_attempt, a.outcome, a.event_id IS NULL, a.payload_sha256, COALESCE(e.payload_sha256, '') FROM delivery_attempts a LEFT JOIN events e ON e.event_id = a.event_id ORDER BY a.recorded_at, a.id",
  );
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map((line) => {
      const [senderAttempt, outcome, eventMissing, attemptHash, eventHash] = line.split(",");
      return {
        senderAttempt: senderAttempt === "" ? null : Number(senderAttempt),
        outcome,
        eventMissing: eventMissing === "t",
        attemptHash,
        eventHash,
      };
    });
}

async function clockRows() {
  const stdout = await compose(
    "exec",
    "-T",
    "postgres",
    "psql",
    "-U",
    "lab",
    "-d",
    "lab",
    "-A",
    "-F",
    ",",
    "-t",
    "-c",
    "SELECT (floor(extract(epoch from e.occurred_at) * 1000))::bigint, (floor(extract(epoch from a.received_at) * 1000))::bigint FROM events e JOIN delivery_attempts a ON a.event_id = e.event_id AND a.outcome = 'stored' ORDER BY a.received_at, a.id",
  );
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map((line) => {
      const [occurredAt, receivedAt] = line.split(",");
      return { occurredAt: Number(occurredAt), receivedAt: Number(receivedAt) };
    });
}

async function postScenario(name) {
  const res = await fetch(`http://localhost:3001/scenarios/${name}`, { method: "POST" });
  const report = await res.json();
  return { status: res.status, report };
}

async function logEvents(traceId) {
  if (typeof traceId !== "string" || traceId === "") return [];
  const stdout = await compose("logs", "--no-color", "sender", "receiver");
  /** @type {Array<Record<string, unknown>>} */
  const events = [];
  for (const line of stdout.split(/\r?\n/)) {
    const start = line.indexOf("{");
    if (start < 0) continue;
    try {
      const value = JSON.parse(line.slice(start));
      if (value.trace_id === traceId && typeof value.msg === "string") events.push(value);
    } catch {
      // Span dumps are not JSON lines.
    }
  }
  return events;
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

await reset();
{
  const { status, report } = await postScenario("happy");
  const attempt = report.sends?.[0]?.attempts?.[0];
  const stored = await rows();
  assert(status === 200 && report.sends?.[0]?.verdict === "acked", "happy verdict acked");
  assert(attempt?.observed?.status === 201 && attempt?.observed?.outcome === "stored", "happy attempt 201 stored");
  assert(stored.length === 1 && stored[0].outcome === "stored", "happy one stored row");
  assert(stored[0]?.attemptHash === report.sends?.[0]?.payloadSha256, "happy hashes match");
  const investigation = await examine(report);
  assert(investigation.findings.length === 0, "happy has no findings");
}

await reset();
{
  const { report } = await postScenario("duplicate");
  const stored = await rows();
  const second = report.sends?.[1]?.attempts?.[0]?.observed;
  assert(report.sends?.[0]?.verdict === "acked" && report.sends?.[1]?.verdict === "acked", "duplicate both acked");
  assert(second?.status === 200 && second?.outcome === "duplicate", "duplicate second is 200");
  assert(stored.length === 2 && stored[0].outcome === "stored" && stored[1].outcome === "duplicate", "duplicate one event two attempts");
  assert(stored[0].attemptHash === stored[1].attemptHash && stored[0].eventHash === stored[0].attemptHash, "duplicate hashes stay equal");
  const investigation = await examine(report);
  assert(
    investigation.findings.map((finding) => finding.pattern).join(",") === "duplicate-delivery",
    "duplicate pattern duplicate-delivery",
  );
}

await reset();
{
  const { report } = await postScenario("conflict");
  const stored = await rows();
  const second = report.sends?.[1]?.attempts?.[0]?.observed;
  assert(report.sends?.[1]?.verdict === "rejected", "conflict sender stops");
  assert(second?.status === 409 && second?.outcome === "conflict", "conflict is 409");
  assert(stored.length === 2 && stored[0].outcome === "stored" && stored[1].outcome === "conflict", "conflict keeps the first event");
  assert(stored[0].eventHash === stored[0].attemptHash && stored[1].attemptHash !== stored[0].eventHash, "conflict hash differs and the stored body stays");
  const investigation = await examine(report);
  assert(
    investigation.findings.length === 0 && investigation.unexplained.length > 0,
    "conflict has no findings and an unexplained attempt",
  );
}

await reset();
for (const name of ["invalid-json", "invalid-shape"]) {
  const { report } = await postScenario(name);
  const stored = await rows();
  const observed = report.sends?.[0]?.attempts?.[0]?.observed;
  assert(report.sends?.[0]?.verdict === "rejected" && observed?.status === 400, `${name} is 400`);
  assert(stored.length === 1 && stored[0].outcome === "invalid" && stored[0].eventMissing, `${name} writes an attempt and no event`);
  const investigation = await examine(report);
  assert(
    investigation.findings.map((finding) => finding.pattern).join(",") === "validation-error",
    `${name} pattern validation-error`,
  );
  await reset();
}

await reset();
{
  const { report } = await postScenario("timeout-before-commit");
  const attempts = report.sends?.[0]?.attempts ?? [];
  const stored = await rows();
  assert(attempts[0]?.observed?.kind === "timeout", "timeout-before first attempt is timeout");
  assert(attempts[1]?.observed?.status === 201, "timeout-before retry stores");
  assert(
    stored.length === 2 && stored[0].senderAttempt === 2 && stored[0].outcome === "stored" && stored[1].senderAttempt === 1 && stored[1].outcome === "duplicate",
    "timeout-before commits the retry first",
  );
  const investigation = await examine(report);
  const timeout = investigation.findings.find((finding) => finding.pattern === "timeout");
  assert(
    investigation.findings.map((finding) => finding.pattern).join(",") === "timeout" && timeout?.commit.kind === "after-give-up",
    "timeout-before-commit pattern timeout after-give-up",
  );
}

await reset();
{
  const { report } = await postScenario("timeout-after-commit");
  const attempts = report.sends?.[0]?.attempts ?? [];
  const stored = await rows();
  assert(attempts[0]?.observed?.kind === "timeout", "timeout-after first attempt is timeout");
  assert(attempts[1]?.observed?.status === 200 && attempts[1]?.observed?.outcome === "duplicate", "timeout-after retry is a duplicate");
  assert(
    stored.length === 2 && stored[0].senderAttempt === 1 && stored[0].outcome === "stored" && stored[1].senderAttempt === 2 && stored[1].outcome === "duplicate",
    "timeout-after committed before the sender gave up",
  );
  const traceId = report.sends?.[0]?.traceId;
  const events = await logEvents(traceId);
  const senderTimeout = events.find((event) => event.service === "sender" && event.observation === "timeout");
  const senderRetry = events.find((event) => event.service === "sender" && event.outcome === "duplicate");
  const receiverStored = events.find((event) => event.service === "receiver" && event.outcome === "stored");
  const receiverDuplicate = events.find((event) => event.service === "receiver" && event.outcome === "duplicate");
  assert(
    typeof traceId === "string" && senderTimeout && senderRetry && receiverStored && receiverDuplicate,
    "timeout-after one trace id on the timeout, the retry, the stored row, and the duplicate",
  );
  const investigation = await examine(report);
  const timeout = investigation.findings.find((finding) => finding.pattern === "timeout");
  assert(
    investigation.findings.map((finding) => finding.pattern).join(",") === "timeout" && timeout?.commit.kind === "before-give-up",
    "timeout-after-commit pattern timeout before-give-up",
  );
}

await reset();
{
  const { report } = await postScenario("clock-skew");
  const clocks = await clockRows();
  assert(report.sends?.[0]?.verdict === "acked", "clock-skew still stores the event");
  assert(clocks.length === 1 && clocks[0].occurredAt > clocks[0].receivedAt + 30 * 60 * 1000, "clock-skew keeps the sender timestamp an hour ahead of arrival");
}

await reset();
{
  const { report } = await postScenario("out-of-order");
  const clocks = await clockRows();
  assert(report.sends?.length === 2 && report.sends.every((send) => send.verdict === "acked"), "out-of-order stores both events");
  assert(clocks.length === 2 && clocks[0].occurredAt > clocks[1].occurredAt, "arrival order and occurred_at order disagree");
}

await reset();
{
  const { report } = await postScenario("delayed-delivery");
  const clocks = await clockRows();
  assert(report.sends?.[0]?.verdict === "acked", "delayed-delivery eventually stores");
  assert(clocks.length === 1 && clocks[0].receivedAt > clocks[0].occurredAt + 2000, "delayed-delivery arrives seconds after it claims to have happened");
}

await reset();
{
  const { report } = await postScenario("parallel-duplicate");
  const stored = await rows();
  const outcomes = stored.map((row) => row.outcome).sort();
  assert(report.sends?.length === 2 && report.sends.every((send) => send.verdict === "acked"), "parallel-duplicate both calls are acked");
  assert(outcomes.length === 2 && outcomes[0] === "duplicate" && outcomes[1] === "stored", "parallel-duplicate one winner and one duplicate");
  assert(stored[0].attemptHash === stored[1].attemptHash, "parallel-duplicate is the same bytes");
  const investigation = await examine(report);
  assert(
    investigation.findings.map((finding) => finding.pattern).join(",") === "duplicate-delivery",
    "parallel-duplicate pattern duplicate-delivery",
  );
}

await reset();
{
  const before = (await rows()).length;
  const res = await fetch("http://localhost:3002/webhooks", {
    method: "POST",
    headers: { "content-type": "application/json", "x-lab-fault": "nope" },
    body: "{}",
  });
  const body = await res.json();
  assert(res.status === 400 && body.reasons?.includes("unknown_fault"), "unknown fault is 400");
  assert((await rows()).length === before, "unknown fault writes no row");
}

await reset();
{
  await compose("stop", "receiver");
  const pending = fetch("http://localhost:3001/scenarios/happy", { method: "POST" });
  await sleep(8000);
  await compose("start", "receiver");
  const res = await pending;
  const report = await res.json();
  const kinds = (report.sends?.[0]?.attempts ?? []).map((attempt) => attempt.observed.kind);
  assert(kinds.includes("timeout"), "receiver down hangs until the sender deadline");
  assert(report.sends?.[0]?.verdict === "acked", "receiver down recovers when the process starts");
}

await reset();
{
  await compose("stop", "postgres");
  const res = await fetch("http://localhost:3002/webhooks", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "nope",
  });
  const body = await res.json();
  const ps = await compose("ps", "--format", "{{.Service}} {{.State}}");
  assert(res.status === 503 && body.outcome === "unavailable", "postgres down is 503");
  assert(ps.includes("receiver running"), "postgres down leaves the receiver up");
  await compose("start", "postgres");
  await compose("up", "-d", "--wait", "--wait-timeout", "60");
  const { report } = await postScenario("happy");
  const stored = await rows();
  assert(report.sends?.[0]?.verdict === "acked" && stored.some((row) => row.outcome === "stored"), "postgres recovery stores the next event");
}

await reset();

if (failures.length > 0) {
  console.log(`probe failed ${failures.length}`);
  process.exit(1);
}
console.log("probe ok");
