import { createHmac, timingSafeEqual } from "node:crypto";
import type { VerificationState } from "#domain";

export const SIGNATURE_HEADER = "x-wiresleuth-signature";

export function verify(
  rawBody: Buffer,
  headers: Readonly<Record<string, string>>,
  secret: string,
): Exclude<VerificationState, "RECEIVED"> {
  const provided = headerValue(headers, SIGNATURE_HEADER);
  if (provided === null || secret.length === 0) {
    return "REJECTED";
  }
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  const providedBytes = Buffer.from(provided, "hex");
  if (
    providedBytes.length !== expected.length ||
    provided.length !== expected.length * 2
  ) {
    return "REJECTED";
  }
  if (!timingSafeEqual(providedBytes, expected)) {
    return "REJECTED";
  }
  return "VERIFIED";
}

function headerValue(
  headers: Readonly<Record<string, string>>,
  name: string,
): string | null {
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === wanted && value.length > 0) {
      return value;
    }
  }
  return null;
}
