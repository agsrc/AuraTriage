import type { ChatMessage, EscalationDetail, NurseResolution } from "@contracts";
import { Badge } from "../components/Badge";
import { CATEGORY_LABELS, formatFull, REASON_LABELS } from "../lib/labels";
import { ResolveForm } from "./ResolveForm";

const ROLE_LABELS: Record<ChatMessage["role"], string> = {
  patient: "Patient",
  assistant: "Assistant",
  system: "Emergency notice shown to the patient",
  nurse: "Nurse note",
};

const ROLE_STYLES: Record<ChatMessage["role"], string> = {
  patient: "border-slate-200 bg-white",
  assistant: "border-slate-200 bg-slate-50",
  system: "border-red-200 bg-red-50 text-red-900",
  nurse: "border-brand-200 bg-brand-50 text-brand-900",
};

interface DetailPanelProps {
  detail: EscalationDetail;
  submitting: boolean;
  resolveError: string | null;
  notice: string | null;
  onResolve(resolution: NurseResolution): Promise<void>;
}

export function DetailPanel({
  detail,
  submitting,
  resolveError,
  notice,
  onResolve,
}: DetailPanelProps) {
  const pending = detail.status === "pending";
  return (
    <article
      aria-label={`Escalation for patient ${detail.patientId}`}
      className="space-y-6 p-4 sm:p-6"
    >
      <header>
        <h2 className="text-lg font-semibold">Patient {detail.patientId}</h2>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Badge tone={detail.reason === "red_flag" ? "red" : "amber"}>
            {REASON_LABELS[detail.reason]}
          </Badge>
          {detail.categories.map((category) => (
            <Badge key={category} tone="slate">
              {CATEGORY_LABELS[category]}
            </Badge>
          ))}
          <Badge tone={pending ? "amber" : "teal"}>
            {pending ? "Waiting for a nurse" : "Resolved"}
          </Badge>
        </div>
        <p className="mt-2 text-xs text-slate-600">Escalated {formatFull(detail.createdAt)}</p>
      </header>

      <section aria-labelledby="why-heading">
        <h3 id="why-heading" className="text-sm font-semibold">
          Why this was escalated
        </h3>
        {detail.reason === "red_flag" ? (
          <p className="mt-1 text-sm text-slate-700">
            The message matched an automatic red-flag pattern. The patient was shown emergency
            guidance immediately and their conversation is paused until you decide.
          </p>
        ) : (
          <p className="mt-1 text-sm text-slate-700">
            The assistant asked for a nurse review before replying.
          </p>
        )}
        {detail.concern ? (
          <p className="mt-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
            <span className="font-medium">Assistant's concern: </span>
            {detail.concern}
          </p>
        ) : null}
        {detail.proposedReply ? (
          <blockquote className="mt-2 rounded-lg border-l-4 border-brand-600 bg-slate-50 p-3 text-sm">
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-600">
              Reply the assistant wants to send (withheld until you decide)
            </p>
            {detail.proposedReply}
          </blockquote>
        ) : null}
      </section>

      <section aria-labelledby="transcript-heading">
        <h3 id="transcript-heading" className="text-sm font-semibold">
          Conversation
        </h3>
        <ol className="mt-2 space-y-2">
          {detail.transcript.map((message) => (
            <li
              key={message.id}
              className={`rounded-lg border p-3 text-sm ${ROLE_STYLES[message.role]}`}
            >
              <p className="text-xs font-medium text-slate-600">{ROLE_LABELS[message.role]}</p>
              <p className="mt-0.5 whitespace-pre-wrap break-words">{message.content}</p>
            </li>
          ))}
        </ol>
      </section>

      {notice ? (
        <p role="status" className="rounded-lg bg-brand-50 p-3 text-sm text-brand-900">
          {notice}
        </p>
      ) : null}

      {pending ? (
        <section aria-labelledby="decision-heading">
          <h3 id="decision-heading" className="sr-only">
            Decision
          </h3>
          {resolveError ? (
            <p role="alert" className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-900">
              {resolveError}
            </p>
          ) : null}
          <ResolveForm
            hasDraft={detail.proposedReply !== undefined}
            submitting={submitting}
            onSubmit={onResolve}
          />
        </section>
      ) : (
        <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
          This escalation is resolved. The patient's conversation has continued.
        </p>
      )}
    </article>
  );
}
