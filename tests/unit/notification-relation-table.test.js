/**
 * 通知發送授權強化（第 2 批）— source 歸類（functions/notification-relation-table.js）。
 */

const { classifyRelation } = require('../../functions/notification-relation-table');

function rows(sources, id, callerCheck, recipientQuery, keys) {
  return sources.map((source) => ({ source, id, callerCheck, recipientQuery, keys }));
}

const CASES = [
  ...rows([
    'client:line-push',
    'template:welcome',
    'template:signup_success',
    'template:cancel_signup',
    'event_cancel_signup:legacy',
  ], 'R0', 'callerIsAuthenticated', 'recipientIsCaller', []),
  ...rows([
    'template:event_changed',
    'template:event_cancelled',
    'template:event_relisted',
    'template:waitlist_demoted',
  ], 'R1', 'callerMayManageEvent', 'recipientHasActiveRegistration', ['eventId']),
  ...rows(['template:waitlist_promoted'], 'R2', 'deferredTo2c', 'deferredTo2c', []),
  ...rows(['team_join_request'], 'R3', 'callerIsApplicant', 'recipientIsTeamStaff', ['teamId']),
  ...rows([
    'team_join_review:approve',
    'team_join_review:reject',
    'team_join_review:broadcast:approve',
    'team_join_review:broadcast:reject',
  ], 'R4', 'callerMayReviewJoin', 'recipientIsReviewTarget', ['teamId', 'applicantUid']),
  ...rows([
    'team_role_assignment:captain',
    'team_role_assignment:leader',
    'team_role_assignment:coach',
    'team_role_assignment:member',
  ], 'R5', 'callerMayAssignTeamRole', 'recipientMatchesAssignment', ['teamId']),
  ...rows([
    'target:individual',
    'target:team',
    'target:all',
    'target:admin',
    'target:coach',
    'target:captain',
    'target:venue_owner',
    'target:coach_up',
    'target:custom_role',
  ], 'R6', 'callerHasBroadcastPermission', 'existingInboxExpansion', []),
  ...rows([
    'template:role_application',
    'template:role_application:admins',
  ], 'R7', 'callerIsAuthenticated', 'recipientRoleIsAdmin', []),
  ...rows([
    'tournament_review:approve',
    'tournament_review:reject',
    'tournament_review:broadcast:approve',
    'tournament_review:broadcast:reject',
    'template:tournament_friendly_host_opened',
  ], 'R8', 'callerMatchesTournamentSource', 'recipientInTournamentAudience', ['tournamentId']),
  ...rows([
    'tournament_register_request',
    'template:tournament_friendly_team_apply_host',
    'template:tournament_friendly_team_approved_applicant',
    'template:tournament_friendly_team_rejected_applicant',
    'template:tournament_friendly_team_approved_broadcast',
  ], 'R8', 'callerMatchesTournamentSource', 'recipientInTournamentAudience', ['tournamentId', 'teamId']),
  ...rows([
    'edu_checkin',
    'edu_reminder',
    'edu_report',
    'edu_student_review:approve',
    'edu_student_review:reject',
  ], 'R9', 'recordOnly', 'recordOnly', []),
];

describe('classifyRelation', () => {
  test.each(CASES)('$source → $id', ({ source, id, callerCheck, recipientQuery, keys }) => {
    expect(classifyRelation(source)).toEqual({ id, callerCheck, recipientQuery, keys });
  });

  test('template:event_cancelled 是 R1 不是 R0', () => {
    const result = classifyRelation('template:event_cancelled');
    expect(result.id).toBe('R1');
    expect(result).not.toMatchObject({ id: 'R0' });
    expect(classifyRelation('template:event_cancelled:admins')).toEqual({
      id: 'unclassified',
      callerCheck: 'recordOnly',
      recipientQuery: 'recordOnly',
      keys: [],
    });
  });

  test('template:waitlist_promoted 是 R2', () => {
    expect(classifyRelation('template:waitlist_promoted')).toMatchObject({
      id: 'R2',
      callerCheck: 'deferredTo2c',
      recipientQuery: 'deferredTo2c',
      keys: [],
    });
  });

  test('template:role_upgrade 有 teamId 為 R5', () => {
    const expected = {
      id: 'R5',
      callerCheck: 'callerMayAssignTeamRole',
      recipientQuery: 'recipientMatchesAssignment',
      keys: ['teamId', 'assignmentRole'],
    };
    expect(classifyRelation('template:role_upgrade', { teamId: 'tm_x' })).toEqual(expected);
    expect(classifyRelation('template:role_upgrade', { teamId: 'tm_x', assignmentRole: 'coach' })).toEqual(expected);
    expect(classifyRelation('template:role_upgrade', { teamId: 'tm_x' }).roleUpgradeWithoutTeam).toBeUndefined();
  });

  test('template:role_upgrade 沒有 teamId 為 R6 且 roleUpgradeWithoutTeam', () => {
    const expected = {
      id: 'R6',
      callerCheck: 'callerHasBroadcastPermission',
      recipientQuery: 'existingInboxExpansion',
      keys: [],
      roleUpgradeWithoutTeam: true,
    };
    const inherited = Object.create({ teamId: 'tm_x' });
    [undefined, null, {}, { teamId: '' }, { teamId: null }, { teamId: 1 }, { eventId: 'ev_1' }, inherited].forEach((keys) => {
      expect(classifyRelation('template:role_upgrade', keys)).toEqual(expected);
    });
    expect(classifyRelation('target:all').roleUpgradeWithoutTeam).toBeUndefined();
  });

  test('client:unknown 不是 R0', () => {
    expect(classifyRelation('client:unknown')).toEqual({
      id: 'client_unknown',
      callerCheck: 'recordOnly',
      recipientQuery: 'recordOnly',
      keys: [],
    });
  });

  test('已知但不在表內為 unclassified', () => {
    ['template:event_changed:admins', 'template:welcome:admins', 'template:role_upgrade:admins'].forEach((source) => {
      expect(classifyRelation(source, { teamId: 'tm_x' })).toEqual({
        id: 'unclassified',
        callerCheck: 'recordOnly',
        recipientQuery: 'recordOnly',
        keys: [],
      });
    });
  });

  test('未知 source、非字串、constructor 回 null', () => {
    [
      'constructor', '__proto__', 'toString', 'brand_new_source', 'template:not_a_key',
      'target:ALL', 'target:', 'target:admin:extra', 'xtarget:admin', 'template:event_cancel',
      'team_role_assignment:owner', '', ' ',
    ].forEach((source) => {
      expect(classifyRelation(source, { teamId: 'tm_x' })).toBeNull();
    });
    [null, undefined, 1, 0, true, false, {}, [], Symbol('source')].forEach((source) => {
      expect(classifyRelation(source)).toBeNull();
    });
  });

  test('簽章只有 source 與 keys', () => {
    expect(classifyRelation.length).toBe(2);
  });
});
