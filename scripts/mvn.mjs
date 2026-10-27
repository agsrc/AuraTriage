#!/usr/bin/env node
// Runs the Maven wrapper in ehr-mcp-server/ with the right launcher for the OS.
// Usage: node scripts/mvn.mjs <maven args>   e.g. node scripts/mvn.mjs -B verify
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const moduleDir = path.resolve(import.meta.dirname, "..", "ehr-mcp-server");
const isWin = process.platform === "win32";
const wrapperName = isWin ? "mvnw.cmd" : "mvnw";

if (!existsSync(path.join(moduleDir, wrapperName))) {
  console.error(
    `Maven wrapper (${wrapperName}) not found in ${moduleDir}. It is created in Step 2.`,
  );
  process.exit(1);
}

// Windows runs the .cmd through the shell. Elsewhere run the script via sh so a lost
// executable bit (common after checkout from Windows) cannot break the build.
const [command, args, shell] = isWin
  ? [`.\\${wrapperName}`, process.argv.slice(2), true]
  : ["sh", ["./mvnw", ...process.argv.slice(2)], false];

const result = spawnSync(command, args, { cwd: moduleDir, stdio: "inherit", shell });
if (result.error) {
  console.error(`Failed to start Maven wrapper: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
