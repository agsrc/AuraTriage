import type { EscalationStatus, NurseResolution } from "@contracts";
import { useCallback, useEffect, useState } from "react";
import { isApiClientError } from "../api/client";
import { useApp } from "../app/context";
import type { Session } from "../auth/session";
import { AppShell } from "../components/AppShell";
import { describeError } from "../lib/labels";
import { DetailPanel } from "./DetailPanel";
import { useEscalationDetail, useEscalationQueue } from "./hooks";
import { NurseLogin } from "./NurseLogin";
import { QueueList } from "./QueueList";

export function NursePage() {
  const { session } = useApp();

  useEffect(() => {
    document.title = "AuraTriage · Nurse dashboard";
  }, []);

  if (session?.role !== "nurse") {
    return <NurseLogin />;
  }
  return <Dashboard session={session} />;
}

const TABS: { status: EscalationStatus; label: string; empty: string }[] = [
  { status: "pending", label: "Waiting", empty: "Nothing is waiting for a nurse." },
  { status: "resolved", label: "Resolved", empty: "No escalations have been resolved yet." },
];

function Dashboard({ session }: { session: Session }) {
  const { api, timing, signOut } = useApp();
  const [status, setStatus] = useState<EscalationStatus>("pending");
  const [selected, setSelected] = useState<string | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const queue = useEscalationQueue({
    api,
    token: session.token,
    status,
    pollMs: timing.queuePollMs,
    onUnauthorized: signOut,
  });
  const detail = useEscalationDetail({
    api,
    token: session.token,
    threadId: selected,
    onUnauthorized: signOut,
  });

  function select(threadId: string | undefined) {
    setSelected(threadId);
    setResolveError(null);
    setNotice(null);
  }

  const { refresh } = queue;
  const { reload } = detail;
  const resolve = useCallback(
    async (resolution: NurseResolution) => {
      if (selected === undefined) return;
      setSubmitting(true);
      setResolveError(null);
      try {
        await api.resolveEscalation(session.token, selected, resolution);
        setNotice("Conversation resumed. The patient will see the reply shortly.");
      } catch (failure) {
        if (isApiClientError(failure, "unauthorized")) {
          signOut();
          return;
        }
        setResolveError(
          isApiClientError(failure, "conflict")
            ? "This escalation was already resolved, or is being resolved right now. The list has been refreshed."
            : describeError(failure),
        );
      } finally {
        setSubmitting(false);
        refresh();
        reload();
      }
    },
    [api, session.token, selected, signOut, refresh, reload],
  );

  const tab = TABS.find((candidate) => candidate.status === status) ?? TABS[0];
  const waitingCount = status === "pending" ? queue.items?.length : undefined;

  return (
    <AppShell area="Nurse dashboard" session={session} onSignOut={signOut} wide>
      <div className="grid flex-1 gap-4 lg:grid-cols-[22rem_1fr]">
        <section
          aria-label="Escalation queue"
          className={`${selected === undefined ? "" : "hidden lg:block"} self-start overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm`}
        >
          <div role="tablist" aria-label="Queue view" className="flex border-b border-slate-200">
            {TABS.map((candidate) => (
              <button
                key={candidate.status}
                type="button"
                role="tab"
                aria-selected={candidate.status === status}
                onClick={() => {
                  setStatus(candidate.status);
                  select(undefined);
                }}
                className={`flex-1 px-4 py-3 text-sm font-medium ${
                  candidate.status === status
                    ? "border-b-2 border-brand-600 text-brand-900"
                    : "text-slate-600 hover:bg-slate-50"
                }`}
              >
                {candidate.label}
                {candidate.status === "pending" && waitingCount !== undefined
                  ? ` (${waitingCount})`
                  : ""}
              </button>
            ))}
          </div>
          {queue.error ? (
            <p
              role="alert"
              className="border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-900"
            >
              {queue.error}
            </p>
          ) : null}
          <QueueList
            items={queue.items}
            selectedThreadId={selected}
            onSelect={select}
            emptyText={tab?.empty ?? ""}
          />
        </section>

        <section
          aria-label="Escalation detail"
          className={`${selected === undefined ? "hidden lg:block" : ""} overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm`}
        >
          {selected !== undefined ? (
            <button
              type="button"
              onClick={() => select(undefined)}
              className="m-3 text-sm font-medium text-brand-700 underline underline-offset-2 lg:hidden"
            >
              Back to the queue
            </button>
          ) : null}
          {detail.detail ? (
            <DetailPanel
              detail={detail.detail}
              submitting={submitting}
              resolveError={resolveError}
              notice={notice}
              onResolve={resolve}
            />
          ) : (
            <p className="p-6 text-sm text-slate-600">
              {detail.error ?? (detail.loading ? "Loading…" : "Select an escalation to review it.")}
            </p>
          )}
        </section>
      </div>
    </AppShell>
  );
}
