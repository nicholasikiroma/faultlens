import crypto from "node:crypto";

export interface TrafficGeneratorOptions {
  targetUrl?: string;
  intervalMs?: number;
  signingSecret?: string;
}

export function startTrafficGenerator(options: TrafficGeneratorOptions = {}) {
  const targetUrl = options.targetUrl ?? "http://127.0.0.1:3002";
  const intervalMs = options.intervalMs ?? Number(process.env["COMMERCE_TRAFFIC_INTERVAL_MS"] ?? "3000");
  const signingSecret = options.signingSecret ?? "seed-signing-secret-orders";

  let tick = 0;
  let active = true;
  let timer: NodeJS.Timeout | null = null;
  let duplicatePayloadCache: any = null;

  const ANSI = {
    reset: "\x1b[0m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    red: "\x1b[31m",
    cyan: "\x1b[36m",
    dim: "\x1b[2m",
    bold: "\x1b[1m",
  };

  const dispatchEvent = async () => {
    if (!active) return;
    tick++;

    // Scenarios mix: Rotate 2 healthy events, then 1 realistic failure incident
    const isIncidentTick = tick % 3 === 0;
    const incidentType = Math.floor(tick / 3) % 4; // 0: timeout, 1: ratelimit, 2: invalid_sig, 3: duplicate

    let path = "/webhooks/orders";
    let scenario = "ok";
    let isBadSignature = false;
    let label = `${ANSI.green}[OK: HEALTHY]${ANSI.reset}`;
    let eventId = `evt_ord_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

    if (isIncidentTick) {
      if (incidentType === 0) {
        scenario = "timeout";
        label = `${ANSI.red}${ANSI.bold}[INCIDENT: DOWNSTREAM_TIMEOUT]${ANSI.reset}`;
      } else if (incidentType === 1) {
        path = "/webhooks/payments";
        scenario = "ratelimit";
        label = `${ANSI.yellow}${ANSI.bold}[INCIDENT: RATE_LIMIT_429]${ANSI.reset}`;
      } else if (incidentType === 2) {
        isBadSignature = true;
        label = `${ANSI.red}${ANSI.bold}[INCIDENT: INVALID_SIGNATURE]${ANSI.reset}`;
      } else if (incidentType === 3) {
        label = `${ANSI.yellow}${ANSI.bold}[INCIDENT: DUPLICATE_DELIVERY]${ANSI.reset}`;
        if (duplicatePayloadCache) {
          eventId = duplicatePayloadCache.event_id;
        }
      }
    }

    const payload = {
      event_id: eventId,
      type: path === "/webhooks/orders" ? "order.created" : "payment.captured",
      order_id: `ord_${10000 + (tick % 500)}`,
      amount_cents: 4999 + (tick * 10),
      currency: "usd",
      scenario,
      customer: {
        id: `cus_sim_${tick}`,
        email: `buyer_${tick}@acmecorp.dev`,
      },
      created_at: Math.floor(Date.now() / 1000),
    };

    if (scenario === "ok" && !duplicatePayloadCache) {
      duplicatePayloadCache = payload;
    } else if (isIncidentTick && incidentType === 3) {
      duplicatePayloadCache = null; // Clear after sending duplicate
    }

    const bodyString = JSON.stringify(payload);
    const validSignature = crypto
      .createHmac("sha256", signingSecret)
      .update(bodyString)
      .digest("hex");

    const signature = isBadSignature ? "invalid_tampered_sig" : validSignature;

    try {
      const startTime = Date.now();
      const res = await fetch(`${targetUrl}${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-order-signature": signature,
          "x-faultlens-generator": "commerce-sim-v1",
        },
        body: bodyString,
      });

      const durationMs = Date.now() - startTime;
      const statusColor = res.ok ? ANSI.green : res.status === 429 ? ANSI.yellow : ANSI.red;

      const timeStr = new Date().toLocaleTimeString();
      console.log(
        `${ANSI.dim}[${timeStr}]${ANSI.reset} ${label} ` +
          `Dispatched ${ANSI.cyan}${payload.type}${ANSI.reset} ` +
          `(${payload.event_id}) -> Status: ${statusColor}${res.status}${ANSI.reset} (${durationMs}ms)`
      );
    } catch (err: any) {
      console.warn(
        `${ANSI.dim}[${new Date().toLocaleTimeString()}]${ANSI.reset} ` +
          `${ANSI.red}[DISPATCH FAILED]${ANSI.reset} Target unreachable: ${err.message}`
      );
    }

    if (active) {
      timer = setTimeout(dispatchEvent, intervalMs);
    }
  };

  // Kick off first dispatch after a short warmup delay (1 second)
  timer = setTimeout(dispatchEvent, 1000);

  return {
    stop() {
      active = false;
      if (timer) clearTimeout(timer);
    },
  };
}

