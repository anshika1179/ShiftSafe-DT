import { execFileSync } from "node:child_process";
import fs from "node:fs";

function audit(extra = []) {
  try { return JSON.parse(execFileSync("npm", ["audit", "--json", ...extra], { encoding: "utf8" })); }
  catch (error) {
    if (!error.stdout) throw error;
    const result = JSON.parse(error.stdout);
    if (result.error || !result.metadata) throw new Error("Audit service failed; no security verdict available");
    return result;
  }
}
const production = audit(["--omit=dev"]);
if (production.metadata.vulnerabilities.total !== 0) {
  console.error("Runtime dependencies have unresolved advisories:", production.vulnerabilities);
  process.exit(1);
}
const full = audit();
const exception = JSON.parse(fs.readFileSync(new URL("../docs/SECURITY-EXCEPTIONS.json", import.meta.url)));
if (new Date() >= new Date(exception.expiresAt)) throw new Error("Security exception expired; review required");
const permitted = new Set(exception.packageNames);
for (const [name, vulnerability] of Object.entries(full.vulnerabilities || {})) {
  if (!permitted.has(name)) throw new Error(`Unreviewed security finding: ${name}`);
  for (const advisory of vulnerability.via) {
    if (typeof advisory === "string") {
      if (!permitted.has(advisory)) throw new Error(`Unreviewed advisory path: ${name} -> ${advisory}`);
    } else if (advisory.url !== exception.advisoryUrl) {
      throw new Error(`Unreviewed advisory: ${advisory.url}`);
    }
  }
}
console.log("Runtime dependencies: no current npm advisories.");
if (full.metadata.vulnerabilities.total) {
  console.warn(`KNOWN UNFIXED DEVELOPMENT ADVISORY: ${exception.advisoryUrl}`);
  console.warn("Restricted to lint tooling; not fixed or hidden. Review expires", exception.expiresAt);
  console.warn("Affected package entries:", Object.keys(full.vulnerabilities).join(", "));
} else console.log("Full dependency tree: no current npm advisories.");
