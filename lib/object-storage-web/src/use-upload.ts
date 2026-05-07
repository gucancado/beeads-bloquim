import { useCallback, useState } from "react";

export type UploadBucket = "attachments" | "avatars";
export type UploadEntityKind = "task" | "card" | "comment" | "map" | "plan";

export interface UploadAttachmentInput {
  bucket: UploadBucket;
  entityKind: UploadEntityKind;
  entityId: string;
  /** Only meaningful when entityKind === "task". */
  kind?: "standard" | "deliverable";
}

export interface UploadAttachmentResult {
  attachmentId: string;
  bucket: UploadBucket;
  storagePath: string;
}

interface RequestUrlResponse {
  attachmentId: string;
  bucket: UploadBucket;
  storagePath: string;
  uploadUrl: string;
  method: "PUT";
  headers: Record<string, string>;
  expiresAt: string;
}

interface AvatarRequestUrlResponse {
  uploadUrl: string;
  method: "PUT";
  headers: Record<string, string>;
  expiresAt: string;
  avatarUrl: string;
}

export interface UseUploadOptions {
  /** Base path of the API (default: "/api"). */
  apiBase?: string;
  onSuccess?: (result: UploadAttachmentResult) => void;
  onError?: (error: UploadError) => void;
}

export class UploadError extends Error {
  readonly code: string;
  readonly status: number | null;
  constructor(message: string, code: string, status: number | null = null) {
    super(message);
    this.name = "UploadError";
    this.code = code;
    this.status = status;
  }
}

async function readErrorBody(response: Response): Promise<UploadError> {
  let payload: { error?: string; message?: string } | null = null;
  try {
    payload = (await response.json()) as { error?: string; message?: string };
  } catch {
    /* ignore */
  }
  const code = payload?.error ?? `http_${response.status}`;
  const message =
    payload?.message ?? payload?.error ?? `Upload request failed (${response.status})`;
  return new UploadError(message, code, response.status);
}

/**
 * React hook for uploading an attachment via the new single-call presigned URL flow:
 *   1. POST /api/storage/uploads/request-url with metadata + entity binding.
 *      Backend creates the `attachments` row AND returns a presigned PUT URL.
 *   2. PUT the file directly to the URL using the signed Content-Type header.
 *
 * No second "commit" call is required — the row exists from step 1.
 */
export function useUpload(options: UseUploadOptions = {}) {
  const apiBase = options.apiBase ?? "/api";
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<UploadError | null>(null);

  const uploadFile = useCallback(
    async (
      file: File,
      input: UploadAttachmentInput,
    ): Promise<UploadAttachmentResult | null> => {
      setIsUploading(true);
      setProgress(0);
      setError(null);

      try {
        const requestRes = await fetch(`${apiBase}/storage/uploads/request-url`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            bucket: input.bucket,
            entityKind: input.entityKind,
            entityId: input.entityId,
            filename: file.name,
            contentType: file.type || "application/octet-stream",
            sizeBytes: file.size,
            kind: input.kind,
          }),
        });

        if (!requestRes.ok) {
          throw await readErrorBody(requestRes);
        }
        setProgress(20);

        const data = (await requestRes.json()) as RequestUrlResponse;

        const putRes = await fetch(data.uploadUrl, {
          method: data.method,
          body: file,
          headers: data.headers,
        });
        if (!putRes.ok) {
          throw new UploadError(
            `Storage upload failed (${putRes.status})`,
            "storage_put_failed",
            putRes.status,
          );
        }
        setProgress(100);

        const result: UploadAttachmentResult = {
          attachmentId: data.attachmentId,
          bucket: data.bucket,
          storagePath: data.storagePath,
        };
        options.onSuccess?.(result);
        return result;
      } catch (err) {
        const e =
          err instanceof UploadError
            ? err
            : new UploadError(
                err instanceof Error ? err.message : "Upload failed",
                "unknown",
              );
        setError(e);
        options.onError?.(e);
        return null;
      } finally {
        setIsUploading(false);
      }
    },
    [apiBase, options],
  );

  return { uploadFile, isUploading, progress, error };
}

/**
 * Avatar upload uses a dedicated endpoint that ALSO updates the user's
 * avatar_storage_path. Returns the new public URL the frontend should display.
 */
export function useAvatarUpload(options: { apiBase?: string } = {}) {
  const apiBase = options.apiBase ?? "/api";
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<UploadError | null>(null);

  const uploadAvatar = useCallback(
    async (file: File): Promise<{ avatarUrl: string } | null> => {
      setIsUploading(true);
      setError(null);
      try {
        const reqRes = await fetch(`${apiBase}/auth/me/avatar/upload-url`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            filename: file.name,
            contentType: file.type || "application/octet-stream",
            sizeBytes: file.size,
          }),
        });
        if (!reqRes.ok) {
          throw await readErrorBody(reqRes);
        }
        const data = (await reqRes.json()) as AvatarRequestUrlResponse;

        const putRes = await fetch(data.uploadUrl, {
          method: data.method,
          body: file,
          headers: data.headers,
        });
        if (!putRes.ok) {
          throw new UploadError(
            `Avatar upload failed (${putRes.status})`,
            "storage_put_failed",
            putRes.status,
          );
        }
        return { avatarUrl: data.avatarUrl };
      } catch (err) {
        const e =
          err instanceof UploadError
            ? err
            : new UploadError(
                err instanceof Error ? err.message : "Avatar upload failed",
                "unknown",
              );
        setError(e);
        return null;
      } finally {
        setIsUploading(false);
      }
    },
    [apiBase],
  );

  return { uploadAvatar, isUploading, error };
}
