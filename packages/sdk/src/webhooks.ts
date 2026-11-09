import { createHmac } from "node:crypto";
import { INGEST_SIGNATURE_HEADER, MAX_INGEST_BODY_BYTES } from "#domain";
import type { DeliveryResult, Transport } from "./transport.ts";

export interface WebhookOptions {
  /** Integration signing secret for webhook ingestion, not the provider's secret. */
  signingSecret: string;
}

export interface WebhookCapture {
  /** Signs and sends an immutable snapshot. Never rejects. No retries. */
  capture(rawBody: Uint8Array): Promise<DeliveryResult>;
}

export function createWebhookCapture(
  transport: Transport,
  options: WebhookOptions,
): WebhookCapture {
  const { signingSecret } = options;

  if (!signingSecret)
    throw new Error(
      "webhooks.signingSecret is required when enabling webhooks",
    );

  return Object.freeze({
    async capture(rawBody: Uint8Array): Promise<DeliveryResult> {
      if (!(rawBody instanceof Uint8Array))
        return { outcome: "failed", reason: "invalid-input" };
      if (rawBody.byteLength > MAX_INGEST_BODY_BYTES)
        return { outcome: "dropped", reason: "oversized" };
      return transport.deliver(() => {
        // The transport invokes this before its first await, preserving mutation safety.
        const body = new Uint8Array(rawBody);
        const signature = createHmac("sha256", signingSecret)
          .update(body)
          .digest("hex");
        return {
          path: "/v1/ingest",
          body,
          headers: {
            "content-type": "application/json",
            [INGEST_SIGNATURE_HEADER]: signature,
          },
        };
      });
    },
  });
}
