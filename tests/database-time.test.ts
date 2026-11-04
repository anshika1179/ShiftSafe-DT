import test from "node:test";
import assert from "node:assert/strict";
import { databaseTimestampMs } from "../backend/src/utils/database-time";
test("database timestamp parsing preserves UTC and PostgreSQL offsets", () => {
  const expected = Date.parse("2026-10-06T03:00:00.123Z");
  for (const stamp of ["2026-10-06 03:00:00.123456+00", "2026-10-06 03:00:00.123+0000", "2026-10-06T03:00:00.123+00:00", "2026-10-06 08:30:00.123456+05:30", "2026-10-05 23:00:00.123-04", new Date(expected)]) assert.equal(databaseTimestampMs(stamp), expected);
  assert.equal(databaseTimestampMs("2026-10-06 03:00:00"), Date.parse("2026-10-06T03:00:00Z"));
  for (const stamp of [null, undefined, "", "not a date", "2026-10-06", "2026-10-06 03:00:00+25", 123]) assert.ok(Number.isNaN(databaseTimestampMs(stamp)));
});
