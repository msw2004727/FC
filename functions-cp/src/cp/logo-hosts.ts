/**
 * 隊徽（與日後其他公開圖片）網址白名單（顧問 §3.278 P2）。
 * 任意外部 https 網址會顯示給所有看賽事的人，可拿來埋追蹤圖、蒐集觀眾 IP，
 * 所以只收本專案 Firebase Storage 下載網址：
 *   https://firebasestorage.googleapis.com/v0/b/<本專案 bucket>/o/<物件路徑>
 * bucket 不寫死：執行期從 CP_LOGO_BUCKETS（逗號分隔）或 Functions 內建的 FIREBASE_CONFIG.storageBucket 讀；
 * 兩者都沒有就一律不收（fail-closed）。
 * G4 主站鏡像觸發器（onTeamWrittenForCompetitions）寫 cpClubs.image 時要用同一份規則（見第 3 步交接）。
 */
export const LOGO_HOST = 'firebasestorage.googleapis.com';
const BUCKET_RE = /^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/;

/** 允許的 bucket 清單；每次呼叫重讀環境變數，測試可直接設定 process.env。 */
export function allowedLogoBuckets(env: NodeJS.ProcessEnv = process.env): string[] {
  const out = new Set<string>();
  for (const b of (env.CP_LOGO_BUCKETS ?? '').split(',')) {
    const t = b.trim();
    if (BUCKET_RE.test(t)) out.add(t);
  }
  try {
    const cfg = env.FIREBASE_CONFIG ? JSON.parse(env.FIREBASE_CONFIG) as { storageBucket?: unknown } : null;
    const b = typeof cfg?.storageBucket === 'string' ? cfg.storageBucket.trim() : '';
    if (BUCKET_RE.test(b)) out.add(b);
  } catch {
    // FIREBASE_CONFIG 格式不對：當成沒有，不放寬
  }
  return [...out];
}

/** 網址是否為白名單 bucket 的 Firebase Storage 下載網址（已正規化的字串）。 */
export function isAllowedLogoUrl(url: string, buckets: readonly string[] = allowedLogoBuckets()): boolean {
  if (buckets.length === 0) return false;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' || u.hostname !== LOGO_HOST || u.port !== '' || u.username !== '' || u.password !== '') return false;
  const m = /^\/v0\/b\/([^/]+)\/o\/[^/]+/.exec(u.pathname);
  return !!m && buckets.includes(decodeURIComponent(m[1]!));
}
