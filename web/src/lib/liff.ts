// 你需要在 index.html 引入 LIFF SDK：<script src="https://static.line-scdn.net/liff/edge/2/sdk.js"></script>
declare global {
  interface Window { liff: any; }
}

export async function initLiff() {
  const liffId = import.meta.env.VITE_LIFF_ID;
  if (!liffId) throw new Error("Missing VITE_LIFF_ID");
  if (!window.liff) throw new Error("LIFF SDK not loaded");
  await window.liff.init({ liffId });
  if (!window.liff.isLoggedIn()) window.liff.login();
}

export async function getLiffProfile() {
  const profile = await window.liff.getProfile();
  return {
    userId: profile.userId,
    displayName: profile.displayName,
    pictureUrl: profile.pictureUrl
  };
}

export async function getLiffIdToken(): Promise<string> {
  const token = window.liff.getIDToken();
  if (!token) throw new Error("No LIFF idToken");
  return token;
}
