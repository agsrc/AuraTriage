import { useState } from "react";
import { useApp } from "../app/context";
import { AppShell } from "../components/AppShell";
import { LoginCard } from "../components/LoginCard";
import { describeError } from "../lib/labels";

export function NurseLogin() {
  const { api, signIn } = useApp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const response = await api.demoLogin({ role: "nurse" });
      signIn({ token: response.token, role: response.role });
    } catch (failure) {
      setError(describeError(failure));
      setBusy(false);
    }
  }

  return (
    <AppShell area="Nurse dashboard">
      <LoginCard
        title="Nurse dashboard"
        description="Review conversations that were escalated by a red flag or by the assistant, then decide how they continue."
      >
        {error ? (
          <p role="alert" className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-900">
            {error}
          </p>
        ) : null}
        <button
          type="button"
          disabled={busy}
          onClick={() => void submit()}
          className="w-full rounded-lg bg-brand-600 px-4 py-2.5 font-medium text-white hover:bg-brand-700 disabled:opacity-60"
        >
          {busy ? "Signing in…" : "Sign in as demo nurse"}
        </button>
      </LoginCard>
    </AppShell>
  );
}
