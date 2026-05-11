const adapter = require('../../js/core/history-route-adapter.js');

describe('history-route-adapter parseHistoryRoute', () => {
  test('parses list routes', () => {
    expect(adapter.parseHistoryRoute('/activities')).toMatchObject({
      source: 'history',
      kind: 'page',
      pageId: 'page-activities',
      legacyEquivalent: '#page-activities',
    });
    expect(adapter.parseHistoryRoute('/teams/')).toMatchObject({
      kind: 'page',
      pageId: 'page-teams',
    });
    expect(adapter.parseHistoryRoute('/tournaments')).toMatchObject({
      kind: 'page',
      pageId: 'page-tournaments',
    });
    expect(adapter.parseHistoryRoute('/profile')).toMatchObject({
      kind: 'page',
      pageId: 'page-profile',
    });
  });

  test('parses supported detail routes with safe ids', () => {
    expect(adapter.parseHistoryRoute('/events/ce_1777307578139_1hw5bj')).toMatchObject({
      kind: 'eventDetail',
      pageId: 'page-activity-detail',
      id: 'ce_1777307578139_1hw5bj',
      legacyEquivalent: '?event=ce_1777307578139_1hw5bj',
    });
    expect(adapter.parseHistoryRoute('/teams/tm_alpha-123')).toMatchObject({
      kind: 'teamDetail',
      pageId: 'page-team-detail',
      id: 'tm_alpha-123',
      legacyEquivalent: '?team=tm_alpha-123',
    });
    expect(adapter.parseHistoryRoute('/tournaments/ct_1777307578139_1hw5bj')).toMatchObject({
      kind: 'tournamentDetail',
      pageId: 'page-tournament-detail',
      id: 'ct_1777307578139_1hw5bj',
      legacyEquivalent: '?tournament=ct_1777307578139_1hw5bj',
    });
  });

  test('rejects unsafe or unsupported paths', () => {
    expect(adapter.parseHistoryRoute('/events/a')).toBeNull();
    expect(adapter.parseHistoryRoute('/events/../../x')).toBeNull();
    expect(adapter.parseHistoryRoute('/events/ce_%2Fbad')).toBeNull();
    expect(adapter.parseHistoryRoute('/events/ce_test/more')).toBeNull();
    expect(adapter.parseHistoryRoute('/css/base.css')).toBeNull();
    expect(adapter.parseHistoryRoute('/random-unknown-path')).toBeNull();
  });

  test('keeps users path disabled in the first round', () => {
    const uid = 'U210473e818fbc6ce639606b9e83efdd1';
    expect(adapter.parseHistoryRoute('/users/' + uid)).toBeNull();
    expect(adapter.parseHistoryRoute('/users/' + uid, { usersPathEnabled: true })).toMatchObject({
      kind: 'userCard',
      pageId: 'page-user-card',
      id: uid,
      legacyEquivalent: '?profile=' + uid,
    });
  });
});
