/**
 * Bucket logical names. The factory maps these to physical bucket names from
 * env vars (e.g. "attachments" -> S3_BUCKET_ATTACHMENTS).
 */
export type BucketName = "attachments" | "avatars" | "public-assets";

export type AttachmentEntityKind = "task" | "card" | "comment" | "plan";

/**
 * Components used to build a deterministic storage path. The factory's
 * buildStoragePath() helper composes them in a canonical layout so that
 * different parts of the app produce consistent keys.
 */
export interface StoragePathParts {
  workspaceId: string;
  entityKind: AttachmentEntityKind;
  entityId: string;
  /** Optional sub-scope, e.g. comment under a task */
  subScopeKind?: AttachmentEntityKind;
  subScopeId?: string;
  attachmentId: string;
  filename: string;
}

export interface CreateUploadUrlInput {
  bucket: BucketName;
  storagePath: string;
  contentType: string;
  /** Maximum file size the signed URL will accept (bytes) */
  maxSizeBytes?: number;
  /** Default 900s (15 min). Cap depends on provider. */
  expiresInSeconds?: number;
}

export interface UploadUrlResult {
  uploadUrl: string;
  method: "PUT" | "POST";
  /**
   * Headers the client MUST send with the upload request. Some providers
   * (R2, S3) sign the Content-Type, so the client must echo it.
   */
  headers: Record<string, string>;
  expiresAt: Date;
}

export interface CreateDownloadUrlInput {
  bucket: BucketName;
  storagePath: string;
  /** Default 900s. */
  expiresInSeconds?: number;
  /** When set, forces the browser to download with this filename. */
  download?: { filename: string };
}

export interface DownloadUrlResult {
  url: string;
  expiresAt: Date;
}

export interface ReadStreamInput {
  bucket: BucketName;
  storagePath: string;
}

export interface ReadStreamResult {
  stream: NodeJS.ReadableStream;
  contentType: string;
  contentLength?: number;
}

export interface RemoveInput {
  bucket: BucketName;
  storagePath: string;
}

export interface StorageService {
  /** Generate a presigned upload URL the client uses for direct upload. */
  createUploadUrl(input: CreateUploadUrlInput): Promise<UploadUrlResult>;

  /** Generate a presigned download URL (optionally with attachment disposition). */
  createDownloadUrl(input: CreateDownloadUrlInput): Promise<DownloadUrlResult>;

  /** Read object as a Node stream, for backend-proxied downloads. */
  getReadStream(input: ReadStreamInput): Promise<ReadStreamResult>;

  /** Permanently delete an object. Soft-delete is the caller's responsibility (DB). */
  remove(input: RemoveInput): Promise<void>;

  /** True when the underlying provider can do real work. */
  readonly enabled: boolean;
}

export class StorageDisabledError extends Error {
  readonly code = "storage_disabled";
  constructor(message = "Storage provider is disabled") {
    super(message);
    this.name = "StorageDisabledError";
  }
}

export class StorageObjectNotFoundError extends Error {
  readonly code = "object_not_found";
  constructor(public readonly storagePath: string) {
    super(`Object not found: ${storagePath}`);
    this.name = "StorageObjectNotFoundError";
  }
}
