import { useEffect } from "react";
import { useApp } from "../app/context";
import type { Session } from "../auth/session";
import { AppShell } from "../components/AppShell";
import { AlertIcon, ClockIcon } from "../components/Icons";
import { Composer } from "./Composer";
import { MessageList } from "./MessageList";
import { PatientLogin } from "./PatientLogin";
import { usePatientChat } from "./usePatientChat";

const EXAMPLES = [
  "I have a mild cough and a sore throat",
  "I'd like to book a cardiology appointment",
  "I feel dizzy and have a headache",
  "I have chest pain",
];

export function PatientPage() {
  const { session } = useApp();

  useEffect(() => {
    document.title = "AuraTriage · Patient portal";
  }, []);

  if (session?.role !== "patient" || session.patientId === undefined) {
    return <PatientLogin />;
  }
  return <PatientChatView session={session} />;
}

function EmergencyBanner() {
  return (
    <div className="flex items-center justify-between gap-3 bg-red-700 px-4 py-2 text-sm text-white">
      <span className="flex items-center gap-2 font-medium">
        <AlertIcon className="size-5 shrink-0" />
        Medical emergency? Call 911 now.
      </span>
      <a
        href="tel:911"
        className="shrink-0 whitespace-nowrap rounded-md bg-white px-3 py-1.5 font-semibold text-red-800 hover:bg-red-50"
      >
        Call 911
      </a>
    </div>
  );
}

function HoldBanner() {
  return (
    <div
      role="status"
      className="flex items-start gap-3 border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
    >
      <ClockIcon className="mt-0.5 size-5 shrink-0" />
      <p>
        <span className="font-semibold">A nurse is reviewing your message.</span> Their reply will
        appear here. You do not need to refresh the page.
      </p>
    </div>
  );
}

function PatientChatView({ session }: { session: Session }) {
  const { api, storage, timing, signOut } = useApp();
  const chat = usePatientChat({
    api,
    token: session.token,
    storage,
    pollMs: timing.patientPollMs,
    onUnauthorized: signOut,
  });
  const waiting = chat.phase === "awaiting_nurse";

  const emptyState = (
    <div className="mx-auto max-w-md py-8 text-center">
      <h1 className="text-xl font-semibold">How can I help today?</h1>
      <p className="mt-2 text-sm text-slate-600">
        Describe a symptom or ask to book an appointment. A nurse reviews anything that sounds
        urgent.
      </p>
      <p className="mt-6 text-xs font-medium uppercase tracking-wide text-slate-600">
        Demo examples
      </p>
      <ul className="mt-2 space-y-2">
        {EXAMPLES.map((example) => (
          <li key={example}>
            <button
              type="button"
              disabled={chat.phase !== "idle" || chat.restoring}
              onClick={() => void chat.send(example)}
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-left text-sm hover:border-brand-600 hover:bg-brand-50 disabled:opacity-50"
            >
              {example}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );

  return (
    <AppShell area="Patient portal" session={session} onSignOut={signOut} fixedHeight>
      <section
        aria-label="Chat with the assistant"
        className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
      >
        {chat.emergency ? <EmergencyBanner /> : null}
        {waiting ? <HoldBanner /> : null}
        <MessageList
          messages={chat.messages}
          typing={chat.phase === "sending"}
          emptyState={chat.restoring ? null : emptyState}
        />
        {chat.error ? (
          <p
            role="alert"
            className="border-t border-red-200 bg-red-50 px-4 py-2 text-sm text-red-900"
          >
            {chat.error}
          </p>
        ) : null}
        <Composer
          disabled={chat.phase !== "idle" || chat.restoring}
          placeholder={waiting ? "Waiting for a nurse to respond…" : "Type your message"}
          onSend={chat.send}
        />
      </section>
      {chat.messages.length > 0 && chat.phase === "idle" ? (
        <button
          type="button"
          onClick={chat.startOver}
          className="mt-3 self-center text-sm font-medium text-brand-700 underline underline-offset-2 hover:text-brand-900"
        >
          Start a new conversation
        </button>
      ) : null}
    </AppShell>
  );
}
