/**
 * asia-main Rules 測試共用工具（模擬器）
 * ------------------------------------------------------------------
 * - firebase-tools 14.x 的 emulators:exec 不支援 firebase.json 的 firestore 多庫陣列
 *   （啟動時警告 "does not support multiple databases yet" 且不載 rules），
 *   所以改用模擬器 REST 端點對具名庫個別載入 rules：
 *   PUT /emulator/v1/projects/{p}/databases/{db}:securityRules（V2 實測可行）。
 * - 種資料用 firebase-admin（繞過 Rules）；用戶端用 modular SDK + mockUserToken。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp as adminInitApp, getApps as adminGetApps, type App } from 'firebase-admin/app';
import { getFirestore as adminGetFirestore, Timestamp, type Firestore as AdminFirestore } from 'firebase-admin/firestore';
import { initializeApp, deleteApp, type FirebaseApp } from 'firebase/app';
import { getFirestore, connectFirestoreEmulator, terminate, type Firestore } from 'firebase/firestore';

export const PROJECT = 'demo-cp-rules';
export const DB = 'asia-main';
const HOST_PORT = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8382';
process.env.FIRESTORE_EMULATOR_HOST = HOST_PORT;
const [HOST, PORT_S] = HOST_PORT.split(':');
const PORT = Number(PORT_S);
const BASE = `http://${HOST_PORT}`;

const here = path.dirname(fileURLToPath(import.meta.url));
export const RULES_FILE = process.env.CP_RULES_FILE
  || path.resolve(here, '..', '..', 'firestore.asia-main.rules');

export async function loadRules(database = DB, file = RULES_FILE): Promise<void> {
  const content = fs.readFileSync(file, 'utf8');
  const res = await fetch(`${BASE}/emulator/v1/projects/${PROJECT}/databases/${database}:securityRules`, {
    method: 'PUT',
    body: JSON.stringify({ rules: { files: [{ name: path.basename(file), content }] } })
  });
  if (!res.ok) throw new Error(`載入 rules 失敗 ${res.status}: ${await res.text()}`);
}

export async function clearDb(database = DB): Promise<void> {
  // 前一個測試的離線連線剛關閉時，模擬器偶爾回 500；重試三次
  for (let i = 0; ; i++) {
    const res = await fetch(`${BASE}/emulator/v1/projects/${PROJECT}/databases/${database}/documents`, { method: 'DELETE' });
    if (res.ok) return;
    if (i >= 3) throw new Error(`清除資料失敗 ${res.status}: ${(await res.text()).slice(0, 200)}`);
    await new Promise(r => setTimeout(r, 300 * (i + 1)));
  }
}

let adminApp: App | null = null;
export function adminDb(database = DB): AdminFirestore {
  if (!adminApp) adminApp = adminGetApps()[0] ?? adminInitApp({ projectId: PROJECT });
  return adminGetFirestore(adminApp, database);
}

export type Who = null | { uid: string; role?: string };
const opened: { app: FirebaseApp; db: Firestore }[] = [];
let seq = 0;
/** 依身分建立連到 asia-main 的用戶端；null＝未登入。 */
export function clientDb(who: Who, database = DB): Firestore {
  const app = initializeApp({ projectId: PROJECT, apiKey: 'fake-api-key' }, `c${++seq}`);
  const db = getFirestore(app, database);
  const opts = who
    ? { mockUserToken: { sub: who.uid, user_id: who.uid, ...(who.role ? { role: who.role } : {}) } }
    : {};
  connectFirestoreEmulator(db, HOST, PORT, opts);
  opened.push({ app, db });
  return db;
}
export async function closeClients(): Promise<void> {
  while (opened.length) {
    const { app, db } = opened.pop()!;
    await terminate(db).catch(() => {});
    await deleteApp(app).catch(() => {});
  }
}

export async function assertSucceeds<T>(p: Promise<T>): Promise<T> {
  try { return await p; } catch (e) {
    throw new Error(`預期成功卻失敗：${(e as { code?: string }).code ?? ''} ${(e as Error).message}`);
  }
}
export async function assertFails(p: Promise<unknown>): Promise<void> {
  try { await p; } catch (e) {
    const code = (e as { code?: string }).code ?? '';
    const msg = String((e as Error).message);
    // 因為超過 1000 運算式預算而被拒，不算「被條件擋下」：測試不能靠預算耗盡過關（V5）
    if (/maximum of 1000 expressions/i.test(msg)) {
      throw new Error(`被拒原因是運算式預算耗盡，不是規則條件：${msg.slice(0, 300)}`);
    }
    if (code === 'permission-denied' || /PERMISSION_DENIED|permission/i.test(msg)) return;
    throw new Error(`預期 permission-denied，實際錯誤：${code} ${(e as Error).message}`);
  }
  throw new Error('預期被拒卻成功');
}

export const ago = (sec: number) => Timestamp.fromMillis(Date.now() - sec * 1000);
export const later = (sec: number) => Timestamp.fromMillis(Date.now() + sec * 1000);
export { Timestamp };
