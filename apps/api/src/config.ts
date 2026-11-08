import "dotenv/config";

export const config = {
  get adminToken(): string {
    return process.env["WIRESLEUTH_ADMIN_TOKEN"] ?? "";
  },
} as const;
