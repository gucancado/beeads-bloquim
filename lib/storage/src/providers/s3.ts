import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import {
  type BucketName,
  type CreateDownloadUrlInput,
  type CreateUploadUrlInput,
  type DownloadUrlResult,
  type ReadStreamInput,
  type ReadStreamResult,
  type RemoveInput,
  StorageObjectNotFoundError,
  type StorageService,
  type UploadUrlResult,
} from "../types";

export interface S3StorageProviderConfig {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** R2 and MinIO require path-style; AWS S3 prefers virtual-hosted. */
  forcePathStyle?: boolean;
  /**
   * Logical bucket name → physical bucket name. The factory builds this from
   * env vars (S3_BUCKET_ATTACHMENTS, etc).
   */
  buckets: Record<BucketName, string>;
}

const DEFAULT_TTL_SECONDS = 900; // 15 min

/**
 * S3-compatible provider. Tested against Cloudflare R2; works with AWS S3,
 * MinIO, Hetzner Object Storage and similar by adjusting endpoint + region.
 */
export class S3StorageProvider implements StorageService {
  readonly enabled = true;
  private readonly client: S3Client;

  constructor(private readonly config: S3StorageProviderConfig) {
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      forcePathStyle: config.forcePathStyle ?? true,
    });
  }

  private resolveBucket(name: BucketName): string {
    const physical = this.config.buckets[name];
    if (!physical) {
      throw new Error(`No physical bucket configured for "${name}"`);
    }
    return physical;
  }

  async createUploadUrl(input: CreateUploadUrlInput): Promise<UploadUrlResult> {
    const Bucket = this.resolveBucket(input.bucket);
    const expiresInSeconds = input.expiresInSeconds ?? DEFAULT_TTL_SECONDS;

    const command = new PutObjectCommand({
      Bucket,
      Key: input.storagePath,
      ContentType: input.contentType,
      ContentLength: input.maxSizeBytes,
    });

    const uploadUrl = await getSignedUrl(this.client, command, {
      expiresIn: expiresInSeconds,
      // Sign Content-Type so the client MUST send the same one back.
      signableHeaders: new Set(["host", "content-type"]),
    });

    return {
      uploadUrl,
      method: "PUT",
      headers: { "Content-Type": input.contentType },
      expiresAt: new Date(Date.now() + expiresInSeconds * 1000),
    };
  }

  async createDownloadUrl(input: CreateDownloadUrlInput): Promise<DownloadUrlResult> {
    const Bucket = this.resolveBucket(input.bucket);
    const expiresInSeconds = input.expiresInSeconds ?? DEFAULT_TTL_SECONDS;

    const command = new GetObjectCommand({
      Bucket,
      Key: input.storagePath,
      ResponseContentDisposition: input.download
        ? `attachment; filename="${encodeRfc5987(input.download.filename)}"`
        : undefined,
    });

    const url = await getSignedUrl(this.client, command, {
      expiresIn: expiresInSeconds,
    });

    return {
      url,
      expiresAt: new Date(Date.now() + expiresInSeconds * 1000),
    };
  }

  async getReadStream(input: ReadStreamInput): Promise<ReadStreamResult> {
    const Bucket = this.resolveBucket(input.bucket);
    try {
      const response = await this.client.send(
        new GetObjectCommand({ Bucket, Key: input.storagePath }),
      );
      if (!response.Body) {
        throw new StorageObjectNotFoundError(input.storagePath);
      }
      // Body is a Node Readable when running on Node 18+
      const stream = response.Body as unknown as NodeJS.ReadableStream;
      return {
        stream,
        contentType: response.ContentType ?? "application/octet-stream",
        contentLength: response.ContentLength,
      };
    } catch (err) {
      if (isS3NotFound(err)) {
        throw new StorageObjectNotFoundError(input.storagePath);
      }
      throw err;
    }
  }

  async remove(input: RemoveInput): Promise<void> {
    const Bucket = this.resolveBucket(input.bucket);
    await this.client.send(
      new DeleteObjectCommand({ Bucket, Key: input.storagePath }),
    );
  }
}

function isS3NotFound(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e.name === "NoSuchKey" || e.$metadata?.httpStatusCode === 404;
}

/** Encode a filename per RFC 5987 so non-ASCII filenames survive Content-Disposition. */
function encodeRfc5987(value: string): string {
  return encodeURIComponent(value)
    .replace(/['()]/g, escape)
    .replace(/\*/g, "%2A");
}
