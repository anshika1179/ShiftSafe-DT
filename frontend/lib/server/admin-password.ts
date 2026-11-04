import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

// OWASP's 32 MiB scrypt profile. Fixed costs reject attacker-controlled work factors.
const COST = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
const FORMAT = /^scrypt\$32768\$8\$3\$([a-f0-9]{32})\$([a-f0-9]{64})$/;

export function isScryptPasswordHash(value: string): boolean {
  return FORMAT.test(value);
}

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 32, COST, (error, key) => error ? reject(error) : resolve(key));
  });
}

export async function hashAdminPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return `scrypt$32768$8$3$${salt.toString("hex")}$${key.toString("hex")}`;
}

export async function verifyScryptPassword(password: string, encoded: string): Promise<boolean> {
  const match = FORMAT.exec(encoded);
  if (!match) throw new Error("Invalid stored admin credential format");
  const actual = await derive(password, Buffer.from(match[1], "hex"));
  return timingSafeEqual(actual, Buffer.from(match[2], "hex"));
}
