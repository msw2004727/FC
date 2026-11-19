/**
 * cpHost.setDivisionRules：寫入組別比賽規則。
 * 掛在 HOST_ACTIONS，不放進 MATCH_HOST_ACTIONS（本檔要引用 match-host，避免循環）。
 * 計分有沒有變看 sameScoringInputs，不看鍵名清單：關閉的仁慈只改 cap 不算（cap 不參與計算）；只改 preset、criteria 沒變也不算。
 * 已有 confirmed 或 walkover 且計分有變才要求原因、公告、rulesChangedAt。finished 不算已確認。
 * 公告只列影響計分且值有變的項目，格式是「顯示名 改前→改後」，不列區塊標題、不出現鍵名。
 * 確認或棄權是否存在用聚合 count，不靠場次清單。重算改為每組各查一次，上限 240，多讀 1 筆用來發現截斷。
 * 取消（status==='cancelled'）在結束寬限之前擋下，連管理員都是 COMPETITION_CLOSED。
 */
import type { Transaction } from 'firebase-admin/firestore';
import {
  resolveRules, rulesDocumentOf, sameScoringInputs, validateRulesInput,
  type MatchLike, type ResolvedRules, type StandingDoc
} from '../engine/index.js';
import { bad, notFound, pre } from './errors.js';
import {
  CID_RE, DVID_RE, FieldValue, Timestamp, actorHash, readCount, readDoc, readQuery, requireId, writeAudit,
  type Caller, type CompDoc, type CpDeps, type GateResult
} from './context.js';
import { assertNotEnded, hostComp } from './match-host.js';
import { applyStanding, standingRef } from './match-trigger.js';
import { appendSystemNotice, taipeiMonthDay } from './notice.js';
import { rulesChangeNoticeText, scoringChangesOf } from './rules-notice.js';
import { cleanLine, findBannedWord } from './text.js';
import { onlyKeys } from './validate.js';

const REASON_MAX = 100;
/** 一組重算最多讀的場次。limit 多 1 筆：讀到就整筆不寫。 */
const GROUP_MATCH_MAX = 240;
/** 與 match-host 的 groupId、host.standingGroupIds 同一套。第 3 步的積分榜 id 用這組字。 */
const GROUP_ID_RE = /^[A-Za-z0-9]{1,8}$/;

const TIME_LOCKS = ['time.periods', 'time.halfMinutes', 'time.halftime.enabled', 'time.halftime.minutes'] as const;
const WALKOVER_LOCKS = [
  'walkover.scoreFor', 'walkover.scoreAgainst', 'walkover.awardPoints', 'walkover.penaltyPoints', 'walkover.countInGoalStats'
] as const;

type MatchRow = {
  matchId: string;
  status?: string;
  stageId?: unknown;
  groupId?: unknown;
  home?: { teamId?: unknown; name?: unknown } | null;
  away?: { teamId?: unknown; name?: unknown } | null;
};

function leavesOf(r: ResolvedRules): Record<string, unknown> {
  return {
    playersOnField: r.playersOnField,
    'squad.note': r.squad.note,
    'time.periods': r.time.periods,
    'time.halfMinutes': r.time.halfMinutes,
    'time.halftime.enabled': r.time.halftime.enabled,
    'time.halftime.minutes': r.time.halftime.minutes,
    'time.note': r.time.note,
    'substitution.mode': r.substitution.mode,
    'substitution.maxCount': r.substitution.maxCount,
    'substitution.note': r.substitution.note,
    'points.win': r.points.win,
    'points.draw': r.points.draw,
    'points.loss': r.points.loss,
    'points.note': r.points.note,
    'tieBreak.preset': r.tieBreak.preset,
    'tieBreak.criteria': r.tieBreak.criteria,
    'tieBreak.h2hScope': r.tieBreak.h2hScope,
    'tieBreak.note': r.tieBreak.note,
    'draw.roundRobin': r.draw.roundRobin,
    'draw.knockout': r.draw.knockout,
    'draw.note': r.draw.note,
    'walkover.scoreFor': r.walkover.scoreFor,
    'walkover.scoreAgainst': r.walkover.scoreAgainst,
    'walkover.awardPoints': r.walkover.awardPoints,
    'walkover.penaltyPoints': r.walkover.penaltyPoints,
    'walkover.countInGoalStats': r.walkover.countInGoalStats,
    'walkover.note': r.walkover.note,
    'late.graceMin': r.late.graceMin,
    'late.note': r.late.note,
    'suspension.enabled': r.suspension.enabled,
    'suspension.yellowThreshold': r.suspension.yellowThreshold,
    'suspension.yellowBanMatches': r.suspension.yellowBanMatches,
    'suspension.directRedBanMatches': r.suspension.directRedBanMatches,
    'suspension.note': r.suspension.note,
    'fairPlay.yellow': r.fairPlay.yellow,
    'fairPlay.secondYellow': r.fairPlay.secondYellow,
    'fairPlay.directRed': r.fairPlay.directRed,
    'fairPlay.yellowThenRed': r.fairPlay.yellowThenRed,
    'fairPlay.note': r.fairPlay.note,
    'mercy.enabled': r.mercy.enabled,
    'mercy.cap': r.mercy.cap,
    'mercy.note': r.mercy.note,
    'equipment.shinGuards': r.equipment.shinGuards,
    'equipment.sameColorKit': r.equipment.sameColorKit,
    'equipment.jerseyNumber': r.equipment.jerseyNumber,
    'equipment.note': r.equipment.note,
    'appeal.windowMin': r.appeal.windowMin,
    'appeal.depositTwd': r.appeal.depositTwd,
    'appeal.note': r.appeal.note
  };
}

function changedLeaves(before: ResolvedRules, after: ResolvedRules): string[] {
  const left = leavesOf(before);
  const right = leavesOf(after);
  const out: string[] = [];
  for (const key of Object.keys(left)) {
    if (JSON.stringify(left[key]) !== JSON.stringify(right[key])) out.push(key);
  }
  return out;
}

function firstLocked(changed: readonly string[], active: ReadonlySet<string>): string | null {
  for (const field of changed) {
    if (active.has(field)) return field;
  }
  return null;
}

/** 空白或未提供當沒填。有內容就驗 2～100 與禁用詞，就算這次還不必填原因。空白一律不當原因。 */
function optionalReason(v: unknown, banned: readonly string[]): string | null {
  if (v == null) return null;
  if (typeof v !== 'string') throw bad('FIELD_TYPE', { field: 'reason' });
  const s = cleanLine(v);
  if (!s) return null;
  const len = [...s].length;
  if (len < 2 || len > REASON_MAX) throw bad('FIELD_LENGTH', { field: 'reason', min: 2, max: REASON_MAX });
  if (findBannedWord(s, banned)) throw bad('BANNED_WORD', { field: 'reason' });
  return s;
}

function assertNotesClean(rules: object, banned: readonly string[]): void {
  const visit = (prefix: string, node: unknown) => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return;
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      const path = prefix ? `${prefix}.${k}` : k;
      if (k === 'note') {
        if (typeof v === 'string' && v.length > 0 && findBannedWord(v, banned)) throw bad('BANNED_WORD', { field: path });
      } else if (v && typeof v === 'object') visit(path, v);
    }
  };
  visit('', rules);
}

interface SchedGroup {
  groupId: string;
  /** null：清單上有這個組，但沒有 teamIds 陣列，不能重算。 */
  teamIds: string[] | null;
}

/** schedule.groups 裡形狀合格的 groupId。不合格的 id 不算已知文件。 */
function scheduleGroups(schedule: unknown): SchedGroup[] {
  if (!schedule || typeof schedule !== 'object') return [];
  const raw = (schedule as { groups?: unknown }).groups;
  if (!Array.isArray(raw)) return [];
  const out: SchedGroup[] = [];
  const seen = new Set<string>();
  for (const g of raw) {
    if (!g || typeof g !== 'object') continue;
    const groupId = (g as { groupId?: unknown }).groupId;
    if (typeof groupId !== 'string' || !GROUP_ID_RE.test(groupId) || seen.has(groupId)) continue;
    seen.add(groupId);
    const teamIdsRaw = (g as { teamIds?: unknown }).teamIds;
    const teamIds = Array.isArray(teamIdsRaw)
      ? teamIdsRaw.filter((id): id is string => typeof id === 'string')
      : null;
    out.push({ groupId, teamIds });
  }
  return out;
}

/**
 * 已知的積分榜 groupId。只讀這些文件 id，不列 standings 集合。
 * 清單上的組，再加上第 3 步固定會寫的 A（已在清單內不重複）。
 */
function knownStandingGroupIds(groups: readonly SchedGroup[]): string[] {
  const ids = groups.map(g => g.groupId);
  if (!ids.includes('A')) ids.push('A');
  return ids;
}

function namesOf(matches: readonly MatchRow[]): Record<string, string> {
  const names: Record<string, string> = {};
  for (const m of matches) {
    for (const side of ['home', 'away'] as const) {
      const t = m[side];
      if (t && typeof t.teamId === 'string' && typeof t.name === 'string' && t.name) names[t.teamId] = t.name;
    }
  }
  return names;
}

/**
 * buildStanding 只吃 teamMeta，不沿用前一版列上的隊名。
 * 先用這組已讀場次，缺的再補前一版積分榜列。不另讀 entries。
 */
function namesFor(matches: readonly MatchRow[], prevRows: unknown): Record<string, string> {
  const names = namesOf(matches);
  if (!Array.isArray(prevRows)) return names;
  for (const row of prevRows) {
    if (!row || typeof row !== 'object') continue;
    const teamId = (row as { teamId?: unknown }).teamId;
    const name = (row as { name?: unknown }).name;
    if (typeof teamId !== 'string' || names[teamId]) continue;
    if (typeof name === 'string' && name) names[teamId] = name;
  }
  return names;
}

export async function setDivisionRules(deps: CpDeps, caller: Caller, gate: GateResult, input: Record<string, unknown>) {
  onlyKeys(input, ['action', 'cid', 'dvId', 'rules', 'reason']);
  const cid = requireId(input.cid, CID_RE, 'cid');
  const dvId = requireId(input.dvId, DVID_RE, 'dvId');
  const checked = validateRulesInput(input.rules);
  if (checked.errors.length > 0) {
    const issue = checked.errors[0];
    throw bad(issue.reason, { field: issue.field });
  }
  const stored = rulesDocumentOf(input.rules);
  if (!stored) throw bad('FIELD_REQUIRED', { field: 'rules' });
  assertNotesClean(stored.rules, gate.bannedWords);
  const reason = optionalReason(input.reason, gate.bannedWords);

  return deps.db.runTransaction(async (tx: Transaction) => {
    const comp: CompDoc = await hostComp(deps, tx, caller, gate, cid);
    if (comp.status === 'cancelled') throw pre('COMPETITION_CLOSED');
    assertNotEnded(deps, comp, caller);

    const dvRef = deps.db.doc(`competitions/${cid}/divisions/${dvId}`);
    const dv = await readDoc(deps, tx, dvRef);
    if (!dv.exists) throw notFound('DIVISION_NOT_FOUND');
    const raw = (dv.data() ?? {}) as Record<string, unknown>;
    const old = resolveRules(raw);
    const nextDivision: Record<string, unknown> = { ...raw, playersOnField: stored.playersOnField, rules: stored.rules };
    const next = resolveRules(nextDivision);
    const changed = changedLeaves(old, next);

    const schedule = raw.schedule;
    const hasSchedule = !!schedule && typeof schedule === 'object';
    const entryCount = raw.entryCount;
    const hasEntries = typeof entryCount === 'number' && entryCount > 0;
    const structural = new Set<string>();
    if (hasEntries || hasSchedule) structural.add('playersOnField');
    if (hasSchedule) for (const field of TIME_LOCKS) structural.add(field);
    const structuralHit = firstLocked(changed, structural);
    if (structuralHit) throw pre('RULES_LOCKED', { field: structuralHit });

    const scoringChanged = !sameScoringInputs(old, next);
    const walkoverChanged = WALKOVER_LOCKS.some(field => changed.includes(field));
    const matchesCol = deps.db.collection(`competitions/${cid}/matches`);
    // 沒有賽程就不可能有場次。棄權鎖定用聚合，不逐場讀。
    if (hasSchedule && walkoverChanged) {
      const walkovers = await readCount(deps, tx, matchesCol
        .where('divisionId', '==', dvId).where('status', '==', 'walkover').count());
      if (walkovers > 0) {
        const hit = firstLocked(changed, new Set<string>(WALKOVER_LOCKS));
        if (hit) throw pre('RULES_LOCKED', { field: hit });
      }
    }
    // 透明條件不靠可能被截斷的場次清單。finished 不算。
    let transparent = false;
    if (hasSchedule && scoringChanged) {
      const settled = await readCount(deps, tx, matchesCol
        .where('divisionId', '==', dvId).where('status', 'in', ['confirmed', 'walkover']).count());
      transparent = settled > 0;
    }
    if (transparent && reason == null) throw bad('REASON_REQUIRED', { field: 'reason' });

    const groups = scheduleGroups(hasSchedule ? schedule : null);
    const byId = new Map(groups.map(g => [g.groupId, g]));
    const pending: Array<{
      ref: ReturnType<CpDeps['db']['doc']>;
      groupId: string;
      teamIds: string[];
      prev: Partial<StandingDoc>;
    }> = [];
    // 重算前比對清單與已知積分榜。對不上就不寫。不列整個 standings 集合。
    if (scoringChanged) {
      for (const groupId of knownStandingGroupIds(groups)) {
        const ref = standingRef(deps, cid, dvId, 'group', groupId);
        const prevSnap = await readDoc(deps, tx, ref);
        if (!prevSnap.exists) continue;
        const entry = byId.get(groupId);
        if (!entry || entry.teamIds == null) throw pre('STANDINGS_MISMATCH', { groupId });
        pending.push({
          ref, groupId, teamIds: entry.teamIds, prev: prevSnap.data() as Partial<StandingDoc>
        });
      }
    }

    const groupMatches = new Map<string, MatchRow[]>();
    for (const item of pending) {
      // 與 recomputeStanding 同一種等值查詢：divisionId、stageId、groupId。
      const snap = await readQuery(deps, tx, matchesCol
        .where('divisionId', '==', dvId)
        .where('stageId', '==', 'group')
        .where('groupId', '==', item.groupId)
        .limit(GROUP_MATCH_MAX + 1));
      if (snap.size > GROUP_MATCH_MAX) {
        throw pre('TOO_MANY_MATCHES', { count: snap.size, max: GROUP_MATCH_MAX, groupId: item.groupId });
      }
      groupMatches.set(item.groupId, snap.docs.map(d => ({ matchId: d.id, ...d.data() }) as MatchRow));
    }

    const divisionPatch: Record<string, unknown> = {
      playersOnField: stored.playersOnField,
      rules: stored.rules,
      updatedAt: FieldValue.serverTimestamp()
    };
    if (transparent) divisionPatch.rulesChangedAt = FieldValue.serverTimestamp();
    tx.update(dvRef, divisionPatch);

    const divisionName = typeof raw.name === 'string' ? raw.name : '';
    let recomputed = false;
    for (const item of pending) {
      const matches = groupMatches.get(item.groupId) ?? [];
      applyStanding(tx, item.ref, {
        cid, dvId, stageId: 'group', groupId: item.groupId,
        teamIds: item.teamIds,
        matches: matches as MatchLike[],
        division: nextDivision,
        divisionName,
        computedBy: 'cpHost:setDivisionRules',
        prev: { version: item.prev.version, manualOverride: item.prev.manualOverride, rows: item.prev.rows },
        names: namesFor(matches, item.prev.rows)
      });
      recomputed = true;
    }

    if (transparent && reason != null) {
      const md = taipeiMonthDay(deps.now().getTime()) ?? '';
      appendSystemNotice(tx, {
        ref: deps.db.doc(`competitions/${cid}`),
        notices: comp.notices,
        at: Timestamp.fromMillis(deps.now().getTime()),
        by: actorHash(cid, caller.uid)
      }, {
        kind: 'system',
        text: rulesChangeNoticeText({ monthDay: md, before: old, after: next, reason })
      });
    }

    writeAudit(deps, tx, cid, caller, 'setDivisionRules', {
      dvId, changed, changes: scoringChangesOf(old, next), reason, recomputed
    });
    return { dvId, recomputed, warnings: checked.warnings };
  });
}
