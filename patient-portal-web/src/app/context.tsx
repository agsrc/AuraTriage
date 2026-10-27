import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react";
import type { ApiClient } from "../api/client";
import { browserStorage, loadSession, type Session, saveSession } from "../auth/session";

export interface Timing {
  /** How often a patient waiting for a nurse checks for the reply. */
  patientPollMs: number;
  /** How often the nurse queue refreshes. */
  queuePollMs: number;
}

export const DEFAULT_TIMING: Timing = { patientPollMs: 3000, queuePollMs: 5000 };

interface AppContextValue {
  api: ApiClient;
  storage: Storage | undefined;
  timing: Timing;
  session: Session | null;
  signIn(session: Session): void;
  signOut(): void;
}

const AppContext = createContext<AppContextValue | null>(null);

export interface AppProvidersProps {
  api: ApiClient;
  /** Defaults to sessionStorage. Tests pass their own or `undefined` to run without storage. */
  storage?: Storage | undefined;
  timing?: Partial<Timing>;
  children: ReactNode;
}

export function AppProviders({
  api,
  storage = browserStorage(),
  timing,
  children,
}: AppProvidersProps) {
  const [session, setSession] = useState<Session | null>(() => loadSession(storage));

  const signIn = useCallback(
    (next: Session) => {
      saveSession(storage, next);
      setSession(next);
    },
    [storage],
  );
  const signOut = useCallback(() => {
    saveSession(storage, null);
    setSession(null);
  }, [storage]);

  const value = useMemo<AppContextValue>(
    () => ({ api, storage, timing: { ...DEFAULT_TIMING, ...timing }, session, signIn, signOut }),
    [api, storage, timing, session, signIn, signOut],
  );
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const value = useContext(AppContext);
  if (value === null) {
    throw new Error("useApp must be used inside <AppProviders>");
  }
  return value;
}
