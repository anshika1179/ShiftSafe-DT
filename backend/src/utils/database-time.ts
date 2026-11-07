// Database timestamps without an offset are SQLite CURRENT_TIMESTAMP in UTC.
// PostgreSQL text CURRENT_TIMESTAMP can include microseconds and +HH offsets.
export function databaseTimestampMs(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value !== "string") return NaN;
  const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}(?::?\d{2})?)?$/i.exec(value.trim());
  if (!match) return NaN;
  const fraction = match[3] ? `.${match[3].slice(0, 3).padEnd(3, "0")}` : "";
  const zone = match[4] || "Z";
  const offset = /^[+-]\d{2}$/.test(zone) ? `${zone}:00` : zone;
  return Date.parse(`${match[1]}T${match[2]}${fraction}${offset}`);
}
