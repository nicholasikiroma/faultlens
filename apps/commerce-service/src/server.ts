import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  type FlightRecorder,
  recordVerification,
  recordIdentity,
  recordError,
  withFlightRecorderNodeHttp,
} from "#sdk";

export function createCommerceServer(recorder: FlightRecorder, port = 3002) {
  const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const parsedUrl = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
    const pathname = parsedUrl.pathname;

    // Health check endpoint (uninstrumented pass-through)
    if (pathname === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok", service: "commerce-service" }));
      return;
    }

    // Internal mock downstream endpoints for Undici HTTP tracing
    if (pathname === "/internal/inventory") {
      const delay = Number(parsedUrl.searchParams.get("delay") ?? "0");
      if (delay > 0) {
        await new Promise((r) => setTimeout(r, delay));
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ inStock: true, warehouse: "us-east-1" }));
      return;
    }

    if (pathname === "/internal/payment-gateway") {
      res.writeHead(429, {
        "content-type": "application/json",
        "retry-after": "30",
        "x-ratelimit-reset": "1731412800",
      });
      res.end(JSON.stringify({ error: "Upstream rate limit exceeded (100 req/min saturated)" }));
      return;
    }

    // Ingress Webhook Routes
    if (pathname === "/webhooks/orders" || pathname === "/webhooks/payments") {
      if (req.method !== "POST") {
        res.writeHead(405, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "Method Not Allowed" }));
        return;
      }

      const provider = pathname === "/webhooks/payments" ? "stripe" : "shopify";

      // 1. Consume and tap request payload
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
      }
      const rawText = Buffer.concat(chunks).toString("utf8");

      let body: Record<string, any> = {};
      try {
        body = JSON.parse(rawText);
      } catch (err) {
        body = {};
      }

      // Record identity into episode
      recordIdentity({
        provider,
        eventId: body.event_id || `evt_${Date.now()}`,
        eventType: body.type || (pathname === "/webhooks/orders" ? "order.created" : "payment.captured"),
        resourceId: body.order_id || body.payment_id,
        providerCreatedAtSec: Math.floor(Date.now() / 1000),
      });

      // 2. Signature Verification Check
      const sigHeader = req.headers["x-order-signature"] || req.headers["stripe-signature"];
      const isBadSignature = sigHeader === "invalid_tampered_sig" || !sigHeader;

      if (isBadSignature) {
        recordVerification({
          state: "REJECTED",
          provider,
          reason: "HMAC-SHA256 signature mismatch: tampered digest received",
        });
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "Unauthorized: Invalid Signature" }));
        return;
      }

      recordVerification({
        state: "VERIFIED",
        provider,
      });

      const scenario = body.scenario ?? "ok";

      // Scenario: Simulated unhandled exception
      if (scenario === "exception") {
        const boom = new Error("Commerce Database Connection Pool Exhausted (max_connections: 50)");
        recordError(boom, "CONTROLLER");
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "Internal Server Error" }));
        return;
      }

      // Scenario: Downstream Timeout via Undici / fetch
      if (scenario === "timeout") {
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 60);
          await fetch(`http://127.0.0.1:${port}/internal/inventory?delay=250`, {
            signal: controller.signal,
          });
          clearTimeout(timer);
        } catch (fetchErr: any) {
          recordError(fetchErr, "CONTROLLER");
          res.writeHead(504, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "Gateway Timeout: Downstream inventory service timed out" }));
          return;
        }
      }

      // Scenario: Downstream Rate Limit (429) via Undici / fetch
      if (scenario === "ratelimit") {
        const resp = await fetch(`http://127.0.0.1:${port}/internal/payment-gateway`);
        if (resp.status === 429) {
          res.writeHead(429, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "Upstream Rate Limit Exceeded" }));
          return;
        }
      }

      // Scenario: Normal / Healthy (also handles duplicate delivery on repeat)
      // Call mock internal inventory to establish a healthy downstream hop
      await fetch(`http://127.0.0.1:${port}/internal/inventory`);

      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          accepted: true,
          orderId: body.order_id ?? "ord_demo_100",
          status: "processed",
        })
      );
      return;
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "Not Found" }));
  };

  // Wrap handler with FlightRecorder Node HTTP adapter
  return createServer(
    withFlightRecorderNodeHttp(recorder, handler, { routeTemplate: "/webhooks/:event" })
  );
}

