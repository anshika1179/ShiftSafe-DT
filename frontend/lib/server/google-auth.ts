import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

const googleKeys = createRemoteJWKSet(new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"));
export interface GoogleIdentity { subject: string; email: string; name: string }
export async function verifyGoogleIdentity(token: unknown, keys: JWTVerifyGetKey = googleKeys): Promise<GoogleIdentity> {
  const project = process.env.FIREBASE_PROJECT_ID?.trim();
  if (!project) throw new Error("Google sign-in is not configured");
  if (typeof token !== "string" || token.length > 12000) throw new Error("Invalid sign-in token");
  const { payload } = await jwtVerify(token, keys, {
    algorithms: ["RS256"], audience: project,
    issuer: `https://securetoken.google.com/${project}`, maxTokenAge: "1h",
  });
  const firebase = payload.firebase as { sign_in_provider?: string } | undefined;
  if (!payload.sub || !payload.iat || !payload.exp || payload.sub.length > 128 || firebase?.sign_in_provider !== "google.com" || payload.email_verified !== true || typeof payload.email !== "string" || typeof payload.auth_time !== "number" || (payload.auth_time > Date.now() / 1000 + 30 || payload.auth_time < Date.now() / 1000 - 3600)) throw new Error("A verified Google account is required");
  return { subject: payload.sub, email: payload.email.slice(0, 254), name: typeof payload.name === "string" ? payload.name.slice(0, 100) : "" };
}
