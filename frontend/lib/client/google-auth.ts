import { initializeApp, getApps } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, inMemoryPersistence, setPersistence } from "firebase/auth";
export async function getGoogleToken() {
  const config = { apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY, authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN, projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID };
  if (!config.apiKey || !config.authDomain || !config.projectId) throw new Error("Google sign-in is not configured yet. Ask the project owner to finish setup.");
  const app = getApps()[0] || initializeApp(config);
  const auth = getAuth(app);
  await setPersistence(auth, inMemoryPersistence);
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  try { const result = await signInWithPopup(auth, provider); return await result.user.getIdToken(); }
  finally { await signOut(auth); }
}
