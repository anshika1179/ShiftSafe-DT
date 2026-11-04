import { consumeAdminLoginLimit } from "../../frontend/lib/server/admin-rate-limit";
import { verifyAdminCredentials } from "../../frontend/lib/server/admin-auth";
async function main() {
  const result = process.argv[2] === "limit"
    ? (await consumeAdminLoginLimit("restart-fixture")).allowed
    : await verifyAdminCredentials(process.env.ADMIN_EMAIL!, "local-fixture-password-only");
  console.log(result);
}
main().then(() => process.exit(0)).catch(() => process.exit(1));
