import { createTransport, type TransportOptions } from "./transport.ts";
import { createWebhookCapture, type WebhookCapture, type WebhookOptions } from "./webhooks.ts";

export type { DeliveryResult } from "./transport.ts";
export type { WebhookCapture, WebhookOptions } from "./webhooks.ts";

export interface WireSleuthClientOptions extends TransportOptions {
  /** Opt into webhook observations. Other investigation sources are not implemented yet. */
  webhooks?: WebhookOptions;
}

export interface WireSleuthClient {
  readonly webhooks?: WebhookCapture;
}

export function createWireSleuthClient(
  options: WireSleuthClientOptions & { webhooks: WebhookOptions },
): WireSleuthClient & { readonly webhooks: WebhookCapture };
export function createWireSleuthClient(options: WireSleuthClientOptions): WireSleuthClient;

/** One shared delivery core, with explicitly enabled observation capabilities.
 * Configuration errors throw at startup; capture failures resolve as data.
 */
export function createWireSleuthClient(options: WireSleuthClientOptions): WireSleuthClient {
  const transport = createTransport(options);
  return Object.freeze(options.webhooks === undefined ? {} : {
    webhooks: createWebhookCapture(transport, options.webhooks),
  });
}
