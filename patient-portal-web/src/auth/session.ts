import { RoleSchema } from "@contracts";
import { z } from "zod";

// The token lives in sessionStorage: it dies with the tab and is never shared between tabs, which is
// also what lets one browser hold a patient tab and a nurse tab at once. Demo-grade; a real
// deployment would use an HttpOnly cookie.

const SessionSchema = z.object({
  token: z.string().min(1),
  role: RoleSchema,
  patientId: z.string().optional(),
});
export type Session = z.infer<typeof SessionSchema>;

const SESSION_KEY = "aura.session";
const THREAD_KEY = "aura.thread";

/** Storage can be missing or throw (private windows, blocked site data). The app must still work. */
export function browserStorage(): Storage | undefined {
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}

function read(storage: Storage | undefined, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function write(storage: Storage | undefined, key: string, value: string | null): void {
  try {
    if (value === null) storage?.removeItem(key);
    else storage?.setItem(key, value);
  } catch {
    // Not persisting is acceptable; the in-memory state still works.
  }
}

export function loadSession(storage: Storage | undefined): Session | null {
  const raw = read(storage, SESSION_KEY);
  if (raw === null) return null;
  try {
    const parsed = SessionSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function saveSession(storage: Storage | undefined, session: Session | null): void {
  write(storage, SESSION_KEY, session === null ? null : JSON.stringify(session));
  if (session === null) write(storage, THREAD_KEY, null);
}

export function loadThreadId(storage: Storage | undefined): string | undefined {
  return read(storage, THREAD_KEY) ?? undefined;
}

export function saveThreadId(storage: Storage | undefined, threadId: string | undefined): void {
  write(storage, THREAD_KEY, threadId ?? null);
}
