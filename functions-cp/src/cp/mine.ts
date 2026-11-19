/**
 * cpMine/{uid}/items/{cid} 索引（§5.2：伺服器在建賽、報隊、登錄時寫；只存索引不存個資）。
 * roles 由這些來源推導：host（個人主辦，§3.251 (c) 取代 hostUid 查詢）、rep（自己報的隊）、
 * player（自己的名單）、scorer／referee（主辦指派的記分角色）。
 * 全部移除時刪文件。沒有帶 scoreRoles 時保留文件上既有的記分角色，避免報隊、登錄把指派抹掉。
 */
import type { DocumentSnapshot, Transaction } from 'firebase-admin/firestore';
import { FieldValue, readDoc, type CompDoc, type CpDeps } from './context.js';
import { categoryOf } from './validate.js';

const SCORE_ORDER = ['scorer', 'referee'] as const;
export type ScoreRole = (typeof SCORE_ORDER)[number];

export interface MineChange {
  addHost?: boolean;
  removeHost?: boolean;
  addEntry?: string;
  removeEntry?: string;
  addPlayer?: string;
  removePlayer?: string;
  /** 有帶（含空陣列）就覆寫記分角色；沒帶則保留文件上的 scorer／referee。 */
  scoreRoles?: readonly ScoreRole[];
}

function scoreRolesOn(snap: DocumentSnapshot): ScoreRole[] {
  if (!snap.exists || !Array.isArray(snap.get('roles'))) return [];
  const found = new Set<string>();
  for (const r of snap.get('roles') as unknown[]) {
    if (r === 'scorer' || r === 'referee') found.add(r);
  }
  return SCORE_ORDER.filter(r => found.has(r));
}

/** 讀（交易讀階段呼叫）→ 回傳寫入函式（寫階段呼叫）。comp 只取 name、firstMatchAt、category（缺值視為 league）。 */
export async function prepareMine(
  deps: CpDeps, tx: Transaction, uid: string, cid: string,
  comp: Pick<CompDoc, 'name' | 'firstMatchAt'> & { category?: unknown }, ch: MineChange
): Promise<() => void> {
  const ref = deps.db.doc(`cpMine/${uid}/items/${cid}`);
  const snap: DocumentSnapshot = await readDoc(deps, tx, ref);
  let host = snap.exists && snap.get('host') === true;
  const entryIds = new Set<string>(snap.exists && Array.isArray(snap.get('entryIds')) ? snap.get('entryIds') : []);
  const plIds = new Set<string>(snap.exists && Array.isArray(snap.get('plIds')) ? snap.get('plIds') : []);
  if (ch.addHost) host = true;
  if (ch.removeHost) host = false;
  if (ch.addEntry) entryIds.add(ch.addEntry);
  if (ch.removeEntry) entryIds.delete(ch.removeEntry);
  if (ch.addPlayer) plIds.add(ch.addPlayer);
  if (ch.removePlayer) plIds.delete(ch.removePlayer);
  const score = ch.scoreRoles ? SCORE_ORDER.filter(r => ch.scoreRoles!.includes(r)) : scoreRolesOn(snap);
  const roles = [
    ...(host ? ['host'] : []),
    ...(entryIds.size ? ['rep'] : []),
    ...(plIds.size ? ['player'] : []),
    ...score
  ];
  return () => {
    if (roles.length === 0) {
      if (snap.exists) tx.delete(ref);
      return;
    }
    tx.set(ref, {
      cid, name: comp.name, firstMatchAt: comp.firstMatchAt, category: categoryOf(comp), roles, host,
      entryIds: [...entryIds], plIds: [...plIds], updatedAt: FieldValue.serverTimestamp()
    });
  };
}
