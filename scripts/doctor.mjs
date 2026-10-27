#!/usr/bin/env node
// Cross-platform toolchain check for AuraTriage (Windows, macOS, Linux).
// Usage: node scripts/doctor.mjs
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const JAVA_REQUIRED = 25;
const NODE_MIN = 24;
const NODE_TARGET = 26;

const isWin = process.platform === "win32";
const isMac = process.platform === "darwin";
const repoRoot = path.resolve(import.meta.dirname, "..");

const results = [];
const record = (name, status, detail, hint) => results.push({ name, status, detail, hint });

function run(cmd, args, { shell = false } = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf8", shell });
  if (r.error || r.status === null) return null;
  return `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();
}

function javaCommand() {
  if (process.env.JAVA_BIN) return process.env.JAVA_BIN;
  if (process.env.JAVA_HOME) return path.join(process.env.JAVA_HOME, "bin", "java");
  return "java";
}

const javaHint = isWin
  ? `e.g. winget install EclipseAdoptium.Temurin.${JAVA_REQUIRED}.JDK, then reopen the terminal`
  : isMac
    ? `e.g. brew install --cask temurin@${JAVA_REQUIRED}`
    : `install Temurin ${JAVA_REQUIRED} from https://adoptium.net`;
const nodeHint = isWin
  ? "e.g. winget install OpenJS.NodeJS, then reopen the terminal"
  : isMac
    ? "e.g. brew install node"
    : "install from https://nodejs.org";

// Node
const nodeMajor = Number(process.versions.node.split(".")[0]);
if (nodeMajor >= NODE_TARGET) {
  record("node", "ok", `v${process.versions.node}`);
} else if (nodeMajor >= NODE_MIN) {
  record("node", "warn", `v${process.versions.node} works, target is ${NODE_TARGET}`, nodeHint);
} else {
  record(
    "node",
    "fail",
    `v${process.versions.node}, need >= ${NODE_MIN} (target ${NODE_TARGET})`,
    nodeHint,
  );
}

// npm
const npmOut = run("npm", ["-v"], { shell: isWin });
record(
  "npm",
  npmOut ? "ok" : "fail",
  npmOut ? `v${npmOut}` : "not found",
  npmOut ? undefined : nodeHint,
);

// git
const gitOut = run("git", ["--version"]);
record("git", gitOut ? "ok" : "fail", gitOut ?? "not found", gitOut ? undefined : "install git");

// Java
const javaOut = run(javaCommand(), ["-version"]);
const javaMatch = javaOut?.match(/version "(\d+)(?:\.(\d+))?/);
if (!javaMatch) {
  record("java", "fail", `not found via ${javaCommand()}`, javaHint);
} else {
  const major = Number(javaMatch[1]) === 1 ? Number(javaMatch[2]) : Number(javaMatch[1]);
  if (major >= JAVA_REQUIRED) {
    record("java", "ok", `JDK ${major}`);
  } else {
    record("java", "fail", `JDK ${major}, need >= ${JAVA_REQUIRED}`, javaHint);
  }
}

// A CRLF mvnw breaks on macOS/Linux. Only checked once Step 2 creates the wrapper.
const mvnw = path.join(repoRoot, "ehr-mcp-server", "mvnw");
if (existsSync(mvnw)) {
  const crlf = readFileSync(mvnw, "utf8").includes("\r\n");
  record(
    "mvnw line endings",
    crlf ? "fail" : "ok",
    crlf ? "CRLF found" : "LF",
    crlf ? "run: git add --renormalize .  (see .gitattributes)" : undefined,
  );
}

const tag = { ok: "[ ok ]", warn: "[warn]", fail: "[FAIL]" };
for (const r of results) {
  console.log(`${tag[r.status]} ${r.name}: ${r.detail}`);
  if (r.hint && r.status !== "ok") console.log(`         -> ${r.hint}`);
}

const failed = results.some((r) => r.status === "fail");
if (failed) {
  console.log("\nToolchain check failed.");
  console.log(
    "Tip: mise reads mise.toml and installs JDK 25 + Node 26 on Windows and macOS: https://mise.jdx.dev",
  );
} else {
  console.log("\nToolchain looks good.");
}
process.exit(failed ? 1 : 0);
