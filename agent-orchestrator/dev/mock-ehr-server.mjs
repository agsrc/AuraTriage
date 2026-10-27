// Dev and test stand-in for the Java EHR MCP server: same three tools, same JSON shapes, same
// error messages, tiny synthetic data. It lets the orchestrator and web portal run on a machine
// without JDK 25 (EHR_MCP_SERVER=mock). It is not used in production.
//
// stdout is the MCP channel: never console.log here.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const PATIENT_ID = /^P-\d{4}$/;
const SLOT_ID = /^S-\d{4}$/;
const SPECIALTY = /^[a-z_]{1,40}$/;
const MAX_SLOTS = 10;

const PROVIDERS = [
  { id: "D-2001", name: "Dr. Imogen Hartley", specialty: "primary_care" },
  { id: "D-2002", name: "Dr. Kwame Bellweather", specialty: "primary_care" },
  { id: "D-2003", name: "Dr. Soraya Lindqvist", specialty: "cardiology" },
  { id: "D-2004", name: "Dr. Tobias Wren", specialty: "cardiology" },
  { id: "D-2005", name: "Dr. Marguerite Alder", specialty: "dermatology" },
  { id: "D-2006", name: "Dr. Nikhil Prasad-Orme", specialty: "neurology" },
];

const encounter = (date, type, summary) => ({ date, type, summary });
const trend = (metric, direction) => ({ metric, direction, windowSize: 3 });

// Ready-made summaries in the shape the Java server returns. No name, date of birth or address.
const HISTORIES = {
  "P-1001": {
    patientId: "P-1001",
    ageBand: "50-59",
    conditions: ["hypertension", "type_2_diabetes"],
    medications: ["lisinopril 10 mg daily", "metformin 500 mg twice daily"],
    allergies: ["penicillin"],
    recentEncounters: [
      encounter("2026-06-20", "primary_care_visit", "Antihypertensive dose adjusted."),
      encounter("2026-06-02", "cardiology_consult", "Home readings trending up, ECG normal."),
      encounter(
        "2026-02-10",
        "primary_care_visit",
        "Blood pressure mildly elevated, adherence counselling.",
      ),
      encounter("2025-11-18", "lab_review", "Repeat labs reviewed, no change."),
      encounter("2025-11-04", "primary_care_visit", "Routine diabetes review, HbA1c 7.2 percent."),
    ],
    episodesOfCare: [
      { label: "primary_care_visit", start: "2025-11-04", end: "2025-11-18", encounterCount: 2 },
      { label: "primary_care_visit", start: "2026-02-10", end: "2026-02-10", encounterCount: 1 },
      { label: "cardiology_consult", start: "2026-06-02", end: "2026-06-20", encounterCount: 2 },
    ],
    vitalsTrends: [trend("systolic_bp", "rising"), trend("heart_rate", "stable")],
  },
  "P-1002": {
    patientId: "P-1002",
    ageBand: "30-39",
    conditions: ["asthma"],
    medications: ["albuterol inhaler as needed"],
    allergies: [],
    recentEncounters: [
      encounter("2026-08-05", "primary_care_visit", "Annual physical, no concerns."),
      encounter(
        "2026-01-20",
        "primary_care_visit",
        "Asthma follow-up, inhaler technique reviewed.",
      ),
      encounter("2026-01-12", "urgent_care_visit", "Wheeze after a cold, nebuliser given."),
    ],
    episodesOfCare: [
      { label: "urgent_care_visit", start: "2026-01-12", end: "2026-01-20", encounterCount: 2 },
      { label: "primary_care_visit", start: "2026-08-05", end: "2026-08-05", encounterCount: 1 },
    ],
    vitalsTrends: [trend("systolic_bp", "stable"), trend("heart_rate", "stable")],
  },
  "P-1003": {
    patientId: "P-1003",
    ageBand: "60-69",
    conditions: ["atrial_fibrillation", "hypertension"],
    medications: ["apixaban 5 mg twice daily", "metoprolol 50 mg daily"],
    allergies: ["sulfa"],
    recentEncounters: [
      encounter("2026-09-01", "primary_care_visit", "Flu vaccine and medication reconciliation."),
      encounter("2026-07-14", "cardiology_consult", "Palpitations settled."),
      encounter("2026-03-24", "lab_review", "Renal function stable on apixaban."),
      encounter(
        "2026-03-03",
        "cardiology_consult",
        "Rate control reviewed, anticoagulation continued.",
      ),
    ],
    episodesOfCare: [
      { label: "cardiology_consult", start: "2026-03-03", end: "2026-03-24", encounterCount: 2 },
      { label: "cardiology_consult", start: "2026-07-14", end: "2026-07-14", encounterCount: 1 },
      { label: "primary_care_visit", start: "2026-09-01", end: "2026-09-01", encounterCount: 1 },
    ],
    vitalsTrends: [trend("systolic_bp", "stable"), trend("heart_rate", "falling")],
  },
  "P-1004": {
    patientId: "P-1004",
    ageBand: "30-39",
    conditions: ["migraine"],
    medications: ["sumatriptan 50 mg as needed"],
    allergies: [],
    recentEncounters: [
      encounter("2026-09-22", "primary_care_visit", "Headache diary reviewed."),
      encounter("2026-05-12", "neurology_consult", "Frequency down to two per month."),
      encounter("2026-04-09", "neurology_consult", "Migraine with aura, triptan prescribed."),
    ],
    episodesOfCare: [
      { label: "neurology_consult", start: "2026-04-09", end: "2026-05-12", encounterCount: 2 },
      { label: "primary_care_visit", start: "2026-09-22", end: "2026-09-22", encounterCount: 1 },
    ],
    vitalsTrends: [trend("systolic_bp", "stable"), trend("heart_rate", "stable")],
  },
  "P-1005": {
    patientId: "P-1005",
    ageBand: "90+",
    conditions: ["osteoarthritis", "hypertension"],
    medications: ["paracetamol 1 g as needed", "amlodipine 5 mg daily"],
    allergies: [],
    recentEncounters: [
      encounter("2026-08-18", "primary_care_visit", "Blood pressure review."),
      encounter("2026-04-30", "physiotherapy_referral", "Referral placed."),
      encounter("2026-04-14", "primary_care_visit", "Home visit, mobility assessment."),
      encounter("2026-02-02", "primary_care_visit", "Knee pain review."),
    ],
    episodesOfCare: [
      { label: "primary_care_visit", start: "2026-02-02", end: "2026-02-02", encounterCount: 1 },
      { label: "primary_care_visit", start: "2026-04-14", end: "2026-04-30", encounterCount: 2 },
      { label: "primary_care_visit", start: "2026-08-18", end: "2026-08-18", encounterCount: 1 },
    ],
    vitalsTrends: [trend("systolic_bp", "stable"), trend("heart_rate", "stable")],
  },
};

// Weekday slots for the next five working days, three per day per provider, like the Java seed.
function buildSlots() {
  const slots = [];
  let sequence = 1000;
  const now = new Date();
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  for (const provider of PROVIDERS) {
    let day = todayUtc;
    let workingDays = 0;
    while (workingDays < 5) {
      day += 86_400_000;
      const weekday = new Date(day).getUTCDay();
      if (weekday === 0 || weekday === 6) continue;
      workingDays++;
      for (const [hour, minute] of [
        [9, 0],
        [10, 30],
        [14, 0],
      ]) {
        sequence++;
        slots.push({
          slotId: `S-${String(sequence).padStart(4, "0")}`,
          providerId: provider.id,
          start: new Date(day + hour * 3_600_000 + minute * 60_000),
        });
      }
    }
  }
  return slots;
}

const SLOTS = buildSlots();
const bookings = new Map();
let appointmentSequence = 0;

const ok = (value) => ({ content: [{ type: "text", text: JSON.stringify(value) }] });
const fail = (message) => ({ isError: true, content: [{ type: "text", text: message }] });

const server = new McpServer({ name: "mock-ehr-server", version: "0.1.0" });

server.registerTool(
  "get_patient_history",
  {
    description:
      "Read-only. Returns a minimum-necessary clinical summary for one patient: age band, conditions, medications, " +
      "allergies, the 5 most recent encounters, episodes of care and vitals trends. Never returns name, date of birth or address.",
    inputSchema: { patientId: z.string().describe("Patient ID in the form P-1234") },
  },
  async ({ patientId }) => {
    if (!PATIENT_ID.test(patientId)) return fail("patientId must look like P-1234");
    const history = HISTORIES[patientId];
    return history ? ok(history) : fail("No patient with that ID");
  },
);

server.registerTool(
  "check_provider_availability",
  {
    description:
      "Read-only. Lists the earliest open appointment slots (at most 10, soonest first) for a specialty. " +
      "Valid specialties: primary_care, cardiology, dermatology, neurology.",
    inputSchema: {
      specialty: z
        .string()
        .describe("Specialty, one of: primary_care, cardiology, dermatology, neurology"),
    },
  },
  async ({ specialty }) => {
    const normalized = specialty.trim().toLowerCase().replaceAll(" ", "_").replaceAll("-", "_");
    if (!SPECIALTY.test(normalized)) return fail("specialty must be a name such as primary_care");
    const providers = PROVIDERS.filter((provider) => provider.specialty === normalized);
    const open = SLOTS.filter(
      (slot) =>
        providers.some((provider) => provider.id === slot.providerId) && !bookings.has(slot.slotId),
    )
      .sort((a, b) => a.start - b.start || a.slotId.localeCompare(b.slotId))
      .slice(0, MAX_SLOTS)
      .map((slot) => ({
        slotId: slot.slotId,
        providerId: slot.providerId,
        providerName: providers.find((provider) => provider.id === slot.providerId).name,
        start: slot.start.toISOString().replace(".000Z", "Z"),
        durationMinutes: 30,
      }));
    return ok({ specialty: normalized, slots: open });
  },
);

server.registerTool(
  "book_appointment",
  {
    description:
      "STATE-CHANGING. Books one open slot for a patient. Call only after the patient has explicitly confirmed " +
      "this exact slot. Safe to repeat for the same patient and slot.",
    inputSchema: {
      patientId: z.string().describe("Patient ID in the form P-1234"),
      slotId: z
        .string()
        .describe("Slot ID in the form S-1234, taken from check_provider_availability"),
    },
  },
  async ({ patientId, slotId }) => {
    if (!PATIENT_ID.test(patientId)) return fail("patientId must look like P-1234");
    if (!SLOT_ID.test(slotId)) return fail("slotId must look like S-1234");
    if (!HISTORIES[patientId]) return fail("No patient with that ID");
    if (!SLOTS.some((slot) => slot.slotId === slotId))
      return ok({ status: "slot_not_found", slotId });
    if (!bookings.has(slotId)) {
      appointmentSequence++;
      bookings.set(slotId, {
        appointmentId: `A-${String(appointmentSequence).padStart(4, "0")}`,
        patientId,
      });
    }
    const holder = bookings.get(slotId);
    return holder.patientId === patientId
      ? ok({ status: "booked", appointmentId: holder.appointmentId, slotId })
      : ok({ status: "slot_taken", slotId });
  },
);

await server.connect(new StdioServerTransport());
