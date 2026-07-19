// artifacts/api-server/src/lib/keysetCursor.ts
// Cursor opaco de keyset: base64url("iso|id"). ISO tem precisão ms — as
// comparações SQL truncam com date_trunc('milliseconds', ...) para casar.
export function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`, "utf8").toString("base64url");
}

export function decodeCursor(raw: string): { createdAt: Date; id: string } | null {
  try {
    const text = Buffer.from(raw, "base64url").toString("utf8");
    const sep = text.indexOf("|");
    if (sep < 0) return null;
    const createdAt = new Date(text.slice(0, sep));
    const id = text.slice(sep + 1);
    if (Number.isNaN(createdAt.getTime()) || !id) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}
