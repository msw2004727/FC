/**
 * 賽事報名審核訊息動作 — 管理權守衛
 *
 * 載入方式沿用 tests/unit/tournament-competition.test.js 的 loadModule：
 * fs.readFileSync + new Function(...Object.keys(globals), code) 注入 globals。
 * 同一個 App 依序載入真實的
 *   js/modules/tournament/tournament-helpers.js
 *   js/modules/message/message-actions.js
 *   js/modules/message/message-render.js
 * _canManageTournamentRecord 使用真 helper，不整段 mock。
 * 預設不掛 hasPermission，讓全域管理者走 getRolePermissions。
 * 另有案例掛上 jest.fn 版 hasPermission，覆蓋正式環境會走的分支。
 */

const fs = require('fs');
const path = require('path');

function loadModule(relPath, globals) {
  const code = fs.readFileSync(path.resolve(__dirname, '..', '..', relPath), 'utf8');
  const fn = new Function(...Object.keys(globals), code);
  fn(...Object.values(globals));
}

function escapeHTML(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function createDocument() {
  const nodes = new Map();
  function makeNode(id) {
    return {
      id,
      innerHTML: '',
      textContent: '',
      style: {},
      dataset: {},
      classList: {
        add() {},
        remove() {},
        toggle() {},
        contains() { return false; },
      },
      appendChild() {},
      querySelector() { return null; },
      querySelectorAll() { return []; },
      addEventListener() {},
      setAttribute() {},
    };
  }
  return {
    getElementById(id) {
      if (!nodes.has(id)) nodes.set(id, makeNode(id));
      return nodes.get(id);
    },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    body: { appendChild() {} },
    scrollingElement: { scrollTop: 0 },
    documentElement: { scrollTop: 0 },
  };
}

const MANAGE_ALL = 'admin.tournaments.manage_all';

const ACTIONS = [
  { action: 'approve', actionLabel: '同意' },
  { action: 'reject', actionLabel: '拒絕' },
  { action: 'ignore', actionLabel: '忽略' },
];

function hostTeam(overrides = {}) {
  return {
    id: 'host-team',
    name: '主辦俱樂部',
    captainUid: 'officer-uid',
    leaderUid: 'officer-uid',
    ...overrides,
  };
}

function baseTournament(overrides = {}) {
  return {
    id: 'tourn-1',
    name: '城市盃',
    creatorUid: 'creator-uid',
    hostTeamId: 'host-team',
    delegates: [{ uid: 'delegate-uid', name: '委託人' }],
    delegateUids: ['delegate-uid'],
    registeredTeams: ['already-in'],
    maxTeams: 16,
    ...overrides,
  };
}

function scenarioByKey(key) {
  const scenarios = {
    creator: () => ({
      label: '建立者',
      allowed: true,
      user: { uid: 'creator-uid', role: 'user', displayName: '建立者', name: '建立者' },
      tournament: baseTournament(),
      teams: [hostTeam()],
      rolePerms: {},
    }),
    delegate: () => ({
      label: '委託人',
      allowed: true,
      user: { uid: 'delegate-uid', role: 'user', displayName: '委託人', name: '委託人' },
      tournament: baseTournament({ creatorUid: 'someone-else' }),
      teams: [hostTeam()],
      rolePerms: {},
    }),
    officer: () => ({
      label: '主辦俱樂部幹部',
      allowed: true,
      user: { uid: 'officer-uid', role: 'user', displayName: '隊長', name: '隊長' },
      tournament: baseTournament({
        creatorUid: 'someone-else',
        delegates: [{ uid: 'delegate-uid', name: '委託人' }],
        delegateUids: ['delegate-uid'],
      }),
      teams: [hostTeam()],
      rolePerms: {},
    }),
    admin: () => ({
      label: '全域管理者',
      allowed: true,
      user: { uid: 'admin-uid', role: 'admin', displayName: '管理者', name: '管理者' },
      tournament: baseTournament({
        creatorUid: 'someone-else',
        delegates: [],
        delegateUids: [],
      }),
      teams: [hostTeam()],
      rolePerms: { admin: [MANAGE_ALL] },
    }),
    member: () => ({
      label: '一般會員',
      allowed: false,
      user: { uid: 'member-uid', role: 'user', displayName: '會員', name: '會員' },
      tournament: baseTournament(),
      teams: [hostTeam()],
      rolePerms: {},
    }),
    removedDelegate: () => ({
      label: '已移除的委託人',
      allowed: false,
      user: { uid: 'removed-delegate-uid', role: 'user', displayName: '舊委託人', name: '舊委託人' },
      tournament: baseTournament({
        creatorUid: 'someone-else',
        delegates: [{ uid: 'delegate-uid', name: '現任委託人' }],
        delegateUids: ['delegate-uid'],
      }),
      teams: [hostTeam()],
      rolePerms: {},
    }),
    clearedDelegate: () => ({
      label: '已移除委託人（delegates 與 delegateUids 都不含該 uid）',
      allowed: false,
      user: { uid: 'removed-delegate-uid', role: 'user', displayName: '舊委託人', name: '舊委託人' },
      tournament: baseTournament({
        creatorUid: 'someone-else',
        delegates: [],
        delegateUids: [],
      }),
      teams: [hostTeam()],
      rolePerms: {},
    }),
    loggedOut: () => ({
      label: '未登入',
      allowed: false,
      user: null,
      tournament: baseTournament(),
      teams: [hostTeam()],
      rolePerms: { admin: [MANAGE_ALL] },
    }),
    missingTournament: () => ({
      label: '賽事不存在',
      allowed: false,
      forceNullTournament: true,
      user: { uid: 'admin-uid', role: 'admin', displayName: '管理者', name: '管理者' },
      tournament: baseTournament({ creatorUid: 'admin-uid' }),
      teams: [hostTeam({ captainUid: 'admin-uid', leaderUid: 'admin-uid' })],
      rolePerms: { admin: [MANAGE_ALL] },
    }),
  };
  return scenarios[key]();
}

const ALLOW_KEYS = [
  { key: 'creator', label: '建立者' },
  { key: 'delegate', label: '委託人' },
  { key: 'officer', label: '主辦俱樂部幹部' },
  { key: 'admin', label: '全域管理者' },
];

const DENY_KEYS = [
  { key: 'member', label: '一般會員' },
  { key: 'removedDelegate', label: '已移除的委託人' },
  { key: 'clearedDelegate', label: '已移除委託人（delegates 與 delegateUids 都不含該 uid）' },
  { key: 'loggedOut', label: '未登入' },
  { key: 'missingTournament', label: '賽事不存在' },
];

const OFFICER_UID = 'officer-field-uid';

const OFFICER_FIELDS = [
  { field: 'captainUid', label: 'captainUid' },
  { field: 'creatorUid', label: 'creatorUid' },
  { field: 'ownerUid', label: 'ownerUid' },
  { field: 'leaderUid', label: 'leaderUid' },
  { field: 'leaderUids', label: 'leaderUids' },
];

const OFFICER_FIELD_NAMES = ['captainUid', 'creatorUid', 'ownerUid', 'leaderUid', 'leaderUids'];

function teamWithSingleOfficerField(field, uid) {
  const team = { id: 'host-team', name: '主辦俱樂部' };
  if (field === 'leaderUids') team.leaderUids = [uid];
  else team[field] = uid;
  return team;
}

function officerFieldScenario(field) {
  return {
    label: field,
    allowed: true,
    user: { uid: OFFICER_UID, role: 'user', displayName: '幹部', name: '幹部' },
    tournament: baseTournament({
      creatorUid: 'someone-else',
      delegates: [{ uid: 'delegate-uid', name: '委託人' }],
      delegateUids: ['delegate-uid'],
    }),
    teams: [teamWithSingleOfficerField(field, OFFICER_UID)],
    rolePerms: {},
  };
}

function coachScenario() {
  return {
    label: 'coachUids',
    allowed: false,
    user: { uid: 'coach-uid', role: 'user', displayName: '教練', name: '教練' },
    tournament: baseTournament({
      creatorUid: 'someone-else',
      delegates: [{ uid: 'delegate-uid', name: '委託人' }],
      delegateUids: ['delegate-uid'],
    }),
    teams: [{ id: 'host-team', name: '主辦俱樂部', coachUids: ['coach-uid'] }],
    rolePerms: {},
  };
}

function permissionActorScenario(allowed) {
  return {
    label: allowed ? 'hasPermission 放行的非建立者' : 'hasPermission 拒絕的一般會員',
    allowed,
    user: allowed
      ? { uid: 'perm-user', role: 'user', displayName: '非建立者', name: '非建立者' }
      : { uid: 'member-uid', role: 'user', displayName: '會員', name: '會員' },
    tournament: baseTournament({
      creatorUid: 'someone-else',
      delegates: [],
      delegateUids: [],
    }),
    teams: [hostTeam()],
    rolePerms: {},
  };
}

const FALLBACK_ACTORS = [
  { key: 'creator', actorLabel: '建立者' },
  { key: 'member', actorLabel: '一般會員' },
];

const FALLBACK_SHAPES = [
  {
    shapeId: 'missing-meta-id',
    shapeLabel: 'meta 缺 tournamentId 且頂層有 tournamentId',
    silent: false,
    overrides: {
      tournamentId: 'tourn-1',
      meta: { tournamentId: '' },
    },
  },
  {
    shapeId: 'no-meta',
    shapeLabel: '完全沒有 meta',
    silent: true,
    overrides: {
      omitMeta: true,
      tournamentId: 'tourn-1',
    },
  },
  {
    shapeId: 'unknown-id',
    shapeLabel: 'meta.tournamentId 指向不存在的賽事',
    silent: false,
    overrides: {
      meta: { tournamentId: 'missing-tourn-id' },
    },
  },
];

function crossJoin(personas, actions) {
  const cases = [];
  personas.forEach(persona => {
    actions.forEach(item => {
      cases.push({ ...persona, ...item });
    });
  });
  return cases;
}

function makeMessage(overrides = {}) {
  const { meta: metaOverrides, omitMeta = false, ...rest } = overrides;
  const message = {
    id: 'msg-reg-1',
    actionType: 'tournament_register_request',
    actionStatus: 'pending',
    title: '賽事報名申請',
    type: 'tournament',
    typeName: '賽事',
    time: '2026/10/23 12:00',
    body: '俱樂部「申請隊」申請報名賽事「城市盃」',
    senderName: '申請人',
    preview: '報名申請',
    ...rest,
  };
  if (omitMeta) return message;
  const meta = {
    tournamentId: 'tourn-1',
    tournamentName: '城市盃',
    teamId: 'apply-team',
    teamName: '申請隊',
    applicantUid: 'applicant-1',
    applicantName: '申請人',
    ...(metaOverrides || {}),
  };
  if (meta.tournamentId == null || String(meta.tournamentId).trim() === '') {
    delete meta.tournamentId;
  }
  message.meta = meta;
  return message;
}

function buildHarness() {
  const state = {
    user: null,
    tournament: null,
    teams: [],
    rolePerms: {},
    messages: [],
    forceNullTournament: false,
  };
  const document = createDocument();
  const ApiService = {
    getMessages: () => state.messages,
    getTournament: (id) => {
      if (id == null) return null;
      const wanted = String(id).trim();
      if (!wanted) return null;
      if (state.forceNullTournament) return null;
      const tournament = state.tournament;
      if (!tournament) return null;
      const tournamentId = String(tournament.id || tournament._docId || '').trim();
      if (!tournamentId || wanted !== tournamentId) return null;
      return tournament;
    },
    getTournaments: () => (state.forceNullTournament || !state.tournament ? [] : [state.tournament]),
    getCurrentUser: () => state.user,
    getTeams: () => state.teams,
    getRolePermissions: (role) => {
      const key = String(role || '').trim().toLowerCase();
      return state.rolePerms[key] || [];
    },
    getAdminUsers: () => [],
    updateTournament: jest.fn(),
    _writeOpLog: jest.fn(),
  };
  const ScriptLoader = {
    ensureForPage: jest.fn().mockResolvedValue(undefined),
  };
  const FirebaseService = {
    ensureStaticCollectionsLoaded: jest.fn().mockResolvedValue(undefined),
    _syncGroupActionStatusCF: jest.fn(),
    _cache: { messages: [] },
  };
  const App = {};
  loadModule('js/modules/tournament/tournament-helpers.js', { App, ApiService });
  loadModule('js/modules/message/message-actions.js', {
    App, ApiService, document, ScriptLoader, FirebaseService,
  });
  loadModule('js/modules/message/message-render.js', {
    App, ApiService, document, escapeHTML, escapeJsAttr: require('../helpers/event-binding').escapeJsAttr,
  });

  App.showToast = jest.fn();
  App._deliverMessageWithLinePush = jest.fn();
  App._syncTournamentMessageActionStatus = jest.fn();
  App._getTournamentMessageGroupId = jest.fn();
  App.renderMessageList = jest.fn();
  App.showTournamentDetail = jest.fn().mockResolvedValue(undefined);
  App.renderTournamentTab = jest.fn();
  jest.spyOn(App, 'openFriendlyTournamentMessageReview');

  return { App, ApiService, document, state };
}

function applyScenario(ctx, scenario, messageOverrides) {
  ctx.state.user = scenario.user;
  ctx.state.tournament = scenario.tournament;
  ctx.state.teams = scenario.teams;
  ctx.state.rolePerms = scenario.rolePerms;
  ctx.state.forceNullTournament = !!scenario.forceNullTournament;
  const msg = makeMessage(messageOverrides);
  ctx.state.messages = [msg];
  scenario.registeredSnapshot = scenario.tournament.registeredTeams.slice();
  return msg;
}

function expectNoWrites(ctx, scenario) {
  expect(ctx.ApiService.updateTournament).not.toHaveBeenCalled();
  expect(ctx.ApiService._writeOpLog).not.toHaveBeenCalled();
  expect(ctx.App._syncTournamentMessageActionStatus).not.toHaveBeenCalled();
  expect(ctx.App._deliverMessageWithLinePush).not.toHaveBeenCalled();
  expect(scenario.tournament.registeredTeams).toEqual(scenario.registeredSnapshot);
}

function expectDenied(ctx, scenario) {
  expect(ctx.App.showToast).toHaveBeenCalledTimes(1);
  expect(ctx.App.showToast).toHaveBeenCalledWith('權限不足');
  expectNoWrites(ctx, scenario);
}

function expectAllowed(ctx, action) {
  expect(ctx.App.showToast).not.toHaveBeenCalledWith('權限不足');
  expect(ctx.ApiService._writeOpLog).toHaveBeenCalled();
  expect(ctx.App._syncTournamentMessageActionStatus).toHaveBeenCalled();
  if (action === 'approve') {
    expect(ctx.ApiService.updateTournament).toHaveBeenCalled();
  }
}

function detailHtml(ctx) {
  return ctx.document.getElementById('msg-inbox-detail-content').innerHTML;
}

function handlerAllows(ctx, action = 'approve') {
  const permissionDenied = ctx.App.showToast.mock.calls.some(call => call[0] === '權限不足');
  const wroteLog = ctx.ApiService._writeOpLog.mock.calls.length > 0;
  const synced = ctx.App._syncTournamentMessageActionStatus.mock.calls.length > 0;
  const updated = action !== 'approve' || ctx.ApiService.updateTournament.mock.calls.length > 0;
  return !permissionDenied && wroteLog && synced && updated;
}

describe('handleTournamentRegAction 管理權守衛', () => {
  it.each(crossJoin(ALLOW_KEYS, ACTIONS))(
    '$label 放行「$actionLabel」',
    async ({ key, action }) => {
      const ctx = buildHarness();
      const scenario = scenarioByKey(key);
      const msg = applyScenario(ctx, scenario);
      await ctx.App.handleTournamentRegAction(msg.id, action);
      expectAllowed(ctx, action);
    },
  );

  it.each(crossJoin(DENY_KEYS, ACTIONS))(
    '$label 擋下「$actionLabel」',
    async ({ key, action }) => {
      const ctx = buildHarness();
      const scenario = scenarioByKey(key);
      const msg = applyScenario(ctx, scenario);
      await ctx.App.handleTournamentRegAction(msg.id, action);
      expectDenied(ctx, scenario);
    },
  );

  it.each(ACTIONS)(
    '友誼賽分流（$actionLabel）不受守衛影響',
    async ({ action }) => {
      const ctx = buildHarness();
      const scenario = scenarioByKey('member');
      const msg = applyScenario(ctx, scenario, {
        actionType: 'tournament_friendly_application',
      });
      await ctx.App.handleTournamentRegAction(msg.id, action);
      expect(ctx.App.openFriendlyTournamentMessageReview).toHaveBeenCalledWith(msg.id);
      expect(ctx.App.showToast).not.toHaveBeenCalledWith('權限不足');
      expect(ctx.ApiService.updateTournament).not.toHaveBeenCalled();
      expect(ctx.ApiService._writeOpLog).not.toHaveBeenCalled();
      expect(ctx.App._syncTournamentMessageActionStatus).not.toHaveBeenCalled();
      expect(ctx.App._deliverMessageWithLinePush).not.toHaveBeenCalled();
      expect(scenario.tournament.registeredTeams).toEqual(scenario.registeredSnapshot);
    },
  );

  it.each(ACTIONS)(
    'helper 缺席時建立者的「$actionLabel」fail-closed',
    async ({ action }) => {
      const ctx = buildHarness();
      ctx.App._canManageTournamentRecord = undefined;
      const scenario = scenarioByKey('creator');
      const msg = applyScenario(ctx, scenario);
      await ctx.App.handleTournamentRegAction(msg.id, action);
      expectDenied(ctx, scenario);
    },
  );
});

describe('showMessageDetail 報名審核按鈕', () => {
  it.each(ALLOW_KEYS)('$label 顯示同意、拒絕、忽略', ({ key }) => {
    const ctx = buildHarness();
    const scenario = scenarioByKey(key);
    const msg = applyScenario(ctx, scenario);
    ctx.App.showMessageDetail(msg.id);
    const html = detailHtml(ctx);
    expect(html).toContain('handleTournamentRegAction');
    expect(html).toContain("handleTournamentRegAction('msg-reg-1','approve')");
    expect(html).toContain("handleTournamentRegAction('msg-reg-1','reject')");
    expect(html).toContain("handleTournamentRegAction('msg-reg-1','ignore')");
  });

  it.each([
    { key: 'member', label: '一般會員' },
    { key: 'removedDelegate', label: '已移除的委託人' },
    { key: 'clearedDelegate', label: '已移除委託人（delegates 與 delegateUids 都不含該 uid）' },
  ])('$label 不顯示審核按鈕', ({ key }) => {
    const ctx = buildHarness();
    const scenario = scenarioByKey(key);
    const msg = applyScenario(ctx, scenario);
    ctx.App.showMessageDetail(msg.id);
    const html = detailHtml(ctx);
    expect(html).toContain('賽事報名申請');
    expect(html).not.toContain('handleTournamentRegAction');
  });

  it('非 pending 狀態徽章維持原樣', () => {
    const ctx = buildHarness();
    const scenario = scenarioByKey('member');
    const msg = applyScenario(ctx, scenario, { actionStatus: 'approved' });
    ctx.App.showMessageDetail(msg.id);
    const html = detailHtml(ctx);
    expect(html).toContain('已同意');
    expect(html).not.toContain('handleTournamentRegAction');
  });

  it('友誼賽分支仍顯示查看賽事', () => {
    const ctx = buildHarness();
    const scenario = scenarioByKey('member');
    const msg = applyScenario(ctx, scenario, {
      actionType: 'tournament_friendly_application',
    });
    ctx.App.showMessageDetail(msg.id);
    const html = detailHtml(ctx);
    expect(html).toContain("openFriendlyTournamentMessageReview('msg-reg-1')");
    expect(html).toContain('查看賽事');
    expect(html).not.toContain('handleTournamentRegAction');
  });
});

describe('R-IAM-011 按鈕與 handler 同一 helper', () => {
  const cases = [
    ...ALLOW_KEYS,
    ...DENY_KEYS,
    { key: 'creator', label: 'helper 缺席', stripHelper: true, allowed: false },
  ];

  it.each(cases)(
    '$label：顯示按鈕與放行結果一致',
    async ({ key, stripHelper, allowed }) => {
      const ctx = buildHarness();
      if (stripHelper) ctx.App._canManageTournamentRecord = undefined;
      const scenario = scenarioByKey(key);
      const expected = stripHelper ? false : (allowed === undefined ? scenario.allowed : allowed);
      const msg = applyScenario(ctx, scenario);
      ctx.App.showMessageDetail(msg.id);
      const showsButtons = detailHtml(ctx).includes('handleTournamentRegAction');
      await ctx.App.handleTournamentRegAction(msg.id, 'approve');
      const allows = handlerAllows(ctx, 'approve');
      expect(showsButtons).toBe(allows);
      expect(showsButtons).toBe(expected);
    },
  );
});

describe('getTournament 空 id 契約', () => {
  it('undefined、null、空字串回 null，有 id 才依 id 查', () => {
    const ctx = buildHarness();
    const scenario = scenarioByKey('creator');
    applyScenario(ctx, scenario);
    expect(ctx.ApiService.getTournament(undefined)).toBeNull();
    expect(ctx.ApiService.getTournament(null)).toBeNull();
    expect(ctx.ApiService.getTournament('')).toBeNull();
    expect(ctx.ApiService.getTournament('tourn-1')).toBe(scenario.tournament);
    expect(ctx.ApiService.getTournament('missing-tourn-id')).toBeNull();
  });
});

describe('fallback 訊息：render 與 handler 同一取賽事方式', () => {
  const cases = [];
  FALLBACK_ACTORS.forEach(actor => {
    FALLBACK_SHAPES.forEach(shape => {
      ACTIONS.forEach(item => {
        cases.push({ ...actor, ...shape, ...item });
      });
    });
  });

  it.each(cases)(
    '$actorLabel / $shapeLabel / $actionLabel：顯示與放行同真同假',
    async ({ key, shapeId, silent, overrides, action }) => {
      const ctx = buildHarness();
      const scenario = scenarioByKey(key);
      const msg = applyScenario(ctx, scenario, overrides);
      if (shapeId === 'missing-meta-id') {
        expect(msg.meta).toBeTruthy();
        expect(msg.meta.tournamentId).toBeUndefined();
        expect(msg.tournamentId).toBe('tourn-1');
      } else if (shapeId === 'no-meta') {
        expect(msg.meta).toBeUndefined();
        expect(msg.tournamentId).toBe('tourn-1');
      } else if (shapeId === 'unknown-id') {
        expect(msg.meta.tournamentId).toBe('missing-tourn-id');
        expect(ctx.ApiService.getTournament(msg.meta.tournamentId)).toBeNull();
      }

      ctx.App.showMessageDetail(msg.id);
      const showsButtons = detailHtml(ctx).includes('handleTournamentRegAction');
      await ctx.App.handleTournamentRegAction(msg.id, action);
      const allows = handlerAllows(ctx, action);
      expect(showsButtons).toBe(false);
      expect(allows).toBe(false);
      expect(showsButtons).toBe(allows);
      if (silent) {
        expect(ctx.App.showToast).not.toHaveBeenCalled();
        expectNoWrites(ctx, scenario);
      } else {
        expectDenied(ctx, scenario);
      }
    },
  );
});

describe('App.hasPermission 存在時的全域管理權', () => {
  function mountPermission(ctx, result) {
    ctx.App.hasPermission = jest.fn(() => result);
    jest.spyOn(ctx.ApiService, 'getRolePermissions');
  }

  it.each(ACTIONS)(
    '非建立者 hasPermission(manage_all) 回 true 時放行「$actionLabel」',
    async ({ action }) => {
      const ctx = buildHarness();
      mountPermission(ctx, true);
      const scenario = permissionActorScenario(true);
      const msg = applyScenario(ctx, scenario);
      ctx.App.showMessageDetail(msg.id);
      const showsButtons = detailHtml(ctx).includes('handleTournamentRegAction');
      await ctx.App.handleTournamentRegAction(msg.id, action);
      expect(ctx.App.hasPermission).toHaveBeenCalledWith(MANAGE_ALL);
      expect(ctx.ApiService.getRolePermissions).not.toHaveBeenCalled();
      expectAllowed(ctx, action);
      expect(showsButtons).toBe(true);
      expect(showsButtons).toBe(handlerAllows(ctx, action));
    },
  );

  it.each(ACTIONS)(
    '一般會員 hasPermission(manage_all) 回 false 時擋下「$actionLabel」',
    async ({ action }) => {
      const ctx = buildHarness();
      mountPermission(ctx, false);
      const scenario = permissionActorScenario(false);
      const msg = applyScenario(ctx, scenario);
      ctx.App.showMessageDetail(msg.id);
      const showsButtons = detailHtml(ctx).includes('handleTournamentRegAction');
      await ctx.App.handleTournamentRegAction(msg.id, action);
      expect(ctx.App.hasPermission).toHaveBeenCalledWith(MANAGE_ALL);
      expect(ctx.ApiService.getRolePermissions).not.toHaveBeenCalled();
      expectDenied(ctx, scenario);
      expect(showsButtons).toBe(false);
      expect(showsButtons).toBe(handlerAllows(ctx, action));
    },
  );
});

describe('主辦俱樂部幹部欄位拆開', () => {
  it.each(crossJoin(OFFICER_FIELDS, ACTIONS))(
    '只以 $label 出現時放行「$actionLabel」',
    async ({ field, action }) => {
      const ctx = buildHarness();
      const scenario = officerFieldScenario(field);
      const present = OFFICER_FIELD_NAMES.filter(name => scenario.teams[0][name] != null);
      expect(present).toEqual([field]);
      const msg = applyScenario(ctx, scenario);
      ctx.App.showMessageDetail(msg.id);
      const showsButtons = detailHtml(ctx).includes('handleTournamentRegAction');
      await ctx.App.handleTournamentRegAction(msg.id, action);
      expectAllowed(ctx, action);
      expect(showsButtons).toBe(true);
      expect(showsButtons).toBe(handlerAllows(ctx, action));
    },
  );

  it.each(ACTIONS)(
    '只出現在 coachUids 時擋下「$actionLabel」',
    async ({ action }) => {
      const ctx = buildHarness();
      const scenario = coachScenario();
      const present = OFFICER_FIELD_NAMES.filter(name => scenario.teams[0][name] != null);
      expect(present).toEqual([]);
      expect(scenario.teams[0].coachUids).toEqual(['coach-uid']);
      const msg = applyScenario(ctx, scenario);
      ctx.App.showMessageDetail(msg.id);
      const showsButtons = detailHtml(ctx).includes('handleTournamentRegAction');
      await ctx.App.handleTournamentRegAction(msg.id, action);
      expectDenied(ctx, scenario);
      expect(showsButtons).toBe(false);
      expect(showsButtons).toBe(handlerAllows(ctx, action));
    },
  );
});

describe('友誼賽登記申請導覽', () => {
  it('applicationId 存在、actionType 為 tournament_register_request、且 _isFriendlyTournamentRecord 為真時改走賽事詳情', async () => {
    const ctx = buildHarness();
    ctx.App._isFriendlyTournamentRecord = jest.fn(() => true);
    const scenario = scenarioByKey('member');
    const msg = applyScenario(ctx, scenario, {
      actionType: 'tournament_register_request',
      meta: { applicationId: 'friendly-app-1' },
    });
    expect(msg.actionType).toBe('tournament_register_request');
    expect(msg.meta.applicationId).toBe('friendly-app-1');
    await ctx.App.handleTournamentRegAction(msg.id, 'approve');
    expect(ctx.App._isFriendlyTournamentRecord).toHaveBeenCalledWith(scenario.tournament);
    expect(ctx.App.openFriendlyTournamentMessageReview).toHaveBeenCalledWith(msg.id);
    expect(ctx.App.showToast).toHaveBeenCalledWith('友誼賽請到賽事詳情頁的隊伍分頁進行審核');
    expect(ctx.App.showToast).not.toHaveBeenCalledWith('權限不足');
    expectNoWrites(ctx, scenario);
  });
});
