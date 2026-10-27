// HTTP contract between the web portal and the orchestrator. Keep in sync with docs/contracts.md.
// This file has no Node-only imports so the web workspace can reuse the types later.
import { z } from "zod";

export const PATIENT_ID_PATTERN = /^P-\d{4}$/;
export const SLOT_ID_PATTERN = /^S-\d{4}$/;

export const RED_FLAG_CATEGORIES = [
  "chest_pain",
  "stroke_signs",
  "breathing_difficulty",
  "severe_bleeding",
  "suicidal_ideation",
  "anaphylaxis",
  "loss_of_consciousness",
] as const;
export const RedFlagCategorySchema = z.enum(RED_FLAG_CATEGORIES);
export type RedFlagCategory = z.infer<typeof RedFlagCategorySchema>;

export const RoleSchema = z.enum(["patient", "nurse"]);
export type Role = z.infer<typeof RoleSchema>;

export const EscalationReasonSchema = z.enum(["red_flag", "high_risk_output"]);
export type EscalationReason = z.infer<typeof EscalationReasonSchema>;

// --- requests

export const DemoLoginRequestSchema = z
  .strictObject({
    role: RoleSchema,
    patientId: z.string().regex(PATIENT_ID_PATTERN).optional(),
  })
  .refine((value) => value.role === "nurse" || value.patientId !== undefined, {
    message: "patientId is required for patients",
    path: ["patientId"],
  });
export type DemoLoginRequest = z.infer<typeof DemoLoginRequestSchema>;

export const ChatRequestSchema = z.strictObject({
  threadId: z.uuid().optional(),
  message: z.string().trim().min(1).max(2000),
});
export type ChatRequest = z.infer<typeof ChatRequestSchema>;

export const NurseResolutionSchema = z
  .strictObject({
    decision: z.enum(["approve", "edit", "reject"]),
    note: z.string().trim().max(1000).optional(),
    editedReply: z.string().trim().min(1).max(2000).optional(),
  })
  .refine((value) => value.decision !== "edit" || value.editedReply !== undefined, {
    message: "editedReply is required when decision is edit",
    path: ["editedReply"],
  });
export type NurseResolution = z.infer<typeof NurseResolutionSchema>;

export const EscalationStatusSchema = z.enum(["pending", "resolved"]);
export type EscalationStatus = z.infer<typeof EscalationStatusSchema>;

// --- responses
// Schemas, not just types: the web client parses every response with them, so a server that
// drifts from this contract fails loudly instead of rendering garbage.

export const DemoLoginResponseSchema = z.object({
  token: z.string(),
  role: RoleSchema,
  patientId: z.string().optional(),
});
export type DemoLoginResponse = z.infer<typeof DemoLoginResponseSchema>;

export const ChatMessageSchema = z.object({
  id: z.string(),
  role: z.enum(["patient", "assistant", "nurse", "system"]),
  content: z.string(),
  createdAt: z.string(),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const ThreadStatusSchema = z.enum(["responded", "awaiting_nurse"]);
export type ThreadStatus = z.infer<typeof ThreadStatusSchema>;

export const ChatResponseSchema = z.object({
  threadId: z.string(),
  status: ThreadStatusSchema,
  messages: z.array(ChatMessageSchema),
  emergencyNotice: z.string().optional(),
});
export type ChatResponse = z.infer<typeof ChatResponseSchema>;

export const ThreadResponseSchema = z.object({
  threadId: z.string(),
  status: ThreadStatusSchema,
  messages: z.array(ChatMessageSchema),
});
export type ThreadResponse = z.infer<typeof ThreadResponseSchema>;

export const EscalationSummarySchema = z.object({
  threadId: z.string(),
  patientId: z.string(),
  reason: EscalationReasonSchema,
  categories: z.array(RedFlagCategorySchema),
  status: EscalationStatusSchema,
  createdAt: z.string(),
});
export type EscalationSummary = z.infer<typeof EscalationSummarySchema>;

export const EscalationDetailSchema = EscalationSummarySchema.extend({
  transcript: z.array(ChatMessageSchema),
  concern: z.string().optional(),
  proposedReply: z.string().optional(),
});
export type EscalationDetail = z.infer<typeof EscalationDetailSchema>;

export const ResolveResponseSchema = z.object({
  threadId: z.string(),
  status: z.literal("resolved"),
});
export type ResolveResponse = z.infer<typeof ResolveResponseSchema>;

export const ErrorCodeSchema = z.enum([
  "unauthorized",
  "forbidden",
  "not_found",
  "validation_error",
  "conflict",
  "llm_unavailable",
  "internal",
]);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export const ApiErrorSchema = z.object({
  error: z.object({ code: ErrorCodeSchema, message: z.string() }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;
