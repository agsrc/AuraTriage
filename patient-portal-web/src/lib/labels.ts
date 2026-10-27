import type { EscalationReason, RedFlagCategory } from "@contracts";
import { type ApiClientError, isApiClientError } from "../api/client";

export const CATEGORY_LABELS: Record<RedFlagCategory, string> = {
  chest_pain: "Chest pain",
  stroke_signs: "Possible stroke",
  breathing_difficulty: "Breathing difficulty",
  severe_bleeding: "Severe bleeding",
  suicidal_ideation: "Suicidal thoughts",
  anaphylaxis: "Severe allergic reaction",
  loss_of_consciousness: "Loss of consciousness",
};

export const REASON_LABELS: Record<EscalationReason, string> = {
  red_flag: "Red flag",
  high_risk_output: "Assistant asked for review",
};

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const fullFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

export function formatTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : timeFormat.format(date);
}

export function formatFull(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : fullFormat.format(date);
}

/** Plain-language text for a failed request. Never includes anything the user typed. */
export function describeError(error: unknown): string {
  if (!isApiClientError(error)) {
    return "Something went wrong. Please try again.";
  }
  return messageFor(error);
}

function messageFor(error: ApiClientError): string {
  switch (error.code) {
    case "network":
      return "Could not reach the server. Check your connection and try again.";
    case "llm_unavailable":
      return "The assistant is unavailable right now. Please try again in a moment.";
    case "validation_error":
      return "That could not be sent. Messages must be between 1 and 2000 characters.";
    case "conflict":
      return error.message;
    case "not_found":
      return "That conversation could not be found.";
    case "forbidden":
      return "You do not have access to that.";
    case "unauthorized":
      return "Your session has ended. Please sign in again.";
    default:
      return "Something went wrong on our side. Please try again.";
  }
}
