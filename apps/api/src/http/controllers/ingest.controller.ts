import { ingest, ingestSimulated, MAX_BODY_BYTES } from "../../ingest/ingest.ts";
import {
  bearerToken,
  flatHeaders,
  headerPairs,
  readCapped,
  requiredParam,
  type ApiContext,
  type HeaderPairs,
} from "../request.ts";
import { INGEST_STATUS, type Route } from "../routes.ts";

const RAW_READ_CAP = MAX_BODY_BYTES + 1;

type IngestRoute = Extract<Route, { id: "ingest" | "simulateWebhook" }>;

export async function handleIngest(c: ApiContext, route: IngestRoute): Promise<Response> {
  const pairs = headerPairs(c);
  const rawBody = await readCapped(c.req.raw, RAW_READ_CAP);
  const ingestDelivery = route.access.traffic === "real" ? ingest : ingestSimulated;
  const result = await ingestDelivery({
    token: ingestCredential(route, c, pairs),
    rawBody,
    headers: flatHeaders(pairs),
  });
  return c.json(result, INGEST_STATUS[result.outcome]);
}

function ingestCredential(route: IngestRoute, c: ApiContext, pairs: HeaderPairs): string {
  switch (route.access.credential) {
    case "bearer":
      return bearerToken(pairs) ?? "";
    case "path":
      return requiredParam(c.req.param(), "token");
    default: {
      const unreachable: never = route.access;
      return unreachable;
    }
  }
}
