/**
 * message-system.test.js
 * ──────────────────────
 * Phase 0 — 站內信系統完整純函式測試
 * 覆蓋範圍：訊息過濾、未讀追蹤、團隊審核、賽事審核、排程、分塊、儲存計算
 * 目的：為 per-user inbox 架構遷移提供安全網
 */

// ═══════════════════════════════════════════════════
// 1. 從 message-inbox.js 提取的純函式
// ═══════════════════════════════════════════════════

/** 判斷訊息是否未讀（純函式版，注入 myUid）
 *  來源：message-inbox.js _isMessageUnread (lines 16-21)
 *  邏輯：readBy 陣列存在時只看 readBy，否則看 legacy unread 欄位 */
function _isMessageUnreadPure(msg, myUid) {
  if (!msg || !myUid) return false;
  if (Array.isArray(msg.readBy)) return !msg.readBy.includes(myUid);
  return !!msg.unread;
}

/** 過濾出屬於當前用戶的訊息（純函式版，注入用戶資訊）
 *  來源：message-inbox.js _filterMyMessages (lines 23-41)
 *  注意：targetUid/toUid 用 OR 短路取第一個 truthy 值比對（與源碼一致）
 *        targetTeamId 用 String() 轉型（與源碼一致） */
function _filterMyMessagesPure(messages, myUid, myRole, myTeamIds) {
  if (!Array.isArray(messages) || !myUid) return [];
  return messages.filter(m => {
    // 已隱藏
    if (Array.isArray(m.hiddenBy) && m.hiddenBy.includes(myUid)) return false;
    // 點對點（取第一個 truthy 值比對，與源碼 (m.targetUid || m.toUid) === myUid 一致）
    if (m.targetUid || m.toUid) return (m.targetUid || m.toUid) === myUid;
    // 俱樂部（String() 轉型與源碼一致）
    if (m.targetTeamId) return Array.isArray(myTeamIds) && myTeamIds.includes(String(m.targetTeamId));
    // 角色
    if (Array.isArray(m.targetRoles) && m.targetRoles.length > 0)
      return m.targetRoles.includes(myRole);
    // 廣播（無任何 target 欄位）
    return true;
  });
}

// ═══════════════════════════════════════════════════
// 2. 從 message-notify.js 提取的純函式
// ═══════════════════════════════════════════════════

/** 推斷訊息的 targetType */
function _inferMessageTargetType(targetUid, targetTeamId, targetRoles) {
  if (targetUid) return 'individual';
  if (targetTeamId) return 'team';
  if (Array.isArray(targetRoles) && targetRoles.length > 0) return 'role';
  return 'all';
}

/** 截斷訊息預覽文字 */
function _truncateMessagePreview(body, maxLength) {
  if (maxLength === undefined) maxLength = 40;
  if (!body) return '';
  return body.length > maxLength ? body.slice(0, maxLength) + '...' : body;
}

/** 格式化訊息時間戳 */
function _formatMessageTimestamp(date) {
  if (!date || !(date instanceof Date) || isNaN(date.getTime())) return '';
  const y = date.getFullYear();
  const M = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  return `${y}/${M}/${d} ${h}:${m}`;
}

// ═══════════════════════════════════════════════════
// 3. 從 message-actions.js 提取的純函式
// ═══════════════════════════════════════════════════

/** 取得賽事訊息的群組 ID */
function _getTournamentMessageGroupId(msg) {
  return String(
    msg?.meta?.messageGroupId
    || msg?.meta?.groupId
    || msg?.messageGroupId
    || msg?.groupId
    || ''
  ).trim();
}

function _extractTournamentNameFromMessage(msg) {
  const directName = String(msg?.meta?.tournamentName || msg?.tournamentName || '').trim();
  if (directName) return directName;
  const body = String(msg?.body || msg?.preview || '').trim();
  const match = body.match(/參加「([^」]+)」/) || body.match(/賽事[：:]\s*([^\n]+)/);
  return String(match?.[1] || '').trim();
}

function _resolveTournamentMessageTournamentId(msg, tournaments = []) {
  const directId = String(
    msg?.meta?.tournamentId
    || msg?.tournamentId
    || ((msg?.meta?.linkType || msg?.linkType) === 'tournament' ? (msg?.meta?.linkId || msg?.linkId || msg?.targetId) : '')
    || ''
  ).trim();
  if (directId) return directId;

  const tournamentName = _extractTournamentNameFromMessage(msg);
  if (!tournamentName) return '';
  const match = tournaments.find(tournament =>
    String(tournament?.name || '').trim() === tournamentName
  );
  return String(match?.id || match?._docId || '').trim();
}

/** 將訊息陣列分成固定大小的 chunk（Firestore batch 上限）
 *  來源：message-actions.js clearAllMessages (line 55) */
function _chunkMessages(messages, chunkSize) {
  if (chunkSize === undefined) chunkSize = 450;
  if (!Array.isArray(messages) || messages.length === 0) return [];
  if (chunkSize <= 0) return [messages];  // 防止無限迴圈
  const result = [];
  for (let i = 0; i < messages.length; i += chunkSize) {
    result.push(messages.slice(i, i + chunkSize));
  }
  return result;
}

/** 依 groupId 過濾同一群組的訊息 */
function _getMessagesByGroupId(messages, groupId) {
  if (!Array.isArray(messages) || !groupId) return [];
  return messages.filter(m => {
    const gid = (m.meta && (m.meta.messageGroupId || m.meta.groupId)) || '';
    return gid === groupId;
  });
}

/** 動作 → 狀態對照表 */
function _buildActionStatusMap(action) {
  const map = { approve: 'approved', reject: 'rejected', ignore: 'ignored' };
  return map[action] || null;
}

function _isPendingActionMessage(msg) {
  return !!(
    msg
    && msg.actionType
    && String(msg.actionStatus || '').trim().toLowerCase() === 'pending'
  );
}

function _getInboxRemoveConfirmText(msg) {
  if (_isPendingActionMessage(msg)) {
    return '\u9019\u53ea\u6703\u5c07\u9019\u5c01\u901a\u77e5\u5f9e\u4f60\u7684\u6536\u4ef6\u5323\u79fb\u9664\uff0c\u4e0d\u6703\u53d6\u6d88\u5831\u540d\u3001\u4e0d\u6703\u901a\u904e\u6216\u62d2\u7d55\u5be9\u6838\uff0c\u4e5f\u4e0d\u6703\u522a\u9664\u8cfd\u4e8b\u6216\u4ff1\u6a02\u90e8\u7533\u8acb\u3002\u78ba\u5b9a\u8981\u79fb\u9664\u55ce\uff1f';
  }
  return '\u78ba\u5b9a\u8981\u5c07\u9019\u5c01\u8a0a\u606f\u5f9e\u4f60\u7684\u6536\u4ef6\u5323\u79fb\u9664\u55ce\uff1f';
}

// ═══════════════════════════════════════════════════
// 4. 從 message-actions-team.js 提取的純函式
// ═══════════════════════════════════════════════════

/** 正規化用戶的俱樂部成員身分（合併 teamId/teamIds/teamName/teamNames）
 *  來源：message-actions-team.js (lines 68-87)
 *  注意：ID 和 Name 都經過 String().trim() 正規化（與源碼一致） */
function _normalizeMembership(data) {
  if (!data) return { ids: [], names: [] };
  const ids = [];
  const names = [];
  const seen = new Set();
  const norm = (v) => String(v || '').trim();
  // 處理 teamIds 陣列
  if (Array.isArray(data.teamIds)) {
    data.teamIds.forEach((id, i) => {
      const tid = norm(id);
      if (!tid || seen.has(tid)) return;
      seen.add(tid);
      ids.push(tid);
      names.push(norm(Array.isArray(data.teamNames) ? data.teamNames[i] : ''));
    });
  }
  // 處理單一 teamId（可能不在 teamIds 內）
  const singleId = norm(data.teamId);
  if (singleId && !seen.has(singleId)) {
    seen.add(singleId);
    ids.push(singleId);
    names.push(norm(data.teamName));
  }
  return { ids, names };
}

/** 檢查是否已經是某俱樂部的成員 */
function _shouldAddMembershipToTeam(membership, targetTeamId) {
  if (!targetTeamId || !membership) return false;
  return !membership.ids.includes(targetTeamId);
}

/** 建構加入俱樂部後的 membership 更新物件 */
function _buildMembershipUpdate(membership, teamId, teamName) {
  if (!membership || !teamId) return null;
  const newIds = [...membership.ids];
  const newNames = [...membership.names];
  if (!newIds.includes(teamId)) {
    newIds.push(teamId);
    newNames.push(teamName || '');
  }
  return {
    teamId: newIds[0] || teamId,
    teamName: newNames[0] || teamName || '',
    teamIds: newIds,
    teamNames: newNames,
  };
}

/** 找出同一群組中已被其他人處理的訊息（first-action-wins）
 *  來源：message-actions-team.js (lines 39-44)
 *  注意：只匹配 actionType === 'team_join_request'，用 meta.groupId 直接比對 */
function _findAlreadyActedMessage(messages, msgId, groupId) {
  if (!Array.isArray(messages) || !groupId) return null;
  return messages.find(m =>
    m.id !== msgId &&
    m.actionType === 'team_join_request' &&
    m.meta && m.meta.groupId === groupId &&
    m.actionStatus && m.actionStatus !== 'pending'
  ) || null;
}

// ═══════════════════════════════════════════════════
// 5. 從 message-render.js 提取的純函式
// ═══════════════════════════════════════════════════

/** 依關鍵字過濾訊息 */
function _filterMessagesByKeyword(messages, keyword) {
  if (!Array.isArray(messages) || !keyword) return messages || [];
  const kw = keyword.toLowerCase();
  return messages.filter(m =>
    (m.title || '').toLowerCase().includes(kw) ||
    (m.preview || '').toLowerCase().includes(kw) ||
    (m.body || '').toLowerCase().includes(kw) ||
    (m.senderName || '').toLowerCase().includes(kw)
  );
}

/** 依日期過濾訊息 */
function _filterMessagesByDate(messages, dateStr) {
  if (!Array.isArray(messages) || !dateStr) return messages || [];
  const prefix = dateStr.replace(/-/g, '/');
  return messages.filter(m => (m.time || '').startsWith(prefix));
}

/** 依時間排序訊息（最新在前） */
function _sortMessagesByTime(messages) {
  if (!Array.isArray(messages)) return [];
  return [...messages].sort((a, b) => (b.time || '').localeCompare(a.time || ''));
}

/** 計算未讀數 */
function _getUnreadCount(messages, currentUid) {
  if (!Array.isArray(messages) || !currentUid) return 0;
  return messages.filter(m => _isMessageUnreadPure(m, currentUid)).length;
}

/** 計算儲存容量 */
function _calculateStorageUsage(messageCount, totalCapacity) {
  if (totalCapacity === undefined) totalCapacity = 50;
  const used = Math.max(0, messageCount || 0);
  const remaining = Math.max(0, totalCapacity - used);
  return { used, remaining, total: totalCapacity, text: `${used} / ${totalCapacity}` };
}

// ═══════════════════════════════════════════════════
// 6. 從 message-admin.js 提取的純函式
// ═══════════════════════════════════════════════════

/** 篩選已到期的排程訊息 */
function _getScheduledMessagesDue(messages, nowMs) {
  if (!Array.isArray(messages)) return [];
  return messages.filter(m => {
    if (m.status !== 'scheduled') return false;
    if (!m.scheduledAt) return false;
    const t = typeof m.scheduledAt === 'string' ? new Date(m.scheduledAt).getTime() : m.scheduledAt;
    return !isNaN(t) && t <= nowMs;
  });
}

/** 取得處理者 ID */
function _getProcessorId(user) {
  if (!user) return 'system';
  return user.uid || user.name || 'system';
}

/** 截斷錯誤訊息 */
function _getTruncatedErrorMessage(err, maxLen) {
  if (maxLen === undefined) maxLen = 300;
  if (!err) return 'unknown_error';
  const msg = (err.message || err.toString() || 'schedule_send_failed');
  return msg.length > maxLen ? msg.slice(0, maxLen) : msg;
}

// ═══════════════════════════════════════════════════
// ============ T E S T S ============
// ═══════════════════════════════════════════════════

describe('Message System — Phase 0 Pre-Migration Tests', () => {

  // ─── 1. _isMessageUnreadPure ───
  describe('_isMessageUnreadPure', () => {
    test('null msg returns false', () => {
      expect(_isMessageUnreadPure(null, 'u1')).toBe(false);
    });
    test('null uid returns false', () => {
      expect(_isMessageUnreadPure({ title: 'hi' }, null)).toBe(false);
    });
    test('no readBy, no unread flag → defaults to legacy unread (falsy = false)', () => {
      // 無 readBy 陣列 → 走 legacy 路徑 → !!undefined = false
      expect(_isMessageUnreadPure({ title: 'hi' }, 'u1')).toBe(false);
    });
    test('no readBy, unread: true → unread (legacy)', () => {
      expect(_isMessageUnreadPure({ unread: true }, 'u1')).toBe(true);
    });
    test('readBy includes myUid → read', () => {
      expect(_isMessageUnreadPure({ readBy: ['u1', 'u2'] }, 'u1')).toBe(false);
    });
    test('readBy does NOT include myUid → unread', () => {
      expect(_isMessageUnreadPure({ readBy: ['u2'] }, 'u1')).toBe(true);
    });
    test('readBy present + unread:false → readBy takes priority (unread because not in readBy)', () => {
      // 關鍵：readBy 存在時只看 readBy，不看 unread 欄位
      expect(_isMessageUnreadPure({ readBy: ['u2'], unread: false }, 'u1')).toBe(true);
    });
    test('readBy present + unread:true → readBy takes priority (read because in readBy)', () => {
      expect(_isMessageUnreadPure({ readBy: ['u1'], unread: true }, 'u1')).toBe(false);
    });
    test('unread explicitly false (no readBy) → read', () => {
      expect(_isMessageUnreadPure({ unread: false }, 'u1')).toBe(false);
    });
    test('empty readBy array → unread (not in empty array)', () => {
      expect(_isMessageUnreadPure({ readBy: [] }, 'u1')).toBe(true);
    });
    test('readBy non-array (string) → falls to legacy path', () => {
      expect(_isMessageUnreadPure({ readBy: 'u1', unread: true }, 'u1')).toBe(true);
    });
  });

  // ─── 2. _filterMyMessagesPure ───
  describe('_filterMyMessagesPure', () => {
    const msgs = [
      { id: '1', targetUid: 'u1', title: 'direct to u1' },
      { id: '2', targetUid: 'u2', title: 'direct to u2' },
      { id: '3', toUid: 'u1', title: 'toUid u1' },
      { id: '4', targetTeamId: 'teamA', title: 'team A broadcast' },
      { id: '5', targetTeamId: 'teamB', title: 'team B broadcast' },
      { id: '6', targetRoles: ['coach'], title: 'coach role broadcast' },
      { id: '7', targetRoles: ['admin'], title: 'admin role broadcast' },
      { id: '8', title: 'global broadcast' },
      { id: '9', targetUid: 'u1', hiddenBy: ['u1'], title: 'hidden' },
    ];

    test('returns empty for null messages', () => {
      expect(_filterMyMessagesPure(null, 'u1', 'user', [])).toEqual([]);
    });
    test('returns empty for null uid', () => {
      expect(_filterMyMessagesPure(msgs, null, 'user', [])).toEqual([]);
    });
    test('shows direct messages (targetUid)', () => {
      const result = _filterMyMessagesPure(msgs, 'u1', 'user', []);
      expect(result.find(m => m.id === '1')).toBeTruthy();
      expect(result.find(m => m.id === '2')).toBeFalsy();
    });
    test('shows direct messages (toUid)', () => {
      const result = _filterMyMessagesPure(msgs, 'u1', 'user', []);
      expect(result.find(m => m.id === '3')).toBeTruthy();
    });
    test('shows team broadcast if member', () => {
      const result = _filterMyMessagesPure(msgs, 'u1', 'user', ['teamA']);
      expect(result.find(m => m.id === '4')).toBeTruthy();
      expect(result.find(m => m.id === '5')).toBeFalsy();
    });
    test('shows role broadcast if role matches', () => {
      const result = _filterMyMessagesPure(msgs, 'u1', 'coach', []);
      expect(result.find(m => m.id === '6')).toBeTruthy();
      expect(result.find(m => m.id === '7')).toBeFalsy();
    });
    test('shows global broadcast (no target)', () => {
      const result = _filterMyMessagesPure(msgs, 'u1', 'user', []);
      expect(result.find(m => m.id === '8')).toBeTruthy();
    });
    test('excludes hidden messages', () => {
      const result = _filterMyMessagesPure(msgs, 'u1', 'user', []);
      expect(result.find(m => m.id === '9')).toBeFalsy();
    });
    test('multi-team user sees all team broadcasts', () => {
      const result = _filterMyMessagesPure(msgs, 'u1', 'user', ['teamA', 'teamB']);
      expect(result.find(m => m.id === '4')).toBeTruthy();
      expect(result.find(m => m.id === '5')).toBeTruthy();
    });
    test('targetUid OR short-circuit: targetUid=other + toUid=me → excluded (source uses first truthy)', () => {
      const m = [{ id: 'x', targetUid: 'other', toUid: 'u1' }];
      const result = _filterMyMessagesPure(m, 'u1', 'user', []);
      expect(result).toHaveLength(0);  // (targetUid || toUid) = 'other' !== 'u1'
    });
    test('numeric targetTeamId matches via String() coercion', () => {
      const m = [{ id: 'x', targetTeamId: 123 }];
      const result = _filterMyMessagesPure(m, 'u1', 'user', ['123']);
      expect(result).toHaveLength(1);
    });
    test('hiddenBy on broadcast message excludes it', () => {
      const m = [{ id: 'x', title: 'broadcast', hiddenBy: ['u1'] }];
      expect(_filterMyMessagesPure(m, 'u1', 'user', [])).toHaveLength(0);
    });
    test('hiddenBy on team message excludes it', () => {
      const m = [{ id: 'x', targetTeamId: 'teamA', hiddenBy: ['u1'] }];
      expect(_filterMyMessagesPure(m, 'u1', 'user', ['teamA'])).toHaveLength(0);
    });
    test('hiddenBy by other user does not affect me', () => {
      const m = [{ id: 'x', title: 'broadcast', hiddenBy: ['u2'] }];
      expect(_filterMyMessagesPure(m, 'u1', 'user', [])).toHaveLength(1);
    });
  });

  // ─── 3. _inferMessageTargetType ───
  describe('_inferMessageTargetType', () => {
    test('individual when targetUid set', () => {
      expect(_inferMessageTargetType('u1', null, null)).toBe('individual');
    });
    test('team when targetTeamId set', () => {
      expect(_inferMessageTargetType(null, 'teamA', null)).toBe('team');
    });
    test('role when targetRoles set', () => {
      expect(_inferMessageTargetType(null, null, ['coach'])).toBe('role');
    });
    test('all when nothing set', () => {
      expect(_inferMessageTargetType(null, null, null)).toBe('all');
    });
    test('all when targetRoles is empty array', () => {
      expect(_inferMessageTargetType(null, null, [])).toBe('all');
    });
    test('individual takes priority over team', () => {
      expect(_inferMessageTargetType('u1', 'teamA', ['coach'])).toBe('individual');
    });
  });

  // ─── 4. _truncateMessagePreview ───
  describe('_truncateMessagePreview', () => {
    test('null returns empty', () => {
      expect(_truncateMessagePreview(null)).toBe('');
    });
    test('short string unchanged', () => {
      expect(_truncateMessagePreview('hello')).toBe('hello');
    });
    test('exact 40 chars unchanged', () => {
      const s = 'a'.repeat(40);
      expect(_truncateMessagePreview(s)).toBe(s);
    });
    test('41 chars truncated with ellipsis', () => {
      const s = 'a'.repeat(41);
      expect(_truncateMessagePreview(s)).toBe('a'.repeat(40) + '...');
    });
    test('custom maxLength', () => {
      expect(_truncateMessagePreview('abcdefgh', 5)).toBe('abcde...');
    });
  });

  // ─── 5. _formatMessageTimestamp ───
  describe('_formatMessageTimestamp', () => {
    test('null returns empty', () => {
      expect(_formatMessageTimestamp(null)).toBe('');
    });
    test('invalid date returns empty', () => {
      expect(_formatMessageTimestamp(new Date('invalid'))).toBe('');
    });
    test('formats correctly with zero-padding', () => {
      const d = new Date(2026, 0, 5, 9, 3);  // 2026/01/05 09:03
      expect(_formatMessageTimestamp(d)).toBe('2026/01/05 09:03');
    });
    test('formats PM time', () => {
      const d = new Date(2026, 11, 25, 23, 59);  // 2026/12/25 23:59
      expect(_formatMessageTimestamp(d)).toBe('2026/12/25 23:59');
    });
  });

  // ─── 6. _getTournamentMessageGroupId ───
  describe('_getTournamentMessageGroupId', () => {
    test('null msg returns empty', () => {
      expect(_getTournamentMessageGroupId(null)).toBe('');
    });
    test('no meta returns empty', () => {
      expect(_getTournamentMessageGroupId({})).toBe('');
    });
    test('uses messageGroupId first', () => {
      expect(_getTournamentMessageGroupId({ meta: { messageGroupId: 'g1', groupId: 'g2' } })).toBe('g1');
    });
    test('falls back to groupId', () => {
      expect(_getTournamentMessageGroupId({ meta: { groupId: 'g2' } })).toBe('g2');
    });
    test('trims whitespace', () => {
      expect(_getTournamentMessageGroupId({ meta: { groupId: '  g3  ' } })).toBe('g3');
    });
    test('falls back to top-level messageGroupId for legacy friendly notifications', () => {
      expect(_getTournamentMessageGroupId({ messageGroupId: 'g4' })).toBe('g4');
    });
  });

  describe('_resolveTournamentMessageTournamentId', () => {
    test('uses meta tournamentId first', () => {
      expect(_resolveTournamentMessageTournamentId({ meta: { tournamentId: 'ct_meta' }, tournamentId: 'ct_top' })).toBe('ct_meta');
    });
    test('falls back to top-level tournamentId for legacy friendly notifications', () => {
      expect(_resolveTournamentMessageTournamentId({ tournamentId: 'ct_top' })).toBe('ct_top');
    });
    test('falls back to tournament link id', () => {
      expect(_resolveTournamentMessageTournamentId({ linkType: 'tournament', linkId: 'ct_link' })).toBe('ct_link');
    });
    test('recovers id from tournament name in message body', () => {
      const msg = { body: '俱樂部「美躲test」已申請參加「測試杯」。' };
      expect(_resolveTournamentMessageTournamentId(msg, [{ id: 'ct_name', name: '測試杯' }])).toBe('ct_name');
    });
  });

  // ─── 7. _chunkMessages ───
  describe('_chunkMessages', () => {
    test('empty array returns empty', () => {
      expect(_chunkMessages([])).toEqual([]);
    });
    test('null returns empty', () => {
      expect(_chunkMessages(null)).toEqual([]);
    });
    test('3 items with chunk size 2 → 2 chunks', () => {
      const items = ['a', 'b', 'c'];
      const result = _chunkMessages(items, 2);
      expect(result).toEqual([['a', 'b'], ['c']]);
    });
    test('4 items with chunk size 2 → 2 even chunks', () => {
      const items = ['a', 'b', 'c', 'd'];
      expect(_chunkMessages(items, 2)).toEqual([['a', 'b'], ['c', 'd']]);
    });
    test('default chunk size is 450', () => {
      const items = Array.from({ length: 451 }, (_, i) => i);
      const result = _chunkMessages(items);
      expect(result.length).toBe(2);
      expect(result[0].length).toBe(450);
      expect(result[1].length).toBe(1);
    });
    test('single item → single chunk', () => {
      expect(_chunkMessages(['x'])).toEqual([['x']]);
    });
    test('chunkSize 0 → returns single chunk (guard against infinite loop)', () => {
      expect(_chunkMessages(['a', 'b'], 0)).toEqual([['a', 'b']]);
    });
    test('chunkSize negative → returns single chunk (guard)', () => {
      expect(_chunkMessages(['a', 'b'], -1)).toEqual([['a', 'b']]);
    });
    test('chunkSize 1 → each item its own chunk', () => {
      expect(_chunkMessages(['a', 'b', 'c'], 1)).toEqual([['a'], ['b'], ['c']]);
    });
  });

  // ─── 8. _getMessagesByGroupId ───
  describe('_getMessagesByGroupId', () => {
    const msgs = [
      { id: '1', meta: { messageGroupId: 'g1' } },
      { id: '2', meta: { groupId: 'g1' } },
      { id: '3', meta: { messageGroupId: 'g2' } },
      { id: '4', meta: {} },
      { id: '5' },
    ];
    test('finds by messageGroupId', () => {
      const result = _getMessagesByGroupId(msgs, 'g1');
      expect(result.map(m => m.id)).toEqual(['1', '2']);
    });
    test('finds by groupId fallback', () => {
      const result = _getMessagesByGroupId(msgs, 'g2');
      expect(result.map(m => m.id)).toEqual(['3']);
    });
    test('no match returns empty', () => {
      expect(_getMessagesByGroupId(msgs, 'g999')).toEqual([]);
    });
    test('null groupId returns empty', () => {
      expect(_getMessagesByGroupId(msgs, null)).toEqual([]);
    });
    test('null messages returns empty', () => {
      expect(_getMessagesByGroupId(null, 'g1')).toEqual([]);
    });
  });

  // ─── 9. _buildActionStatusMap ───
  describe('_buildActionStatusMap', () => {
    test('approve → approved', () => {
      expect(_buildActionStatusMap('approve')).toBe('approved');
    });
    test('reject → rejected', () => {
      expect(_buildActionStatusMap('reject')).toBe('rejected');
    });
    test('ignore → ignored', () => {
      expect(_buildActionStatusMap('ignore')).toBe('ignored');
    });
    test('unknown → null', () => {
      expect(_buildActionStatusMap('xyz')).toBeNull();
    });
    test('null → null', () => {
      expect(_buildActionStatusMap(null)).toBeNull();
    });
  });

  // ─── 10. Inbox removal helpers ───
  describe('_isPendingActionMessage', () => {
    test('returns true only for pending action messages', () => {
      expect(_isPendingActionMessage({ actionType: 'team_join_request', actionStatus: 'pending' })).toBe(true);
      expect(_isPendingActionMessage({ actionType: 'team_join_request', actionStatus: ' Pending ' })).toBe(true);
      expect(_isPendingActionMessage({ actionType: 'team_join_request', actionStatus: 'approved' })).toBe(false);
      expect(_isPendingActionMessage({ actionStatus: 'pending' })).toBe(false);
      expect(_isPendingActionMessage(null)).toBe(false);
    });
  });

  describe('_getInboxRemoveConfirmText', () => {
    test('explains pending removal is inbox-only and does not approve or reject', () => {
      const text = _getInboxRemoveConfirmText({ actionType: 'team_join_request', actionStatus: 'pending' });
      expect(text).toContain('\u6536\u4ef6\u5323\u79fb\u9664');
      expect(text).toContain('\u4e0d\u6703\u53d6\u6d88\u5831\u540d');
      expect(text).toContain('\u4e0d\u6703\u901a\u904e\u6216\u62d2\u7d55\u5be9\u6838');
    });

    test('uses a shorter confirm for normal inbox messages', () => {
      const text = _getInboxRemoveConfirmText({ actionStatus: 'read' });
      expect(text).toContain('\u9019\u5c01\u8a0a\u606f');
      expect(text).not.toContain('\u4e0d\u6703\u901a\u904e\u6216\u62d2\u7d55\u5be9\u6838');
    });
  });

  // ─── 11. _normalizeMembership ───
  describe('_normalizeMembership', () => {
    test('null data returns empty', () => {
      expect(_normalizeMembership(null)).toEqual({ ids: [], names: [] });
    });
    test('empty object returns empty', () => {
      expect(_normalizeMembership({})).toEqual({ ids: [], names: [] });
    });
    test('single teamId only', () => {
      expect(_normalizeMembership({ teamId: 't1', teamName: 'Team 1' }))
        .toEqual({ ids: ['t1'], names: ['Team 1'] });
    });
    test('teamIds array', () => {
      expect(_normalizeMembership({
        teamIds: ['t1', 't2'],
        teamNames: ['Team 1', 'Team 2']
      })).toEqual({ ids: ['t1', 't2'], names: ['Team 1', 'Team 2'] });
    });
    test('dedup: teamId already in teamIds', () => {
      expect(_normalizeMembership({
        teamId: 't1', teamName: 'Team 1',
        teamIds: ['t1', 't2'], teamNames: ['Team 1', 'Team 2']
      })).toEqual({ ids: ['t1', 't2'], names: ['Team 1', 'Team 2'] });
    });
    test('teamId NOT in teamIds → appended', () => {
      expect(_normalizeMembership({
        teamId: 't3', teamName: 'Team 3',
        teamIds: ['t1', 't2'], teamNames: ['Team 1', 'Team 2']
      })).toEqual({ ids: ['t1', 't2', 't3'], names: ['Team 1', 'Team 2', 'Team 3'] });
    });
    test('duplicate teamIds deduped', () => {
      expect(_normalizeMembership({
        teamIds: ['t1', 't1', 't2'], teamNames: ['A', 'B', 'C']
      })).toEqual({ ids: ['t1', 't2'], names: ['A', 'C'] });
    });
    test('missing teamNames fills empty string', () => {
      expect(_normalizeMembership({
        teamIds: ['t1', 't2']
      })).toEqual({ ids: ['t1', 't2'], names: ['', ''] });
    });
    test('mismatched array lengths (names shorter)', () => {
      expect(_normalizeMembership({
        teamIds: ['t1', 't2', 't3'], teamNames: ['A']
      })).toEqual({ ids: ['t1', 't2', 't3'], names: ['A', '', ''] });
    });
    test('numeric teamId coerced to string via String().trim()', () => {
      expect(_normalizeMembership({ teamId: 123, teamName: 'Num Team' }))
        .toEqual({ ids: ['123'], names: ['Num Team'] });
    });
    test('whitespace in teamId trimmed', () => {
      expect(_normalizeMembership({ teamId: '  t1  ', teamName: '  Team 1  ' }))
        .toEqual({ ids: ['t1'], names: ['Team 1'] });
    });
    test('numeric teamIds in array coerced to string', () => {
      expect(_normalizeMembership({ teamIds: [1, 2], teamNames: ['A', 'B'] }))
        .toEqual({ ids: ['1', '2'], names: ['A', 'B'] });
    });
  });

  // ─── 11. _shouldAddMembershipToTeam ───
  describe('_shouldAddMembershipToTeam', () => {
    test('should add if not member', () => {
      expect(_shouldAddMembershipToTeam({ ids: ['t1'] }, 't2')).toBe(true);
    });
    test('should NOT add if already member', () => {
      expect(_shouldAddMembershipToTeam({ ids: ['t1', 't2'] }, 't2')).toBe(false);
    });
    test('null targetTeamId returns false', () => {
      expect(_shouldAddMembershipToTeam({ ids: [] }, null)).toBe(false);
    });
    test('null membership returns false', () => {
      expect(_shouldAddMembershipToTeam(null, 't1')).toBe(false);
    });
    test('empty membership → should add', () => {
      expect(_shouldAddMembershipToTeam({ ids: [] }, 't1')).toBe(true);
    });
  });

  // ─── 12. _buildMembershipUpdate ───
  describe('_buildMembershipUpdate', () => {
    test('add to empty membership', () => {
      const result = _buildMembershipUpdate({ ids: [], names: [] }, 't1', 'Team 1');
      expect(result).toEqual({
        teamId: 't1', teamName: 'Team 1',
        teamIds: ['t1'], teamNames: ['Team 1'],
      });
    });
    test('add to existing membership (primary stays)', () => {
      const result = _buildMembershipUpdate(
        { ids: ['t1'], names: ['Team 1'] }, 't2', 'Team 2'
      );
      expect(result.teamId).toBe('t1');       // primary unchanged
      expect(result.teamIds).toEqual(['t1', 't2']);
      expect(result.teamNames).toEqual(['Team 1', 'Team 2']);
    });
    test('already member → no duplicate', () => {
      const result = _buildMembershipUpdate(
        { ids: ['t1'], names: ['Team 1'] }, 't1', 'Team 1'
      );
      expect(result.teamIds).toEqual(['t1']);
      expect(result.teamNames).toEqual(['Team 1']);
    });
    test('null membership returns null', () => {
      expect(_buildMembershipUpdate(null, 't1', 'T1')).toBeNull();
    });
    test('null teamId returns null', () => {
      expect(_buildMembershipUpdate({ ids: [], names: [] }, null, 'T1')).toBeNull();
    });
  });

  // ─── 13. _findAlreadyActedMessage (first-action-wins) ───
  describe('_findAlreadyActedMessage', () => {
    const msgs = [
      { id: 'm1', actionType: 'team_join_request', meta: { groupId: 'g1' }, actionStatus: 'pending' },
      { id: 'm2', actionType: 'team_join_request', meta: { groupId: 'g1' }, actionStatus: 'approved' },
      { id: 'm3', actionType: 'team_join_request', meta: { groupId: 'g1' }, actionStatus: 'pending' },
      { id: 'm4', actionType: 'team_join_request', meta: { groupId: 'g2' }, actionStatus: 'rejected' },
    ];

    test('finds acted message in same group', () => {
      const result = _findAlreadyActedMessage(msgs, 'm1', 'g1');
      expect(result.id).toBe('m2');
    });
    test('excludes self from results', () => {
      const result = _findAlreadyActedMessage(msgs, 'm2', 'g1');
      expect(result).toBeNull();
    });
    test('different group → null', () => {
      expect(_findAlreadyActedMessage(msgs, 'm1', 'g999')).toBeNull();
    });
    test('null messages → null', () => {
      expect(_findAlreadyActedMessage(null, 'm1', 'g1')).toBeNull();
    });
    test('null groupId → null', () => {
      expect(_findAlreadyActedMessage(msgs, 'm1', null)).toBeNull();
    });
    test('all pending → null', () => {
      const allPending = [
        { id: 'm1', actionType: 'team_join_request', meta: { groupId: 'g1' }, actionStatus: 'pending' },
        { id: 'm2', actionType: 'team_join_request', meta: { groupId: 'g1' }, actionStatus: 'pending' },
      ];
      expect(_findAlreadyActedMessage(allPending, 'm1', 'g1')).toBeNull();
    });
    test('different actionType in same group → ignored (only matches team_join_request)', () => {
      const mixed = [
        { id: 'm1', actionType: 'team_join_request', meta: { groupId: 'g1' }, actionStatus: 'pending' },
        { id: 'm2', actionType: 'tournament_register_request', meta: { groupId: 'g1' }, actionStatus: 'approved' },
      ];
      expect(_findAlreadyActedMessage(mixed, 'm1', 'g1')).toBeNull();
    });
    test('uses meta.groupId directly (not messageGroupId)', () => {
      const withMsgGroupId = [
        { id: 'm1', actionType: 'team_join_request', meta: { groupId: 'g1' }, actionStatus: 'pending' },
        { id: 'm2', actionType: 'team_join_request', meta: { messageGroupId: 'g1' }, actionStatus: 'approved' },
      ];
      // m2 has messageGroupId but not groupId → should NOT match
      expect(_findAlreadyActedMessage(withMsgGroupId, 'm1', 'g1')).toBeNull();
    });
  });

  // ─── 14. _filterMessagesByKeyword ───
  describe('_filterMessagesByKeyword', () => {
    const msgs = [
      { id: '1', title: 'Football Match', body: 'Come play!', senderName: 'Admin' },
      { id: '2', title: '報名通知', body: '你已報名成功', senderName: '系統' },
      { id: '3', title: 'Welcome', preview: 'welcome to SportHub' },
    ];
    test('null keyword returns all', () => {
      expect(_filterMessagesByKeyword(msgs, null)).toHaveLength(3);
    });
    test('matches title', () => {
      expect(_filterMessagesByKeyword(msgs, 'football')).toHaveLength(1);
    });
    test('matches body', () => {
      expect(_filterMessagesByKeyword(msgs, '報名成功')).toHaveLength(1);
    });
    test('matches senderName', () => {
      expect(_filterMessagesByKeyword(msgs, 'admin')).toHaveLength(1);
    });
    test('matches preview', () => {
      expect(_filterMessagesByKeyword(msgs, 'sporthub')).toHaveLength(1);
    });
    test('case insensitive', () => {
      expect(_filterMessagesByKeyword(msgs, 'FOOTBALL')).toHaveLength(1);
    });
    test('no match returns empty', () => {
      expect(_filterMessagesByKeyword(msgs, 'xyz')).toHaveLength(0);
    });
  });

  // ─── 15. _filterMessagesByDate ───
  describe('_filterMessagesByDate', () => {
    const msgs = [
      { id: '1', time: '2026/03/27 10:00' },
      { id: '2', time: '2026/03/27 15:00' },
      { id: '3', time: '2026/03/28 09:00' },
    ];
    test('filters by date (YYYY-MM-DD format)', () => {
      expect(_filterMessagesByDate(msgs, '2026-03-27')).toHaveLength(2);
    });
    test('different date', () => {
      expect(_filterMessagesByDate(msgs, '2026-03-28')).toHaveLength(1);
    });
    test('no match', () => {
      expect(_filterMessagesByDate(msgs, '2026-01-01')).toHaveLength(0);
    });
    test('null date returns all', () => {
      expect(_filterMessagesByDate(msgs, null)).toHaveLength(3);
    });
  });

  // ─── 16. _sortMessagesByTime ───
  describe('_sortMessagesByTime', () => {
    test('sorts newest first', () => {
      const msgs = [
        { id: '1', time: '2026/03/25 10:00' },
        { id: '2', time: '2026/03/27 10:00' },
        { id: '3', time: '2026/03/26 10:00' },
      ];
      const result = _sortMessagesByTime(msgs);
      expect(result.map(m => m.id)).toEqual(['2', '3', '1']);
    });
    test('handles null time', () => {
      const msgs = [
        { id: '1', time: '2026/03/25 10:00' },
        { id: '2' },
      ];
      const result = _sortMessagesByTime(msgs);
      expect(result[0].id).toBe('1');
    });
    test('null input returns empty', () => {
      expect(_sortMessagesByTime(null)).toEqual([]);
    });
    test('does not mutate original', () => {
      const msgs = [{ id: '1', time: 'b' }, { id: '2', time: 'a' }];
      _sortMessagesByTime(msgs);
      expect(msgs[0].id).toBe('1');  // original unchanged
    });
  });

  // ─── 17. _getUnreadCount ───
  describe('_getUnreadCount', () => {
    test('counts correctly', () => {
      const msgs = [
        { readBy: ['u1'] },
        { readBy: [] },
        { unread: false },
        { readBy: ['u2'] },
      ];
      expect(_getUnreadCount(msgs, 'u1')).toBe(2);  // msg[1] and msg[3]
    });
    test('all read → 0', () => {
      const msgs = [{ readBy: ['u1'] }, { unread: false }];
      expect(_getUnreadCount(msgs, 'u1')).toBe(0);
    });
    test('null uid → 0', () => {
      expect(_getUnreadCount([{ readBy: [] }], null)).toBe(0);
    });
    test('empty array → 0', () => {
      expect(_getUnreadCount([], 'u1')).toBe(0);
    });
  });

  // ─── 18. _calculateStorageUsage ───
  describe('_calculateStorageUsage', () => {
    test('normal case', () => {
      const r = _calculateStorageUsage(30, 50);
      expect(r).toEqual({ used: 30, remaining: 20, total: 50, text: '30 / 50' });
    });
    test('over capacity', () => {
      const r = _calculateStorageUsage(60, 50);
      expect(r.remaining).toBe(0);
      expect(r.used).toBe(60);
    });
    test('zero messages', () => {
      const r = _calculateStorageUsage(0);
      expect(r).toEqual({ used: 0, remaining: 50, total: 50, text: '0 / 50' });
    });
    test('null messages treated as 0', () => {
      const r = _calculateStorageUsage(null);
      expect(r.used).toBe(0);
    });
    test('default capacity is 50', () => {
      expect(_calculateStorageUsage(10).total).toBe(50);
    });
  });

  // ─── 19. _getScheduledMessagesDue ───
  describe('_getScheduledMessagesDue', () => {
    const now = new Date('2026-03-27T12:00:00Z').getTime();
    test('filters scheduled + past due', () => {
      const msgs = [
        { status: 'scheduled', scheduledAt: '2026-03-27T11:00:00Z' },
        { status: 'scheduled', scheduledAt: '2026-03-27T13:00:00Z' },
        { status: 'sent', scheduledAt: '2026-03-27T11:00:00Z' },
      ];
      expect(_getScheduledMessagesDue(msgs, now)).toHaveLength(1);
    });
    test('exact time match is due', () => {
      const msgs = [{ status: 'scheduled', scheduledAt: '2026-03-27T12:00:00Z' }];
      expect(_getScheduledMessagesDue(msgs, now)).toHaveLength(1);
    });
    test('no scheduledAt → not due', () => {
      const msgs = [{ status: 'scheduled' }];
      expect(_getScheduledMessagesDue(msgs, now)).toHaveLength(0);
    });
    test('invalid date → not due', () => {
      const msgs = [{ status: 'scheduled', scheduledAt: 'not-a-date' }];
      expect(_getScheduledMessagesDue(msgs, now)).toHaveLength(0);
    });
    test('null array → empty', () => {
      expect(_getScheduledMessagesDue(null, now)).toEqual([]);
    });
    test('numeric timestamp', () => {
      const msgs = [{ status: 'scheduled', scheduledAt: now - 1000 }];
      expect(_getScheduledMessagesDue(msgs, now)).toHaveLength(1);
    });
  });

  // ─── 20. _getProcessorId ───
  describe('_getProcessorId', () => {
    test('returns uid if available', () => {
      expect(_getProcessorId({ uid: 'u1', name: 'Admin' })).toBe('u1');
    });
    test('falls back to name', () => {
      expect(_getProcessorId({ name: 'Admin' })).toBe('Admin');
    });
    test('falls back to system', () => {
      expect(_getProcessorId({})).toBe('system');
    });
    test('null user → system', () => {
      expect(_getProcessorId(null)).toBe('system');
    });
  });

  // ─── 21. _getTruncatedErrorMessage ───
  describe('_getTruncatedErrorMessage', () => {
    test('short message unchanged', () => {
      expect(_getTruncatedErrorMessage(new Error('oops'))).toBe('oops');
    });
    test('long message truncated', () => {
      const msg = 'x'.repeat(500);
      expect(_getTruncatedErrorMessage(new Error(msg), 100).length).toBe(100);
    });
    test('null err', () => {
      expect(_getTruncatedErrorMessage(null)).toBe('unknown_error');
    });
    test('non-Error object with toString', () => {
      expect(_getTruncatedErrorMessage({ toString: () => 'custom' })).toBe('custom');
    });
  });

  // ─── 22. Message Shape Contract（遷移前的文件結構契約） ───
  describe('Message Shape Contract', () => {
    // 這些測試記錄目前訊息文件必須包含的欄位，遷移時必須保留
    const makeMessage = (overrides) => ({
      id: 'msg_123_0.456',
      type: 'activity',
      typeName: '活動',
      title: '報名成功',
      preview: '你已報名成功...',
      body: '你已成功報名 3/28 足球活動。',
      time: '2026/03/27 10:00',
      readBy: [],
      hiddenBy: [],
      senderName: '系統',
      fromUid: 'system',
      targetUid: 'u1',
      targetType: 'individual',
      ...overrides,
    });

    test('required fields for direct message', () => {
      const msg = makeMessage({});
      expect(msg.id).toBeTruthy();
      expect(msg.type).toBeTruthy();
      expect(msg.title).toBeTruthy();
      expect(msg.body).toBeTruthy();
      expect(msg.time).toMatch(/^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}$/);
      expect(Array.isArray(msg.readBy)).toBe(true);
      expect(Array.isArray(msg.hiddenBy)).toBe(true);
      expect(msg.targetUid).toBeTruthy();
      expect(msg.targetType).toBe('individual');
    });

    test('team broadcast message shape', () => {
      const msg = makeMessage({ targetUid: null, targetTeamId: 'team1', targetType: 'team' });
      expect(msg.targetTeamId).toBeTruthy();
      expect(msg.targetType).toBe('team');
    });

    test('role broadcast message shape', () => {
      const msg = makeMessage({ targetUid: null, targetRoles: ['coach', 'admin'], targetType: 'role' });
      expect(Array.isArray(msg.targetRoles)).toBe(true);
      expect(msg.targetType).toBe('role');
    });

    test('global broadcast message shape', () => {
      const msg = makeMessage({ targetUid: null, targetType: 'all' });
      expect(msg.targetType).toBe('all');
    });

    test('action message shape (team join)', () => {
      const msg = makeMessage({
        actionType: 'team_join_request',
        actionStatus: 'pending',
        meta: { teamId: 't1', teamName: 'FC', applicantUid: 'u2', applicantName: 'Bob', groupId: 'grp1' },
      });
      expect(msg.actionType).toBe('team_join_request');
      expect(msg.actionStatus).toBe('pending');
      expect(msg.meta.groupId).toBeTruthy();
      expect(msg.meta.applicantUid).toBeTruthy();
    });

    test('preview is truncated to 40 chars', () => {
      const longBody = 'a'.repeat(100);
      const preview = _truncateMessagePreview(longBody, 40);
      expect(preview.length).toBeLessThanOrEqual(43); // 40 + '...'
    });

    test('targetType inference matches message fields', () => {
      expect(_inferMessageTargetType('u1', null, null)).toBe('individual');
      expect(_inferMessageTargetType(null, 'team1', null)).toBe('team');
      expect(_inferMessageTargetType(null, null, ['coach'])).toBe('role');
      expect(_inferMessageTargetType(null, null, null)).toBe('all');
    });
  });

});
