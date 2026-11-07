import { type NextRequest } from "next/server";
import { getDb } from "@/backend/models/db";
import { authorizeWorker } from "./authorization";
import { phoneProofHash, PhoneVerificationError } from "./phone-verification";
export async function resolvePhoneOwner(req: NextRequest, registrationProof: unknown) {
  if (req.headers.get("origin") !== req.nextUrl.origin) throw new PhoneVerificationError("Invalid verification origin", 403);
  if (typeof registrationProof === "string" && registrationProof) {
    const row = await getDb().prepare("SELECT subject FROM google_registration_proofs WHERE id = ? AND consumed = 0 AND expires_at > ?").get(phoneProofHash(registrationProof), Date.now());
    if (!row) throw new PhoneVerificationError("Google sign-in expired. Sign in again.", 401);
    return { key: `google:${row.subject}` as string, workerId: null };
  }
  const owner = await authorizeWorker(req);
  if (!owner.workerId) throw new PhoneVerificationError("Sign in before verifying your contact phone.", 401);
  return { key: `worker:${owner.workerId}`, workerId: owner.workerId };
}
