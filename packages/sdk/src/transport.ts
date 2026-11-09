export interface TransportOptions {
  /** API origin, e.g. https://wiresleuth.example.com (no path or credentials). */
  baseUrl: string;
  apiKey: string;
  /** Per-delivery deadline. Default: 1000 ms. */
  timeoutMs?: number;
  /** Shared delivery budget per client; drop rather than queue. Default: 8. */
  maxInFlight?: number;
}

export type DeliveryResult =
  | { outcome: "delivered"; status: number }
  | { outcome: "failed"; reason: "http"; status: number }
  | { outcome: "failed"; reason: "network" | "timeout" | "invalid-input" }
  | { outcome: "dropped"; reason: "oversized" | "busy" };

interface DeliveryRequest {
  path: `/${string}`;
  body: Uint8Array<ArrayBuffer>;
  headers: Readonly<Record<string, string>>;
}

// Internal transport, not a public arbitrary-event API. Capabilities own their
// wire format, payload bounds, and signing; transport owns delivery isolation.
export interface Transport {
  deliver(prepare: () => DeliveryRequest): Promise<DeliveryResult>;
}

export function createTransport(options: TransportOptions): Transport {
  let base: URL;
  try {
    base = new URL(options.baseUrl);
  } catch {
    throw new Error("baseUrl must be a valid HTTP(S) origin");
  }
  if (
    !["http:", "https:"].includes(base.protocol) ||
    base.username ||
    base.password ||
    base.pathname !== "/" ||
    base.search ||
    base.hash
  ) {
    throw new Error(
      "baseUrl must be an HTTP(S) origin without credentials, path, query, or fragment",
    );
  }
  if (!options.apiKey || /\s/.test(options.apiKey))
    throw new Error("apiKey is required");
  const timeoutMs = options.timeoutMs ?? 1000;
  const maxInFlight = options.maxInFlight ?? 8;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
    throw new Error("timeoutMs must be an integer between 1 and 60000");
  }
  if (!Number.isInteger(maxInFlight) || maxInFlight < 1 || maxInFlight > 1024) {
    throw new Error("maxInFlight must be an integer between 1 and 1024");
  }
  const { apiKey } = options;
  let inFlight = 0;
  return {
    async deliver(prepare): Promise<DeliveryResult> {
      if (inFlight >= maxInFlight)
        return { outcome: "dropped", reason: "busy" };
      inFlight++;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      timer.unref();
      try {
        // Prepare synchronously under the delivery budget, before any await.
        const request = prepare();
        const endpoint = new URL(request.path, base);
        if (
          endpoint.origin !== base.origin ||
          endpoint.username ||
          endpoint.password
        ) {
          return { outcome: "failed", reason: "invalid-input" };
        }
        const response = await fetch(endpoint, {
          method: "POST",
          redirect: "error",
          headers: { ...request.headers, authorization: `Bearer ${apiKey}` },
          body: request.body,
          signal: controller.signal,
        });
        // Never buffer, return, or log upstream bodies or error messages.
        await response.body?.cancel();
        return response.ok
          ? { outcome: "delivered", status: response.status }
          : { outcome: "failed", reason: "http", status: response.status };
      } catch {
        return {
          outcome: "failed",
          reason: controller.signal.aborted ? "timeout" : "network",
        };
      } finally {
        clearTimeout(timer);
        inFlight--;
      }
    },
  };
}
