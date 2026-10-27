// Step 2 spike: prove the Node side can spawn the Java MCP server over stdio and call its tools
// through @langchain/mcp-adapters, including the session-bound patient ID. It is not product
// code; Step 3 replaces it with real modules and Vitest tests.
//
//   node scripts/mvn.mjs -B package
//   node agent-orchestrator/spike/mcp-smoke.mjs
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { MCPAdapter } from "@langchain/mcp-adapters";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const jar = path.resolve(
  repoRoot,
  process.env.EHR_MCP_JAR ?? "ehr-mcp-server/target/ehr-mcp-server.jar",
);
const java =
  process.env.JAVA_BIN ||
  (process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, "bin", "java") : "java");

if (!existsSync(jar)) {
  console.error(`JAR not found: ${jar}\nBuild it first: node scripts/mvn.mjs -B package`);
  process.exit(1);
}

// If the process cannot exit after close(), a child JVM or handle is still alive.
setTimeout(() => {
  console.error(
    "[FAIL] process did not exit within 15 s of finishing: orphaned JVM or open handle",
  );
  process.exit(2);
}, 15_000).unref();

const failures = [];
function check(name, condition, detail = "") {
  console.log(
    `${condition ? "[ ok ]" : "[FAIL]"} ${name}${condition || !detail ? "" : `: ${detail}`}`,
  );
  if (!condition) failures.push(name);
}

const textOf = (output) =>
  typeof output === "string"
    ? output
    : Array.isArray(output)
      ? output.map((block) => (typeof block === "string" ? block : (block.text ?? ""))).join("")
      : JSON.stringify(output);

// Tools that take a patientId. The model must never choose it: the session does.
const PATIENT_TOOLS = new Set(["get_patient_history", "book_appointment"]);

console.log(`modules loaded ${process.uptime().toFixed(1)} s after process start`);

const adapter = new MCPAdapter({
  servers: { ehr: { command: java, args: ["-jar", jar], stderr: "inherit" } },
  beforeToolCall: (request, _state, config) => {
    const sessionPatientId = config?.configurable?.patientId;
    if (typeof sessionPatientId !== "string" || !PATIENT_TOOLS.has(request.name)) return undefined;
    return { args: { patientId: sessionPatientId } };
  },
});

const session = (patientId) => ({ configurable: { patientId } });

try {
  const discoveryStart = performance.now();
  const tools = await adapter.listTools();
  console.log(
    `spawn + initialize + tool discovery took ${Math.round(performance.now() - discoveryStart)} ms`,
  );
  const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool]));
  const expected = [
    "ehr_get_patient_history",
    "ehr_check_provider_availability",
    "ehr_book_appointment",
  ];
  console.log(`tools discovered: ${Object.keys(byName).sort().join(", ")}`);
  check(
    "exposes the three tools with the ehr_ prefix",
    expected.every((name) => name in byName),
  );

  const history = textOf(
    await byName.ehr_get_patient_history.invoke({ patientId: "P-1001" }, session("P-1001")),
  );
  const summary = JSON.parse(history);
  check("history returns the requested patient", summary.patientId === "P-1001");
  check("history has an age band, not a date of birth", /^\d+-\d+$|^90\+$/.test(summary.ageBand));
  check(
    "history never contains identity fields or canary values",
    !/Quillfeather|1971-03-14|dateOfBirth|address/.test(history),
  );
  check(
    "trend directions use lower-case wire values",
    summary.vitalsTrends.every((t) => ["rising", "falling", "stable"].includes(t.direction)) &&
      summary.vitalsTrends.some((t) => t.metric === "systolic_bp"),
  );

  // The model asks for P-1001 but the session belongs to P-1002: the hook must win.
  const forced = JSON.parse(
    textOf(await byName.ehr_get_patient_history.invoke({ patientId: "P-1001" }, session("P-1002"))),
  );
  check("session patient ID overrides the model-supplied one", forced.patientId === "P-1002");

  const availability = JSON.parse(
    textOf(
      await byName.ehr_check_provider_availability.invoke(
        { specialty: "cardiology" },
        session("P-1002"),
      ),
    ),
  );
  check(
    "availability returns up to 10 slots",
    availability.slots.length > 0 && availability.slots.length <= 10,
  );

  const slotId = availability.slots[0].slotId;
  const booked = JSON.parse(
    textOf(
      await byName.ehr_book_appointment.invoke({ patientId: "P-1001", slotId }, session("P-1002")),
    ),
  );
  check(
    "booking succeeds for the session patient",
    booked.status === "booked" && !!booked.appointmentId,
  );

  const taken = JSON.parse(
    textOf(
      await byName.ehr_book_appointment.invoke({ patientId: "P-1002", slotId }, session("P-1003")),
    ),
  );
  check("a second patient gets slot_taken", taken.status === "slot_taken");

  let errorMessage = "";
  try {
    await byName.ehr_get_patient_history.invoke({ patientId: "not-an-id" });
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error);
  }
  check("a malformed ID is rejected as an error", errorMessage !== "", "no error was thrown");
  check("the error does not echo the input", !errorMessage.includes("not-an-id"), errorMessage);
} catch (error) {
  console.error(error);
  failures.push("unexpected error");
} finally {
  const closeStart = performance.now();
  await adapter.close();
  console.log(`close took ${Math.round(performance.now() - closeStart)} ms`);
}

console.log(
  failures.length === 0 ? "\nSpike passed." : `\nSpike failed: ${failures.length} check(s).`,
);
process.exitCode = failures.length === 0 ? 0 : 1;
