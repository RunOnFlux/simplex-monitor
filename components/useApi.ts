'use client';

import { useCallback, useEffect, useState } from 'react';

interface ApiSuccess<T> {
  status: 'success';
  data: T;
}
interface ApiError {
  status: 'error';
  data: { code: number; name: string; message: string };
}

export async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (res.status === 401 && typeof window !== 'undefined') {
    // Session expired: a full navigation intentionally resets all app state.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign('/login');
    throw new Error('Login required');
  }
  let body: ApiSuccess<T> | ApiError;
  try {
    body = (await res.json()) as ApiSuccess<T> | ApiError;
  } catch {
    // Non-JSON response: came from a proxy/CDN error page, not our API.
    throw new Error(
      `Unexpected non-JSON response (HTTP ${res.status}) - check the proxy/CDN layer`,
    );
  }
  if (body.status === 'error') throw new Error(body.data.message);
  return body.data;
}

interface ApiState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

/** Fetches an API endpoint and re-fetches on an interval. */
export function useApi<T>(url: string | null, pollMs?: number) {
  const [state, setState] = useState<ApiState<T>>({ data: null, error: null, loading: true });

  const load = useCallback(async () => {
    if (!url) return;
    try {
      const data = await apiFetch<T>(url);
      setState({ data, error: null, loading: false });
    } catch (e) {
      setState((prev) => ({ ...prev, error: (e as Error).message, loading: false }));
    }
  }, [url]);

  useEffect(() => {
    void load();
    if (!pollMs) return;
    const timer = setInterval(() => void load(), pollMs);
    return () => clearInterval(timer);
  }, [load, pollMs]);

  return { ...state, reload: load };
}
