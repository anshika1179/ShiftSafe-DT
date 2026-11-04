import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("stage one CI fails on lint and unknown security findings", () => {
  const ci = fs.readFileSync(".github/workflows/ci.yml", "utf8");
  assert.ok(ci.includes("run: npm run lint"));
  assert.ok(ci.includes("run: npm run security:check"));
  assert.ok(!ci.includes("|| true"));
  assert.ok(ci.includes("node-version: 22"));
  for (const file of fs.readdirSync(".github/workflows")) {
    for (const line of fs.readFileSync(`.github/workflows/${file}`, "utf8").split("\n")) {
      if (/uses:/.test(line)) assert.match(line, /@[0-9a-f]{40}/);
    }
  }
});

test("stage one preserves financial blocks and bounds the known development exception", () => {
  const exception = JSON.parse(fs.readFileSync("docs/SECURITY-EXCEPTIONS.json", "utf8"));
  assert.equal(exception.advisoryUrl, "https://github.com/advisories/GHSA-vfj7-8cjw-p6xm");
  assert.equal(exception.packageNames.length, 5);
  assert.ok(new Date(exception.expiresAt) < new Date("2026-10-13T00:00:00Z"));
  const checker = fs.readFileSync("scripts/check-audit.mjs", "utf8");
  assert.ok(checker.includes('audit(["--omit=dev"])'));
  assert.ok(checker.includes("Unreviewed advisory"));
  assert.ok(checker.includes("Security exception expired"));
  for (const route of ["claims", "razorpay/order", "triggers/cron"]) {
    assert.ok(fs.readFileSync(`frontend/app/api/${route}/route.ts`, "utf8").includes("status: 503"));
  }
});
