import type { ChatMessage } from "@contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { type ApiClient, isApiClientError } from "../api/client";
import { loadThreadId, saveThreadId } from "../auth/session";
import { describeError } from "../lib/labels";

export type ChatPhase = "idle" | "sending" | "awaiting_nurse";

interface Options {
  api: ApiClient;
  token: string;
  storage: Storage | undefined;
  /** How often to look for the nurse's reply while the conversation is held. */
  pollMs: number;
  /** Must be stable (wrap in useCallback): it is an effect dependency. */
  onUnauthorized: () => void;
}

export interface PatientChat {
  messages: ChatMessage[];
  phase: ChatPhase;
  error: string | null;
  /** True while a saved conversation is being loaded after a reload. */
  restoring: boolean;
  /** True once the thread contains the emergency notice. Survives a reload. */
  emergency: boolean;
  send(text: string): Promise<void>;
  startOver(): void;
}

export function usePatientChat({
  api,
  token,
  storage,
  pollMs,
  onUnauthorized,
}: Options): PatientChat {
  const [threadId, setThreadId] = useState<string | undefined>(() => loadThreadId(storage));
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [phase, setPhase] = useState<ChatPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(() => loadThreadId(storage) !== undefined);
  const localCounter = useRef(0);

  // Pick the conversation back up after a reload.
  useEffect(() => {
    const stored = loadThreadId(storage);
    if (stored === undefined) {
      setRestoring(false);
      return;
    }
    let cancelled = false;
    api
      .getThread(token, stored)
      .then((thread) => {
        if (cancelled) return;
        setThreadId(thread.threadId);
        setMessages(thread.messages);
        setPhase(thread.status === "awaiting_nurse" ? "awaiting_nurse" : "idle");
      })
      .catch((failure: unknown) => {
        if (cancelled) return;
        if (isApiClientError(failure, "unauthorized")) {
          onUnauthorized();
        } else if (isApiClientError(failure, "not_found")) {
          saveThreadId(storage, undefined);
          setThreadId(undefined);
        } else {
          setError(describeError(failure));
        }
      })
      .finally(() => {
        if (!cancelled) setRestoring(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api, token, storage, onUnauthorized]);

  // While a nurse holds the conversation, look for their reply.
  useEffect(() => {
    if (phase !== "awaiting_nurse" || threadId === undefined) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const check = async () => {
      try {
        const thread = await api.getThread(token, threadId);
        if (cancelled) return;
        if (thread.status === "responded") {
          setMessages(thread.messages);
          setPhase("idle");
          return;
        }
      } catch (failure) {
        if (cancelled) return;
        if (isApiClientError(failure, "unauthorized")) {
          onUnauthorized();
          return;
        }
        // Anything else is probably a blip: keep looking.
      }
      timer = setTimeout(check, pollMs);
    };

    timer = setTimeout(check, pollMs);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [phase, threadId, api, token, pollMs, onUnauthorized]);

  const send = useCallback(
    async (text: string) => {
      const message = text.trim();
      if (message === "" || phase !== "idle") return;

      setError(null);
      setPhase("sending");
      localCounter.current += 1;
      setMessages((current) => [
        ...current,
        {
          id: `local-${localCounter.current}`,
          role: "patient",
          content: message,
          createdAt: new Date().toISOString(),
        },
      ]);

      try {
        const response = await api.sendMessage(token, { threadId, message });
        setThreadId(response.threadId);
        saveThreadId(storage, response.threadId);
        setMessages((current) => [...current, ...response.messages]);
        setPhase(response.status === "awaiting_nurse" ? "awaiting_nurse" : "idle");
      } catch (failure) {
        if (isApiClientError(failure, "unauthorized")) {
          onUnauthorized();
          return;
        }
        if (isApiClientError(failure, "conflict") && threadId !== undefined) {
          // Usually "a nurse is holding this conversation": ask the server which it is.
          try {
            const thread = await api.getThread(token, threadId);
            setMessages(thread.messages);
            if (thread.status === "awaiting_nurse") {
              setPhase("awaiting_nurse");
              return;
            }
          } catch {
            // Fall through to the generic message below.
          }
        }
        setError(describeError(failure));
        setPhase("idle");
      }
    },
    [api, token, storage, threadId, phase, onUnauthorized],
  );

  const startOver = useCallback(() => {
    saveThreadId(storage, undefined);
    setThreadId(undefined);
    setMessages([]);
    setError(null);
    setPhase("idle");
  }, [storage]);

  return {
    messages,
    phase,
    error,
    restoring,
    emergency: messages.some((message) => message.role === "system"),
    send,
    startOver,
  };
}
