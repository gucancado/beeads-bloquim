import { createStorageService, type StorageService } from "@workspace/storage";
import { logger } from "./logger";

/**
 * Lazy singleton of the StorageService — instantiated on first access so that
 * a missing S3 env var doesn't crash at module load (only when a route needs
 * storage). Disabled provider remains the default, never throws at boot.
 */

let cached: StorageService | null = null;

export function getStorage(): StorageService {
  if (!cached) {
    cached = createStorageService(process.env);
    logger.info(
      {
        module: "storage",
        provider: cached.enabled ? process.env.STORAGE_PROVIDER : "disabled",
      },
      "storage service initialized",
    );
  }
  return cached;
}
