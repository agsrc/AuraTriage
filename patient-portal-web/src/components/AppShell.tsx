import type { ReactNode } from "react";
import type { Session } from "../auth/session";
import { LogoIcon } from "./Icons";

interface AppShellProps {
  area: "Patient portal" | "Nurse dashboard";
  session?: Session | null;
  onSignOut?: () => void;
  /** Wider content column, for the two-pane dashboard. */
  wide?: boolean;
  /** Fill the viewport so only the message list scrolls (chat). */
  fixedHeight?: boolean;
  children: ReactNode;
}

function who(session: Session): string {
  return session.role === "patient" ? `Patient ${session.patientId ?? ""}`.trim() : "Nurse (demo)";
}

export function AppShell({ area, session, onSignOut, wide, fixedHeight, children }: AppShellProps) {
  return (
    <div className={`flex flex-col ${fixedHeight ? "h-dvh" : "min-h-dvh"}`}>
      <header className="shrink-0 border-b border-slate-200 bg-white">
        <div
          className={`mx-auto flex w-full items-center justify-between gap-3 px-4 py-3 ${wide ? "max-w-6xl" : "max-w-3xl"}`}
        >
          <div className="flex items-center gap-3">
            <LogoIcon className="size-8 shrink-0" />
            <div>
              <p className="text-base font-semibold leading-tight">AuraTriage</p>
              <p className="text-xs text-slate-600">{area}</p>
            </div>
          </div>
          {session ? (
            <div className="flex items-center gap-3">
              <span className="hidden rounded-full bg-brand-50 px-3 py-1 text-xs font-medium text-brand-900 sm:inline">
                {who(session)}
              </span>
              <button
                type="button"
                onClick={onSignOut}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Sign out
              </button>
            </div>
          ) : null}
        </div>
      </header>

      <main
        className={`mx-auto flex w-full flex-1 flex-col px-4 py-4 ${fixedHeight ? "min-h-0" : ""} ${wide ? "max-w-6xl" : "max-w-3xl"}`}
      >
        {children}
      </main>

      <footer className="shrink-0 border-t border-slate-200 bg-white px-4 py-2 text-center text-xs text-slate-600">
        Demonstration with synthetic data. Not medical advice and not a medical device. In an
        emergency call 911.
      </footer>
    </div>
  );
}
