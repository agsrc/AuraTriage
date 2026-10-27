import { type FormEvent, useState } from "react";
import { useApp } from "../app/context";
import { AppShell } from "../components/AppShell";
import { LoginCard } from "../components/LoginCard";
import { describeError } from "../lib/labels";

/** The synthetic patients the demo server knows. The server rejects any other ID. */
const DEMO_PATIENT_IDS = ["P-1001", "P-1002", "P-1003", "P-1004", "P-1005"];

export function PatientLogin() {
  const { api, signIn } = useApp();
  const [patientId, setPatientId] = useState(DEMO_PATIENT_IDS[0] ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await api.demoLogin({ role: "patient", patientId });
      signIn({
        token: response.token,
        role: response.role,
        patientId: response.patientId ?? patientId,
      });
    } catch (failure) {
      setError(describeError(failure));
      setBusy(false);
    }
  }

  return (
    <AppShell area="Patient portal">
      <LoginCard
        title="Welcome to AuraTriage"
        description="Chat with our assistant about symptoms or book an appointment. Pick a demo patient to continue."
      >
        <form onSubmit={submit} className="space-y-4">
          <fieldset className="space-y-2">
            <legend className="mb-1 text-sm font-medium">Demo patient</legend>
            {DEMO_PATIENT_IDS.map((id) => (
              <label
                key={id}
                className="flex cursor-pointer items-center gap-3 rounded-lg border border-slate-200 px-3 py-2 text-sm has-[:checked]:border-brand-600 has-[:checked]:bg-brand-50"
              >
                <input
                  type="radio"
                  name="patient"
                  value={id}
                  checked={patientId === id}
                  onChange={() => setPatientId(id)}
                  className="accent-brand-600"
                />
                Patient {id}
              </label>
            ))}
          </fieldset>

          {error ? (
            <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-900">
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-brand-600 px-4 py-2.5 font-medium text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {busy ? "Signing in…" : "Continue"}
          </button>
        </form>
      </LoginCard>
    </AppShell>
  );
}
