// @ts-check
import http from 'node:http';
import { hasScenario, runScenario } from './scenarios.js';
import { startTracing } from './tracing.js';

const tracing = startTracing('sender');
const cfg = loadConfig();

process.on('SIGTERM', () => {
  tracing.shutdown().finally(() => process.exit(0));
});

const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => {
    console.error(err);
    if (!res.headersSent) sendJson(res, 500, { outcome: 'error' });
  });
});

server.listen(cfg.port, '0.0.0.0');

/**
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 */
async function handle(req, res) {
  const path = (req.url ?? '').split('?')[0];
  if (req.method === 'GET' && path === '/healthz') {
    res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
    return;
  }
  if (req.method === 'POST' && path.startsWith('/scenarios/')) {
    const name = path.slice('/scenarios/'.length);
    if (!hasScenario(name)) {
      sendJson(res, 404, { error: 'not_found' });
      return;
    }
    const report = await runScenario(name, cfg);
    sendJson(res, 200, report);
    return;
  }
  res.writeHead(404).end();
}

/**
 * @returns {{ port: number, receiverUrl: string, sendTimeoutMs: number, faultDelayMs: number }}
 */
function loadConfig() {
  const port = positiveInt('PORT');
  const receiverUrl = required('RECEIVER_URL');
  const faultDelayMs = positiveInt('FAULT_DELAY_MS');
  const sendTimeoutMs = positiveInt('SEND_TIMEOUT_MS');
  const pgConnectTimeoutMs = positiveInt('PG_CONNECT_TIMEOUT_MS');
  if (!(faultDelayMs > sendTimeoutMs && sendTimeoutMs > pgConnectTimeoutMs)) {
    throw new Error('FAULT_DELAY_MS > SEND_TIMEOUT_MS > PG_CONNECT_TIMEOUT_MS is required');
  }
  return { port, receiverUrl, sendTimeoutMs, faultDelayMs };
}

/**
 * @param {string} name
 * @returns {string}
 */
function required(name) {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`missing ${name}`);
  return value;
}

/**
 * @param {string} name
 * @returns {number}
 */
function positiveInt(name) {
  const raw = required(name);
  if (!/^[1-9]\d*$/.test(raw)) throw new Error(`${name} must be a positive integer`);
  const n = Number(raw);
  if (!Number.isSafeInteger(n)) throw new Error(`${name} must be a positive integer`);
  return n;
}

/**
 * @param {http.ServerResponse} res
 * @param {number} status
 * @param {unknown} body
 */
function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
}
