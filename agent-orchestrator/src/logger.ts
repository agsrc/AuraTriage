import { type DestinationStream, type Logger, pino } from "pino";

/**
 * Defence in depth only. The rule is that PHI is never passed to the logger in the first place:
 * log opaque IDs, event names, counts, durations and error codes. These paths catch a slip.
 */
export const REDACT_PATHS = [
  "authorization",
  "token",
  "req.headers.authorization",
  "headers.authorization",
  "message",
  "content",
  "transcript",
  "name",
  "patientName",
  "dob",
  "dateOfBirth",
  "address",
  "phone",
  "email",
  "*.message",
  "*.content",
  "*.name",
  "*.patientName",
  "*.dob",
  "*.dateOfBirth",
  "*.address",
  "*.phone",
  "*.email",
];

export function createLogger(level: string, destination?: DestinationStream): Logger {
  return pino(
    {
      level,
      base: { service: "agent-orchestrator" },
      redact: { paths: REDACT_PATHS, censor: "[REDACTED]" },
    },
    destination,
  );
}

export type { Logger };
