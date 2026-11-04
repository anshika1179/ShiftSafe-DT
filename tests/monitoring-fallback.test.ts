import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("weather bootstrap is independent of GPS and old requests cannot overwrite newer previews", () => {
  const page = fs.readFileSync("frontend/app/monitoring/page.tsx", "utf8");
  assert.match(page, /const timer = window\.setTimeout\(\(\) => \{ void fetchWeather\(\); \}, 0\)/);
  assert.match(page, /\[isBootstrapping, isLoggedIn, fetchWeather\]/);
  assert.match(page, /const requestId = \+\+weatherRequestRef\.current/);
  assert.equal((page.match(/if \(weatherRequestRef.current !== requestId\) return;/g) || []).length, 2);
  assert.match(page, /if \(weatherRequestRef.current === requestId\) setWeatherLoading\(false\)/);
  assert.match(page, /gpsRequestRef.current \+= 1;\s+gpsCheckingRef.current = false;/);
  assert.ok(!page.includes("strengthen fraud validation"));
  assert.ok(!page.includes("continue with screenshot evidence"));
});
