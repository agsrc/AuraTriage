import type { NurseResolution } from "@contracts";
import { type FormEvent, useState } from "react";

type Decision = NurseResolution["decision"];

interface ResolveFormProps {
  /** True when the assistant drafted a reply that "approve" would send. */
  hasDraft: boolean;
  submitting: boolean;
  onSubmit(resolution: NurseResolution): Promise<void>;
}

const MAX_REPLY = 2000;
const MAX_NOTE = 1000;

export function ResolveForm({ hasDraft, submitting, onSubmit }: ResolveFormProps) {
  const [decision, setDecision] = useState<Decision>("approve");
  const [editedReply, setEditedReply] = useState("");
  const [note, setNote] = useState("");

  const reply = editedReply.trim();
  const cleanNote = note.trim();
  const incomplete = decision === "edit" && reply === "";

  const options: { value: Decision; label: string; help: string }[] = [
    {
      value: "approve",
      label: "Approve",
      help: hasDraft
        ? "Send the assistant's reply to the patient as written."
        : "Confirm the emergency guidance. The patient sees a standard message that a nurse will follow up.",
    },
    { value: "edit", label: "Edit and send", help: "Write the reply the patient will see." },
    {
      value: "reject",
      label: "Reject",
      help: "Withdraw the reply. The patient is told the care team will contact them.",
    },
  ];

  function submit(event: FormEvent) {
    event.preventDefault();
    if (incomplete || submitting) return;
    void onSubmit({
      decision,
      ...(cleanNote === "" ? {} : { note: cleanNote }),
      ...(decision === "edit" ? { editedReply: reply } : {}),
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4" aria-label="Resolve this escalation">
      <fieldset className="space-y-2" disabled={submitting}>
        <legend className="mb-1 text-sm font-semibold">Decision</legend>
        {options.map((option) => (
          <label
            key={option.value}
            className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 px-3 py-2.5 has-[:checked]:border-brand-600 has-[:checked]:bg-brand-50"
          >
            <input
              type="radio"
              name="decision"
              value={option.value}
              checked={decision === option.value}
              onChange={() => setDecision(option.value)}
              className="mt-1 accent-brand-600"
            />
            <span>
              <span className="block text-sm font-medium">{option.label}</span>
              <span className="block text-sm text-slate-600">{option.help}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {decision === "edit" ? (
        <div>
          <label htmlFor="edited-reply" className="block text-sm font-medium">
            Reply to the patient
          </label>
          <textarea
            id="edited-reply"
            rows={4}
            required
            maxLength={MAX_REPLY}
            value={editedReply}
            disabled={submitting}
            onChange={(event) => setEditedReply(event.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
          />
        </div>
      ) : null}

      <div>
        <label htmlFor="nurse-note" className="block text-sm font-medium">
          Internal note{" "}
          <span className="font-normal text-slate-600">(optional, never shown to the patient)</span>
        </label>
        <textarea
          id="nurse-note"
          rows={2}
          maxLength={MAX_NOTE}
          value={note}
          disabled={submitting}
          onChange={(event) => setNote(event.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
        />
      </div>

      <button
        type="submit"
        disabled={incomplete || submitting}
        className="rounded-lg bg-brand-600 px-4 py-2.5 font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting ? "Resuming…" : "Resume conversation"}
      </button>
    </form>
  );
}
