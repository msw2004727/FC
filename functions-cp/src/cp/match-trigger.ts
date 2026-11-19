/**
 * 觸發器 cpOnMatchWritten 的處理函式（§6.2）＋積分重算共用。
 * - 每次都讀「目前」狀態重算，不信觸發事件內容：亂序、重送都冪等（同輸入同輸出，版本只會往上）。
 * - 積分只算 confirmed／walkover；只重建該場所在的組（增量），stageId／groupId 一律取場次文件（§3.250-4）。
 * - 全量重算（recomputeDivisionStandings）走同一個 recomputeStanding，逐組重建；主辦／管理員對帳鈕用。
 * - 摘要片：條目沒變就不寫；開賽日期改了從舊片移除。狀態改成 cancelled 時 st 一併變成 cancelled。
 * - 全部場次已解決（confirmed／walkover／cancelled）後寫 endedAt（endedBy:'confirm'）。
 *   已解決場次回到未解決（含取消恢復成未賽）就清掉這次確認結束。手動結束（host）與自動結束（auto）不在這裡清。
 * - K3：進入或離開 confirmed 時更新射手榜。確認結束的同一筆寫入冠軍名，解除時刪除。
 *   進行中的進球、牌、換人、改期只寫摘要（afterHint 有值且兩邊都未計分、未解決時不重讀）。
 */
import { LIMITS } from './validate.js';
import type { DocumentData, DocumentReference, Transaction } from 'firebase-admin/firestore';
import { buildStanding, engineInputsOf, resolveRules, standingIdOf, type MatchLike, type StandingDoc } from '../engine/index.js';
import { championsFromStandings, type Champion, type ChampionStanding } from './champions.js';
import { DVID_RE, FieldValue, readCount, readDoc, readQuery, type CpDeps } from './context.js';
import { RESOLVED_STATUSES, countedForStanding, resolvedForEnd, standingMatchesOf } from './schedule-plan.js';
import { syncMatchStats } from './stats.js';
import { sameEntry, summaryEntryOf, summaryShardIdOf, type SummaryEntry } from './summary.js';

const UTC_OFFSET = '+08:00';

export function standingRef(deps: CpDeps, cid: string, dvId: string, stageId: string, groupId: string): DocumentReference {
  return deps.db.doc(`competitions/${cid}/standings/${standingIdOf(dvId, stageId, groupId)}`);
}

type RankingPreset = 'h2hFirst' | 'goalDiffFirst';

function teamMetaOf(names: Record<string, string>) {
  return Object.fromEntries(Object.entries(names).map(([id, name]) => [id, { teamId: id, name }]));
}

/**
 * 產生賽程這筆要寫的 ranking 疊進已讀的組別，不改呼叫端手上的物件，也不再讀。
 * 沒有 rules 時解析才看 schedule.ranking，結果才與原本的捷徑相同。
 */
function divisionWithRanking(division: Record<string, unknown>, ranking: RankingPreset): Record<string, unknown> {
  const prev = division.schedule;
  const schedule = prev && typeof prev === 'object' && !Array.isArray(prev)
    ? { ...(prev as Record<string, unknown>) }
    : {};
  schedule.ranking = ranking;
  return { ...division, schedule };
}

/**
 * 交易內寫一張積分榜。呼叫端要先讀完組別、場次、前一版，這裡不再讀。
 * 規則用傳入的組別文件：觸發器傳剛讀到的文件；setDivisionRules 傳記憶體裡的新規則，
 * 不能再讀磁碟，否則同一筆交易會看到舊規則。
 */
export function applyStanding(
  tx: Transaction,
  ref: DocumentReference,
  args: {
    cid: string;
    dvId: string;
    stageId: string;
    groupId: string;
    teamIds: string[];
    matches: MatchLike[];
    division: Record<string, unknown>;
    divisionName: string;
    computedBy: string;
    prev: { version?: number; manualOverride?: StandingDoc['manualOverride']; rows?: StandingDoc['rows'] } | null;
    names: Record<string, string>;
  }
): StandingDoc {
  const { rule, opts } = engineInputsOf(resolveRules(args.division));
  const doc = buildStanding({
    competitionId: args.cid, divisionId: args.dvId, stageId: args.stageId, groupId: args.groupId,
    teamIds: args.teamIds,
    matches: standingMatchesOf(args.matches),
    rule,
    opts: { ...opts, teamMeta: teamMetaOf(args.names) },
    prev: args.prev
  });
  tx.set(ref, { ...doc, divisionName: args.divisionName, computedBy: args.computedBy, updatedAt: FieldValue.serverTimestamp() });
  return doc;
}

/**
 * 產生賽程時的全 0 積分榜（名次照抽籤順序，畫面在全部 0 場時不顯示同分標記）。
 * prevVersion：重排時沿用舊版本 +1，避免版本倒退被 isStaleWrite 當成舊資料。
 * divisionName：組別文件上的名稱（呼叫端已讀過，這裡不再讀）。
 * 排序用 engineInputsOf(resolveRules(division))。ranking 是這筆要寫進 schedule 的值，疊在已讀文件上，不另讀。
 * 沒有 rules 時與原本的 rankingRuleOf(ranking) 相同。有 rules 時以解析結果為準。
 * 文件帶 rankingRuleId、criteria，給這張全 0 表對得上解析結果。下次重算整份 set 會蓋掉這兩欄。
 */
export function zeroStandingDoc(
  cid: string, dvId: string, teamIds: string[], names: Record<string, string>,
  division: Record<string, unknown>, ranking: RankingPreset,
  prevVersion = 0, divisionName = ''
) {
  const { rule, opts } = engineInputsOf(resolveRules(divisionWithRanking(division, ranking)));
  const doc = buildStanding({
    competitionId: cid, divisionId: dvId, stageId: 'group', groupId: 'A', teamIds, matches: [],
    rule, opts: { ...opts, teamMeta: teamMetaOf(names) }, prev: { version: prevVersion }
  });
  return {
    ...doc,
    rankingRuleId: rule.rankingRuleId,
    criteria: [...rule.criteria],
    divisionName,
    computedBy: 'cpHost:generateSchedule',
    updatedAt: FieldValue.serverTimestamp()
  };
}

function kickoffMsOf(d: DocumentData | null | undefined): number | null {
  const k = d?.kickoffAt;
  if (k && typeof k.toMillis === 'function') return k.toMillis();
  return null;
}

/** 重建一組積分榜（交易內讀組別設定、該組場次、前一版）。賽程已清除時刪除積分榜。回傳是否寫入。 */
export async function recomputeStanding(deps: CpDeps, cid: string, dvId: string, stageId: string, groupId: string): Promise<boolean> {
  return deps.db.runTransaction(async tx => {
    const ref = standingRef(deps, cid, dvId, stageId, groupId);
    // 刪除賽事進行中（recursiveDelete 與觸發器競速）不重建積分榜（Opus 終審 P3-5）
    const comp = await readDoc(deps, tx, deps.db.doc(`competitions/${cid}`));
    if (!comp.exists || comp.get('deletingAt')) return false;
    const dv = await readDoc(deps, tx, deps.db.doc(`competitions/${cid}/divisions/${dvId}`));
    const schedule = dv.exists ? dv.get('schedule') : null;
    const group = Array.isArray(schedule?.groups)
      ? (schedule.groups as Array<{ groupId?: unknown; teamIds?: unknown }>).find(g => g.groupId === groupId)
      : undefined;
    const prev = await readDoc(deps, tx, ref);
    if (!group || !Array.isArray(group.teamIds)) {
      if (prev.exists) tx.delete(ref);
      return prev.exists;
    }
    const snap = await readQuery(deps, tx, deps.db.collection(`competitions/${cid}/matches`)
      .where('divisionId', '==', dvId).where('stageId', '==', stageId).where('groupId', '==', groupId).limit(400));
    const all = snap.docs.map(d => ({ matchId: d.id, ...d.data() }) as Record<string, unknown> & { matchId: string; status?: string });
    const names: Record<string, string> = {};
    for (const m of all) {
      for (const side of ['home', 'away'] as const) {
        const t = m[side] as { teamId?: unknown; name?: unknown } | null | undefined;
        if (typeof t?.teamId === 'string' && typeof t.name === 'string') names[t.teamId] = t.name;
      }
    }
    const prevData = prev.exists ? (prev.data() as Partial<StandingDoc>) : null;
    // 組別文件這筆交易已經讀過，名稱與規則直接帶上，不再讀。整份 set 會蓋掉舊欄位，所以一定要寫。
    const divisionName = typeof dv.get('name') === 'string' ? dv.get('name') as string : '';
    const division = dv.exists ? (dv.data() as Record<string, unknown>) : {};
    applyStanding(tx, ref, {
      cid, dvId, stageId, groupId,
      teamIds: group.teamIds as string[],
      matches: all as MatchLike[],
      division, divisionName, computedBy: 'cpOnMatchWritten',
      prev: prevData ? { version: prevData.version, manualOverride: prevData.manualOverride, rows: prevData.rows } : null,
      names
    });
    return true;
  });
}

/** 全量重算一個組別的全部組（對帳路徑）。回傳寫入（或刪除）的積分榜數。 */
export async function recomputeDivisionStandings(deps: CpDeps, cid: string, dvId: string): Promise<number> {
  const dv = await readDoc(deps, null, deps.db.doc(`competitions/${cid}/divisions/${dvId}`));
  const groups = Array.isArray(dv.get('schedule')?.groups) ? (dv.get('schedule').groups as Array<{ groupId: string }>) : [];
  let n = 0;
  for (const g of groups.length ? groups : [{ groupId: 'A' }]) {
    if (await recomputeStanding(deps, cid, dvId, 'group', g.groupId)) n += 1;
  }
  return n;
}

async function syncSummary(deps: CpDeps, cid: string, mtId: string, before: DocumentData | null): Promise<boolean> {
  let attempts = 0;
  try {
    return await deps.db.runTransaction(async tx => {
      attempts += 1;
      return await syncSummaryTx(deps, tx, cid, mtId, before);
    });
  } finally {
    if (deps.summaryTxAttempts) deps.summaryTxAttempts.count += attempts;
  }
}

async function syncSummaryTx(
  deps: CpDeps, tx: Transaction, cid: string, mtId: string, before: DocumentData | null
): Promise<boolean> {
  const ref = deps.db.doc(`competitions/${cid}/matches/${mtId}`);
  const cur = await readDoc(deps, tx, ref);
  const after = cur.exists ? cur.data()! : null;
  const newId = after ? summaryShardIdOf(kickoffMsOf(after), UTC_OFFSET) : null;
  const oldId = before ? summaryShardIdOf(kickoffMsOf(before), UTC_OFFSET) : null;
  let wrote = false;
  const ops: Array<() => void> = [];
  if (newId && after) {
    const shardRef = deps.db.doc(`competitions/${cid}/summary/${newId}`);
    const shard = await readDoc(deps, tx, shardRef);
    const entry = summaryEntryOf(after, kickoffMsOf(after));
    const curEntry = shard.exists ? (shard.get('m')?.[mtId] as SummaryEntry | undefined) : undefined;
    if (!sameEntry(curEntry, entry)) {
      // 片已存在時用 update 的欄位路徑整筆取代這一場（Opus 終審 P2）：set+merge 會逐層合併巢狀 map，
      // 取消→重置後舊的 cr 會殘留，之後每次都判成不同而多寫。
      if (shard.exists) ops.push(() => tx.update(shardRef, { [`m.${mtId}`]: entry, updatedAt: FieldValue.serverTimestamp() }));
      else ops.push(() => tx.set(shardRef, { m: { [mtId]: entry }, updatedAt: FieldValue.serverTimestamp() }, { merge: true }));
    }
  }
  if (oldId && oldId !== newId) {
    const oldRef = deps.db.doc(`competitions/${cid}/summary/${oldId}`);
    const old = await readDoc(deps, tx, oldRef);
    const m = old.exists ? (old.get('m') as Record<string, unknown> | undefined) : undefined;
    if (m && Object.prototype.hasOwnProperty.call(m, mtId)) {
      if (Object.keys(m).length === 1) ops.push(() => tx.delete(oldRef));
      else ops.push(() => tx.update(oldRef, { [`m.${mtId}`]: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() }));
    }
  }
  for (const op of ops) { op(); wrote = true; }
  return wrote;
}

const GROUP_ID_RE = /^[A-Za-z0-9]{1,8}$/;

/** 只讀小組（stageId group）積分榜。組 id 不合形狀的略過。呼叫端已先確定要結束。 */
async function loadChampions(
  deps: CpDeps,
  tx: Transaction,
  cid: string,
  divs: ReadonlyArray<{ id: string; get(field: string): unknown }>
): Promise<Champion[]> {
  const items: ChampionStanding[] = [];
  const docs = [...divs].sort((a, b) => a.id.localeCompare(b.id));
  for (const dv of docs) {
    if (!DVID_RE.test(dv.id)) continue;
    const schedule = dv.get('schedule');
    const groups = schedule && typeof schedule === 'object'
      ? (schedule as { groups?: unknown }).groups
      : undefined;
    const groupIds = [...new Set(
      (Array.isArray(groups) ? groups : [])
        .map(g => (g && typeof g === 'object' && typeof (g as { groupId?: unknown }).groupId === 'string'
          ? (g as { groupId: string }).groupId : ''))
        .filter(id => GROUP_ID_RE.test(id))
    )].sort();
    for (const groupId of groupIds) {
      const snap = await readDoc(deps, tx, standingRef(deps, cid, dv.id, 'group', groupId));
      const rows = snap.exists ? snap.get('rows') : [];
      items.push({ divisionId: dv.id, groupId, rows: Array.isArray(rows) ? rows : [] });
    }
  }
  return championsFromStandings(items);
}

async function syncEnded(deps: CpDeps, cid: string, wasResolved: boolean, isResolved: boolean): Promise<'set' | 'cleared' | null> {
  return deps.db.runTransaction(async tx => {
    const compRef = deps.db.doc(`competitions/${cid}`);
    const comp = await readDoc(deps, tx, compRef);
    if (!comp.exists) return null;
    const matches = deps.db.collection(`competitions/${cid}/matches`);
    // 只在「未解決 → 已解決」的那次轉換才判斷結束（Flash 初審 P2）：管理員恢復手動結束後，
    // 已解決場次的其他欄位更新不會把賽事又自動結束成 endedBy:'confirm'（主辦會多拿到寬限）。
    if (isResolved && !wasResolved && !comp.get('endedAt')) {
      // 多組別：每個組別都要已排賽程才可能結束（Opus 終審 P1-1：只看既有場次時，
      // 先打完的組別會讓整場賽事被判結束）。沒排賽程的組別（隊數不足等）交給每日自動結束（§7）。
      // 已解決＝confirmed／walkover／cancelled。最後一場是被取消的，也會走到這裡。
      const divs = await readQuery(deps, tx, deps.db.collection(`competitions/${cid}/divisions`).limit(LIMITS.divisionsMax));
      if (divs.empty || divs.docs.some(d => !d.get('schedule'))) return null;
      const remaining = await readCount(deps, tx, matches.where('status', 'not-in', [...RESOLVED_STATUSES]).count());
      if (remaining > 0) return null;
      const total = await readCount(deps, tx, matches.count());
      if (total === 0) return null;
      // 尚未確定會結束之前不讀積分榜（還有未解決場次的取消必須維持原讀數）。
      // 只取小組第 1 名。淘汰賽冠軍不在這一步。
      const champions = await loadChampions(deps, tx, cid, divs.docs);
      tx.update(compRef, {
        endedAt: FieldValue.serverTimestamp(), endedBy: 'confirm', champions,
        stateVersion: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp()
      });
      return 'set';
    }
    // 已解決場次回到未解決（重置確認／棄權，或把取消恢復成未賽）就解除末場確認造成的結束。
    // 手動結束（host）與自動結束（auto）不在這裡清。
    // 新排的場次不會走到這裡（before 為 null、after 未解決）：由 generateSchedule 同交易解除。
    if (wasResolved && !isResolved && comp.get('endedAt') && comp.get('endedBy') === 'confirm') {
      tx.update(compRef, {
        endedAt: null, endedBy: null, champions: FieldValue.delete(),
        stateVersion: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp()
      });
      return 'cleared';
    }
    return null;
  });
}

const WATCHED = ['status', 'score', 'penaltyScore', 'rev', 'kickoffAt', 'venueName', 'home', 'away', 'walkoverSide', 'matchNo', 'round'] as const;

/** §6.4：只在這些欄位變動時處理（時鐘、其他欄位變動直接返回）。penaltyScore 變了要重寫摘要的 p。 */
export function watchedChanged(before: DocumentData | null, after: DocumentData | null): boolean {
  if (!before || !after) return before !== after;
  return WATCHED.some(k => JSON.stringify(before[k] ?? null) !== JSON.stringify(after[k] ?? null));
}

function countsOrResolves(d: DocumentData | null): boolean {
  return !!d && (countedForStanding(d) || resolvedForEnd(d));
}

/**
 * 計分或結束相關才重讀場次、重算積分、判斷結束、更新射手榜。
 * 進行中的進球、牌、換人、改期、只改點球比分為 false。
 */
export function matchNeedsServerFollowUp(before: DocumentData | null, after: DocumentData | null): boolean {
  return countsOrResolves(before) || countsOrResolves(after);
}

function isConfirmed(d: DocumentData | null | undefined): boolean {
  return !!d && d.status === 'confirmed';
}

export interface MatchWrittenResult { summary: boolean; standing: boolean; ended: 'set' | 'cleared' | null }

/**
 * 觸發器本體。before＝觸發事件的寫入前資料（只用來找舊摘要片與「原本是否計入」）；寫入後一律重讀目前文件。
 */
export async function handleMatchWritten(
  deps: CpDeps, cid: string, mtId: string, before: DocumentData | null, afterHint?: DocumentData | null
): Promise<MatchWrittenResult> {
  if (afterHint !== undefined && !watchedChanged(before, afterHint)) return { summary: false, standing: false, ended: null };
  const summary = await syncSummary(deps, cid, mtId, before);
  // afterHint 為 null 或未傳：維持重讀目前文件（測試用 null 表示不信事件內容）。
  if (afterHint != null && !matchNeedsServerFollowUp(before, afterHint)) {
    return { summary, standing: false, ended: null };
  }
  const cur = await readDoc(deps, null, deps.db.doc(`competitions/${cid}/matches/${mtId}`));
  const after = cur.exists ? cur.data()! : null;
  const wasCounted = !!before && countedForStanding(before);
  const isCounted = !!after && countedForStanding(after);
  const wasResolved = !!before && resolvedForEnd(before);
  const isResolved = !!after && resolvedForEnd(after);
  let standing = false;
  if (wasCounted || isCounted) {
    const src = (after ?? before)!;
    const dvId = String(src.divisionId ?? '');
    const stageId = String(src.stageId ?? '');
    const groupId = String(src.groupId ?? '');
    if (dvId && stageId && groupId) {
      standing = await recomputeStanding(deps, cid, dvId, stageId, groupId);
      // 換組（理論上不會；保險）：舊組也重建
      if (before && after && (before.groupId !== after.groupId || before.stageId !== after.stageId)) {
        await recomputeStanding(deps, cid, String(before.divisionId), String(before.stageId), String(before.groupId));
      }
    }
  }
  const ended = (wasResolved || isResolved) ? await syncEnded(deps, cid, wasResolved, isResolved) : null;
  // 以重讀後的狀態為準，不信 hint：確認與重置亂序時，仍是 confirmed 才重建，否則刪掉該場。
  if (isConfirmed(before) !== isConfirmed(after)) {
    await syncMatchStats(deps, cid, mtId, before);
  }
  return { summary, standing, ended };
}
