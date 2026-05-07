import type { StoragePathParts } from "./types";

export const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB

export const BLOCKED_EXTENSIONS = [
  ".exe",
  ".bat",
  ".cmd",
  ".sh",
  ".ps1",
  ".msi",
  ".scr",
  ".com",
  ".vbs",
  ".js", // executable scripts when downloaded; we still allow .json/.jsx via mime check
] as const;

export const BLOCKED_MIME_TYPES = [
  "application/x-msdownload",
  "application/x-msdos-program",
  "application/bat",
  "application/x-bat",
  "application/x-sh",
  "application/x-shellscript",
  "text/x-shellscript",
  "application/x-msi",
] as const;

const FILENAME_MAX_LENGTH = 200;

export interface FileValidationInput {
  filename: string;
  mimeType: string;
  sizeBytes: number;
  maxSizeBytes?: number;
}

export type FileValidationFailure =
  | { code: "FILE_TOO_LARGE"; message: string; limit: number }
  | { code: "FILE_EXTENSION_BLOCKED"; message: string; extension: string }
  | { code: "FILE_MIME_BLOCKED"; message: string; mimeType: string }
  | { code: "FILE_NAME_INVALID"; message: string };

/**
 * Validate filename, mime type and size before any storage operation.
 * Returns null on success, a structured failure otherwise.
 */
export function validateFileUpload(
  input: FileValidationInput,
): FileValidationFailure | null {
  const limit = input.maxSizeBytes ?? MAX_FILE_SIZE_BYTES;

  if (input.sizeBytes > limit) {
    return {
      code: "FILE_TOO_LARGE",
      message: `O arquivo excede o limite de ${formatBytes(limit)}.`,
      limit,
    };
  }

  if (!input.filename.trim()) {
    return {
      code: "FILE_NAME_INVALID",
      message: "Nome de arquivo vazio.",
    };
  }

  const lower = input.filename.toLowerCase();
  for (const ext of BLOCKED_EXTENSIONS) {
    if (lower.endsWith(ext)) {
      return {
        code: "FILE_EXTENSION_BLOCKED",
        message: `Este tipo de arquivo (${ext}) não é permitido.`,
        extension: ext,
      };
    }
  }

  const mimeLower = input.mimeType.toLowerCase().trim();
  if (BLOCKED_MIME_TYPES.includes(mimeLower as (typeof BLOCKED_MIME_TYPES)[number])) {
    return {
      code: "FILE_MIME_BLOCKED",
      message: `Este tipo MIME (${mimeLower}) não é permitido.`,
      mimeType: mimeLower,
    };
  }

  return null;
}

/**
 * Sanitize a user-provided filename for safe storage. Removes path traversal,
 * normalizes unicode, replaces unsafe characters, and truncates length.
 * Returns the original extension preserved.
 */
export function sanitizeFilename(rawName: string): string {
  // Normalize unicode (e.g. combining diacritics)
  let name = rawName.normalize("NFKD");

  // Strip directory components — keep only the final segment
  const lastSlash = Math.max(name.lastIndexOf("/"), name.lastIndexOf("\\"));
  if (lastSlash >= 0) {
    name = name.slice(lastSlash + 1);
  }

  // Replace any character that's not alnum, dash, dot, underscore, space
  name = name.replace(/[^A-Za-z0-9._\- ]/g, "_");

  // Collapse repeated dots (no ..) and leading dots
  name = name.replace(/\.{2,}/g, ".").replace(/^\.+/, "");

  // Collapse repeated underscores/spaces
  name = name.replace(/[ _]{2,}/g, "_").trim();

  if (!name) {
    return "file";
  }

  if (name.length <= FILENAME_MAX_LENGTH) {
    return name;
  }

  // Truncate while preserving extension
  const dotIndex = name.lastIndexOf(".");
  if (dotIndex < 0 || dotIndex < name.length - 12) {
    return name.slice(0, FILENAME_MAX_LENGTH);
  }
  const ext = name.slice(dotIndex);
  const base = name.slice(0, dotIndex);
  return base.slice(0, FILENAME_MAX_LENGTH - ext.length) + ext;
}

/**
 * Compose a deterministic storage path:
 *   workspace/{workspaceId}/{entityKind}/{entityId}[/{subScopeKind}/{subScopeId}]/{attachmentId}-{sanitizedFilename}
 */
export function buildStoragePath(parts: StoragePathParts): string {
  const safeName = sanitizeFilename(parts.filename);
  const segments = [
    "workspace",
    parts.workspaceId,
    parts.entityKind,
    parts.entityId,
  ];
  if (parts.subScopeKind && parts.subScopeId) {
    segments.push(parts.subScopeKind, parts.subScopeId);
  }
  segments.push(`${parts.attachmentId}-${safeName}`);
  return segments.join("/");
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(0)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}
