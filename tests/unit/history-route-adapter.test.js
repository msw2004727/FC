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

  test('parses canonical course lesson roster routes as team details', () => {
    expect(adapter.parseHistoryRoute('/teams/teamA/courses/planA/lessons/sessionA')).toMatchObject({
      source: 'history',
      kind: 'teamDetail',
      pageId: 'page-team-detail',
      id: 'teamA',
      teamId: 'teamA',
      coursePlanId: 'planA',
      lessonId: 'sessionA',
      courseView: 'roster',
    });
    expect(adapter.parseHistoryRoute('/teams/teamA/courses/planA/lessons/sessionA/')).toMatchObject({
      id: 'teamA',
      coursePlanId: 'planA',
      lessonId: 'sessionA',
    });
  });

  test('accepts one safe Mini App prefix only when explicitly enabled', () => {
    const prefixed = '/demo/teams/teamA/courses/planA/lessons/sessionA';

    expect(adapter.parseHistoryRoute(prefixed)).toBeNull();
    expect(adapter.parseHistoryRoute(prefixed, {
      allowCourseLessonPrefix: true,
    })).toMatchObject({
      kind: 'teamDetail',
      pageId: 'page-team-detail',
      id: 'teamA',
      coursePlanId: 'planA',
      lessonId: 'sessionA',
    });
    expect(adapter.parseHistoryRoute(
      '/demo/extra/teams/teamA/courses/planA/lessons/sessionA',
      { allowCourseLessonPrefix: true }
    )).toBeNull();
    expect(adapter.parseHistoryRoute(
      '/de%2Fmo/teams/teamA/courses/planA/lessons/sessionA',
      { allowCourseLessonPrefix: true }
    )).toBeNull();
  });

  test('rejects unsafe or unsupported paths', () => {
    expect(adapter.parseHistoryRoute('/events/a')).toBeNull();
    expect(adapter.parseHistoryRoute('/events/../../x')).toBeNull();
    expect(adapter.parseHistoryRoute('/events/ce_%2Fbad')).toBeNull();
    expect(adapter.parseHistoryRoute('/events/ce_test/more')).toBeNull();
    expect(adapter.parseHistoryRoute('/teams/teamA/courses/planA/lessons')).toBeNull();
    expect(adapter.parseHistoryRoute('/teams/teamA/courses/planA/lessons/sessionA/more')).toBeNull();
    expect(adapter.parseHistoryRoute('/teams/teamA/courses/plan%2Fbad/lessons/sessionA')).toBeNull();
    expect(adapter.parseHistoryRoute('/teams/teamA/courses/planA/lessons/session%5Cbad')).toBeNull();
    expect(adapter.parseHistoryRoute('/t%65ams/teamA/courses/planA/lessons/sessionA')).toBeNull();
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
