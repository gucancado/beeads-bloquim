import { useEffect, useState } from "react";

interface BlobState {
  url: string | null;
  loading: boolean;
  error: boolean;
}

const cache = new Map<string, { url: string; refs: number }>();

function acquire(key: string): string | null {
  const entry = cache.get(key);
  if (!entry) return null;
  entry.refs += 1;
  return entry.url;
}

function release(key: string) {
  const entry = cache.get(key);
  if (!entry) return;
  entry.refs -= 1;
  if (entry.refs <= 0) {
    URL.revokeObjectURL(entry.url);
    cache.delete(key);
  }
}

export function useAttachmentBlobUrl(downloadUrl: string | null): BlobState {
  const [state, setState] = useState<BlobState>({ url: null, loading: !!downloadUrl, error: false });

  useEffect(() => {
    if (!downloadUrl) {
      setState({ url: null, loading: false, error: false });
      return;
    }

    let cancelled = false;
    const cached = acquire(downloadUrl);
    if (cached) {
      setState({ url: cached, loading: false, error: false });
      return () => {
        release(downloadUrl);
      };
    }

    setState({ url: null, loading: true, error: false });

    fetch(downloadUrl, { credentials: "include" })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.blob();
      })
      .then((blob) => {
        if (cancelled) return;
        const existing = acquire(downloadUrl);
        if (existing) {
          setState({ url: existing, loading: false, error: false });
          return;
        }
        const url = URL.createObjectURL(blob);
        cache.set(downloadUrl, { url, refs: 1 });
        setState({ url, loading: false, error: false });
      })
      .catch(() => {
        if (cancelled) return;
        setState({ url: null, loading: false, error: true });
      });

    return () => {
      cancelled = true;
      release(downloadUrl);
    };
  }, [downloadUrl]);

  return state;
}
