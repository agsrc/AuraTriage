import type { ReactNode } from "react";

const TONES = {
  red: "bg-red-50 text-red-900 ring-red-200",
  amber: "bg-amber-50 text-amber-900 ring-amber-200",
  teal: "bg-brand-50 text-brand-900 ring-brand-200",
  slate: "bg-slate-100 text-slate-800 ring-slate-200",
} as const;

export type Tone = keyof typeof TONES;

export function Badge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}
