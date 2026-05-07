import { DisabledStorageProvider } from "./providers/disabled";
import { S3StorageProvider } from "./providers/s3";
import type { BucketName, StorageService } from "./types";

export type StorageProviderName = "disabled" | "s3";

export interface StorageEnv {
  STORAGE_PROVIDER?: string;
  S3_ENDPOINT?: string;
  S3_REGION?: string;
  S3_ACCESS_KEY_ID?: string;
  S3_SECRET_ACCESS_KEY?: string;
  S3_FORCE_PATH_STYLE?: string;
  S3_BUCKET_ATTACHMENTS?: string;
  S3_BUCKET_AVATARS?: string;
  S3_BUCKET_PUBLIC?: string;
}

/**
 * Build the StorageService from env vars. Reads from `process.env` by default,
 * but accepts an explicit env object for testing.
 *
 * Behavior:
 * - STORAGE_PROVIDER=disabled (or unset) → DisabledStorageProvider
 * - STORAGE_PROVIDER=s3 → S3StorageProvider, requires all S3_* vars to be set
 *
 * Throws on misconfigured s3 (missing env). Callers should let the throw
 * propagate at boot time so the operator sees the error immediately.
 */
export function createStorageService(
  env: StorageEnv = process.env as StorageEnv,
): StorageService {
  const provider = (env.STORAGE_PROVIDER ?? "disabled").toLowerCase() as StorageProviderName;

  if (provider === "disabled") {
    return new DisabledStorageProvider();
  }

  if (provider === "s3") {
    const missing: string[] = [];
    const need = (key: keyof StorageEnv) => {
      const value = env[key];
      if (!value) missing.push(key);
      return value ?? "";
    };

    const endpoint = need("S3_ENDPOINT");
    const region = need("S3_REGION");
    const accessKeyId = need("S3_ACCESS_KEY_ID");
    const secretAccessKey = need("S3_SECRET_ACCESS_KEY");
    const bucketAttachments = need("S3_BUCKET_ATTACHMENTS");
    const bucketAvatars = need("S3_BUCKET_AVATARS");
    const bucketPublic = need("S3_BUCKET_PUBLIC");

    if (missing.length > 0) {
      throw new Error(
        `STORAGE_PROVIDER=s3 requires the following env vars: ${missing.join(", ")}`,
      );
    }

    const buckets: Record<BucketName, string> = {
      attachments: bucketAttachments,
      avatars: bucketAvatars,
      "public-assets": bucketPublic,
    };

    return new S3StorageProvider({
      endpoint,
      region,
      accessKeyId,
      secretAccessKey,
      forcePathStyle: parseBoolean(env.S3_FORCE_PATH_STYLE, true),
      buckets,
    });
  }

  throw new Error(`Unknown STORAGE_PROVIDER: "${provider}". Use "disabled" or "s3".`);
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  const lower = value.toLowerCase();
  if (["true", "1", "yes", "on"].includes(lower)) return true;
  if (["false", "0", "no", "off"].includes(lower)) return false;
  return fallback;
}
