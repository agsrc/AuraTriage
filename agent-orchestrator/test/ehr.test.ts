import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  bindSessionPatient,
  connectEhr,
  EHR_TOOL,
  type EhrConnection,
  SESSION_PLACEHOLDER,
} from "../src/mcp/ehr.js";
import {
  AvailabilityResultSchema,
  BookingResultSchema,
  PatientHistorySummarySchema,
} from "../src/mcp/schemas.js";

const MOCK_EHR = path.resolve(import.meta.dirname, "..", "dev", "mock-ehr-server.mjs");

function textOf(output: unknown): string {
  if (typeof output === "string") return output;
  if (Array.isArray(output)) {
    return output
      .map((block) => (typeof block === "string" ? block : (block?.text ?? "")))
      .join("");
  }
  return JSON.stringify(output);
}

const session = (patientId: string) => ({ configurable: { patientId } });

describe("bindSessionPatient (hook in isolation)", () => {
  const request = (name: string) => ({
    serverName: "ehr",
    name,
    args: { patientId: SESSION_PLACEHOLDER },
  });

  it("replaces the patient ID of patient-scoped tools with the session's", () => {
    expect(
      bindSessionPatient(request("get_patient_history"), undefined, session("P-1003")),
    ).toEqual({
      args: { patientId: "P-1003" },
    });
    expect(bindSessionPatient(request("book_appointment"), undefined, session("P-1003"))).toEqual({
      args: { patientId: "P-1003" },
    });
  });

  it("leaves other tools alone, with or without a session", () => {
    expect(
      bindSessionPatient(request("check_provider_availability"), undefined, {}),
    ).toBeUndefined();
  });

  it("fails closed when no valid patient is bound", () => {
    expect(() => bindSessionPatient(request("get_patient_history"), undefined, {})).toThrow(
      /No signed-in patient/,
    );
    expect(() =>
      bindSessionPatient(request("book_appointment"), undefined, session("not-an-id")),
    ).toThrow();
    expect(() =>
      bindSessionPatient(request("get_patient_history"), undefined, { configurable: {} }),
    ).toThrow();
  });
});

describe("EHR connection over stdio (mock server)", () => {
  let ehr: EhrConnection;

  beforeAll(async () => {
    ehr = await connectEhr({ command: process.execPath, args: [MOCK_EHR] });
  });

  afterAll(async () => {
    await ehr.close();
  });

  it("exposes the three tools with the ehr_ prefix", () => {
    expect(Object.keys(ehr.tools).sort()).toEqual(Object.values(EHR_TOOL).sort());
  });

  it("overrides a model-supplied patient ID with the signed-in one", async () => {
    const output = await ehr.tools[EHR_TOOL.history].invoke(
      { patientId: "P-1001" },
      session("P-1002"),
    );

    expect(PatientHistorySummarySchema.parse(JSON.parse(textOf(output))).patientId).toBe("P-1002");
  });

  it("accepts the SESSION placeholder the model is told to use", async () => {
    const output = await ehr.tools[EHR_TOOL.history].invoke(
      { patientId: SESSION_PLACEHOLDER },
      session("P-1003"),
    );

    expect(PatientHistorySummarySchema.parse(JSON.parse(textOf(output))).patientId).toBe("P-1003");
  });

  it("refuses a patient-scoped call when nobody is signed in", async () => {
    await expect(ehr.tools[EHR_TOOL.history].invoke({ patientId: "P-1001" })).rejects.toThrow();
    await expect(
      ehr.tools[EHR_TOOL.book].invoke({ patientId: "P-1001", slotId: "S-1001" }),
    ).rejects.toThrow();
  });

  it("returns summaries that match the strict contract and carry no identity fields", async () => {
    for (const patientId of ["P-1001", "P-1002", "P-1003", "P-1004", "P-1005"]) {
      const raw = textOf(
        await ehr.tools[EHR_TOOL.history].invoke({ patientId }, session(patientId)),
      );
      const summary = PatientHistorySummarySchema.parse(JSON.parse(raw));

      expect(summary.recentEncounters.length).toBeLessThanOrEqual(5);
      expect(raw).not.toMatch(
        /Quillfeather|Oakhollow|Thornbury|Marlowe|Ravenscroft|dateOfBirth|address/,
      );
    }
  });

  it("reports the over-90 patient as 90+", async () => {
    const raw = textOf(
      await ehr.tools[EHR_TOOL.history].invoke({ patientId: "P-1005" }, session("P-1005")),
    );

    expect(PatientHistorySummarySchema.parse(JSON.parse(raw)).ageBand).toBe("90+");
  });

  it("lists at most 10 slots for a specialty without needing a session", async () => {
    const raw = textOf(await ehr.tools[EHR_TOOL.availability].invoke({ specialty: "cardiology" }));
    const availability = AvailabilityResultSchema.parse(JSON.parse(raw));

    expect(availability.slots.length).toBeGreaterThan(0);
    expect(availability.slots.length).toBeLessThanOrEqual(10);
  });

  it("books for the session patient and reports a clash for another", async () => {
    const availability = AvailabilityResultSchema.parse(
      JSON.parse(textOf(await ehr.tools[EHR_TOOL.availability].invoke({ specialty: "neurology" }))),
    );
    const slotId = availability.slots[0]?.slotId;
    expect(slotId).toBeDefined();

    const first = BookingResultSchema.parse(
      JSON.parse(
        textOf(
          await ehr.tools[EHR_TOOL.book].invoke({ patientId: "P-1001", slotId }, session("P-1004")),
        ),
      ),
    );
    const second = BookingResultSchema.parse(
      JSON.parse(
        textOf(
          await ehr.tools[EHR_TOOL.book].invoke({ patientId: "P-1004", slotId }, session("P-1005")),
        ),
      ),
    );

    expect(first.status).toBe("booked");
    expect(second.status).toBe("slot_taken");
  });

  it("raises tool failures without echoing the input", async () => {
    const failure = ehr.tools[EHR_TOOL.availability].invoke({
      specialty: "cardiology; drop table",
    });

    await expect(failure).rejects.toThrow(/specialty must be a name/);
    await expect(failure).rejects.not.toThrow(/drop table/);
  });
});
