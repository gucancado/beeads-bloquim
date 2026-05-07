import {
  type CreateDownloadUrlInput,
  type CreateUploadUrlInput,
  type DownloadUrlResult,
  type ReadStreamInput,
  type ReadStreamResult,
  type RemoveInput,
  type StorageService,
  StorageDisabledError,
  type UploadUrlResult,
} from "../types";

/**
 * Stub provider for when STORAGE_PROVIDER=disabled. Every operation throws
 * StorageDisabledError so callers can surface a 503 without crashing.
 */
export class DisabledStorageProvider implements StorageService {
  readonly enabled = false;

  async createUploadUrl(_input: CreateUploadUrlInput): Promise<UploadUrlResult> {
    throw new StorageDisabledError();
  }

  async createDownloadUrl(_input: CreateDownloadUrlInput): Promise<DownloadUrlResult> {
    throw new StorageDisabledError();
  }

  async getReadStream(_input: ReadStreamInput): Promise<ReadStreamResult> {
    throw new StorageDisabledError();
  }

  async remove(_input: RemoveInput): Promise<void> {
    throw new StorageDisabledError();
  }
}
