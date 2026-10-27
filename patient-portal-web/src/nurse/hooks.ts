import type { EscalationDetail, EscalationStatus, EscalationSummary } from "@contracts";
import { useCallback, useEffect, useState } from "react";
import { type ApiClient, isApiClientError } from "../api/client";
import { describeError } from "../lib/labels";

interface QueueOptions {
  api: ApiClient;
  token: string;
  status: EscalationStatus;
  pollMs: number;
  /** Must be stable: it is an effect dependency. */
  onUnauthorized: () => void;
}

export interface Queue {
  /** Null until the first response for the current tab arrives. */
  items: EscalationSummary[] | null;
  error: string | null;
  refresh(): void;
}

/** The nurse queue, refreshed on a timer so new escalations appear without a reload. */
export function useEscalationQueue({
  api,
  token,
  status,
  pollMs,
  onUnauthorized,
}: QueueOptions): Queue {
  const [items, setItems] = useState<EscalationSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  // A different tab is a different list: do not show the old one while the new one loads.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset exactly when the tab changes
  useEffect(() => {
    setItems(null);
  }, [status]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: nonce restarts polling on demand
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      try {
        const next = await api.listEscalations(token, status);
        if (cancelled) return;
        setItems(next);
        setError(null);
      } catch (failure) {
        if (cancelled) return;
        if (isApiClientError(failure, "unauthorized")) {
          onUnauthorized();
          return;
        }
        setError(describeError(failure));
      }
      timer = setTimeout(tick, pollMs);
    };

    void tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [api, token, status, pollMs, nonce, onUnauthorized]);

  const refresh = useCallback(() => setNonce((current) => current + 1), []);
  return { items, error, refresh };
}

interface DetailOptions {
  api: ApiClient;
  token: string;
  threadId: string | undefined;
  onUnauthorized: () => void;
}

export interface Detail {
  detail: EscalationDetail | null;
  loading: boolean;
  error: string | null;
  reload(): void;
}

export function useEscalationDetail({
  api,
  token,
  threadId,
  onUnauthorized,
}: DetailOptions): Detail {
  const [detail, setDetail] = useState<EscalationDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: nonce reloads on demand
  useEffect(() => {
    if (threadId === undefined) return;
    let cancelled = false;
    setError(null);
    api
      .getEscalation(token, threadId)
      .then((next) => {
        if (!cancelled) setDetail(next);
      })
      .catch((failure: unknown) => {
        if (cancelled) return;
        if (isApiClientError(failure, "unauthorized")) onUnauthorized();
        else setError(describeError(failure));
      });
    return () => {
      cancelled = true;
    };
  }, [api, token, threadId, nonce, onUnauthorized]);

  const reload = useCallback(() => setNonce((current) => current + 1), []);
  // Never show another conversation's detail while the selected one loads.
  const current = detail !== null && detail.threadId === threadId ? detail : null;
  return {
    detail: current,
    loading: threadId !== undefined && current === null && error === null,
    error,
    reload,
  };
}
