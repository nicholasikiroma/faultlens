import { timingSafeEqual } from "node:crypto";
import { config } from "../config.ts";

export function verifyAdminToken(
  providedToken: string | null | undefined,
): boolean {
  const expected = config.adminToken;
  if (
    typeof providedToken !== "string" ||
    providedToken.length === 0 ||
    expected.length === 0
  ) {
    return false;
  }
  const providedBytes = Buffer.from(providedToken, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  if (providedBytes.byteLength !== expectedBytes.byteLength) {
    return false;
  }
  return timingSafeEqual(providedBytes, expectedBytes);
}
