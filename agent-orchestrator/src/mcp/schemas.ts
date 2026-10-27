import { z } from "zod";

// Shapes returned by the EHR MCP tools. Strict on purpose: if the Java server ever adds a field
// (say a name or date of birth), parsing fails and the tests catch it. See docs/contracts.md.

export const PatientHistorySummarySchema = z.strictObject({
  patientId: z.string(),
  ageBand: z.string(),
  conditions: z.array(z.string()),
  medications: z.array(z.string()),
  allergies: z.array(z.string()),
  recentEncounters: z.array(
    z.strictObject({ date: z.string(), type: z.string(), summary: z.string() }),
  ),
  episodesOfCare: z.array(
    z.strictObject({
      label: z.string(),
      start: z.string(),
      end: z.string(),
      encounterCount: z.number().int(),
    }),
  ),
  vitalsTrends: z.array(
    z.strictObject({
      metric: z.enum(["systolic_bp", "heart_rate"]),
      direction: z.enum(["rising", "falling", "stable"]),
      windowSize: z.number().int(),
    }),
  ),
});
export type PatientHistorySummary = z.infer<typeof PatientHistorySummarySchema>;

export const SlotViewSchema = z.strictObject({
  slotId: z.string(),
  providerId: z.string(),
  providerName: z.string(),
  start: z.string(),
  durationMinutes: z.number().int(),
});

export const AvailabilityResultSchema = z.strictObject({
  specialty: z.string(),
  slots: z.array(SlotViewSchema),
});
export type AvailabilityResult = z.infer<typeof AvailabilityResultSchema>;

export const BookingResultSchema = z.strictObject({
  status: z.enum(["booked", "slot_taken", "slot_not_found"]),
  appointmentId: z.string().optional(),
  slotId: z.string(),
});
export type BookingResult = z.infer<typeof BookingResultSchema>;
