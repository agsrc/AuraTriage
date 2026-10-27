import type { ReactNode } from "react";

interface LoginCardProps {
  title: string;
  description: string;
  children: ReactNode;
}

/** The centered card both sign-in screens use. */
export function LoginCard({ title, description, children }: LoginCardProps) {
  return (
    <div className="m-auto w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="mt-1 text-sm text-slate-600">{description}</p>
      <div className="mt-5">{children}</div>
      <p className="mt-5 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
        This is a demo sign-in. It has no password and only offers synthetic data.
      </p>
    </div>
  );
}
