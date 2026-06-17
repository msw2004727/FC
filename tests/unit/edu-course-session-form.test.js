const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(
  path.join(__dirname, '../../js/modules/education/edu-course-session-form.js'),
  'utf8'
);

function loadCourseSessionFormContext(overrides = {}) {
  const values = {
    'edu-session-title': 'Updated lesson',
    'edu-session-status': 'scheduled',
    'edu-session-date': '2099-06-02',
    'edu-session-start': '12:00',
    'edu-session-end': '13:00',
    'edu-session-location': 'Court A',
    'edu-session-manager': 'Manager A',
    'edu-session-manager-contact': 'line@example',
    'edu-session-coach': 'Coach A',
    'edu-session-coach-contact': 'coach@example',
    'edu-session-capacity': '6',
    'edu-session-focus': 'Backhand',
    'edu-session-notes': 'Bring water',
    ...(overrides.values || {}),
  };
  const elements = Object.fromEntries(
    Object.entries(values).map(([id, value]) => [id, { value }])
  );
  const overlay = { remove: jest.fn() };
  const buttonState = { restore: jest.fn() };
  const cacheKey = 'teamA:planA';
  const app = {
    _eduCourseSessionEditContext: { teamId: 'teamA', planId: 'planA', sessionId: 'sessionA' },
    _courseSessionCache: {
      [cacheKey]: [
        { id: 'sessionA', title: 'Old A', date: '2099-06-02', startTime: '10:00', endTime: '11:00' },
        { id: 'sessionB', title: 'Old B', date: '2099-06-02', startTime: '11:00', endTime: '12:00' },
      ],
    },
    _getCourseSessionCacheKey: jest.fn(() => cacheKey),
    _getCourseSessionSortValue: jest.fn((session) => new Date(`${session.date || ''}T${session.startTime || '00:00'}`).getTime()),
    _markCourseSessionCacheMutated: jest.fn(() => cacheKey),
    _getCourseSessionAssistantCoachPayload: jest.fn(() => []),
    _setEduBtnLoading: jest.fn(() => buttonState),
    _renderCourseSessionBoard: jest.fn(async () => {}),
    _refreshCourseLessonsAfterSessionSave: jest.fn(async () => true),
    _generateEduId: jest.fn(() => 'cls_new'),
    showToast: jest.fn(),
    ...(overrides.app || {}),
  };
  const firebase = {
    updateCourseSession: jest.fn(async (_teamId, _planId, sessionId, payload) => ({
      id: sessionId,
      _docId: sessionId,
      ...payload,
    })),
    createCourseSession: jest.fn(async (_teamId, _planId, payload) => ({ ...payload })),
    ...(overrides.FirebaseService || {}),
  };
  const documentMock = {
    getElementById: jest.fn((id) => elements[id] || null),
    querySelectorAll: jest.fn((selector) => (
      selector === '#edu-session-student-pick input[type="checkbox"]:checked'
        ? (overrides.checkedStudents || []).map(value => ({ value }))
        : []
    )),
    querySelector: jest.fn((selector) => (selector === '.edu-session-form-overlay' ? overlay : null)),
  };

  const context = {
    App: app,
    FirebaseService: firebase,
    document: documentMock,
    console,
    Date,
    String,
    Number,
    Array,
    Object,
    parseInt,
  };
  vm.runInNewContext(source, context, { filename: 'edu-course-session-form.js' });
  return { app: context.App, firebase, overlay, buttonState };
}

describe('edu course session form', () => {
  test('saving an edited session updates sorted cache and refreshes the active lessons view', async () => {
    const { app, firebase, overlay, buttonState } = loadCourseSessionFormContext();

    await app.handleSaveCourseSession();

    expect(firebase.updateCourseSession).toHaveBeenCalledWith('teamA', 'planA', 'sessionA', expect.objectContaining({
      title: 'Updated lesson',
      date: '2099-06-02',
      startTime: '12:00',
      endTime: '13:00',
    }));
    expect(app._courseSessionCache['teamA:planA'].map(session => session.id)).toEqual(['sessionB', 'sessionA']);
    expect(app._courseSessionCache['teamA:planA'][1]).toMatchObject({
      id: 'sessionA',
      title: 'Updated lesson',
      startTime: '12:00',
      endTime: '13:00',
    });
    expect(overlay.remove).toHaveBeenCalled();
    expect(app._markCourseSessionCacheMutated).toHaveBeenCalledWith('teamA', 'planA');
    expect(app._renderCourseSessionBoard).toHaveBeenCalledWith('teamA', 'planA');
    expect(app._refreshCourseLessonsAfterSessionSave).toHaveBeenCalledWith('teamA', 'planA', 'sessionA');
    expect(app.showToast).toHaveBeenCalledWith('課堂已更新');
    expect(buttonState.restore).toHaveBeenCalled();
  });

  test('does not fail a saved session when refreshing the active lessons view fails', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const refreshErr = new Error('refresh failed');
      const { app, firebase, buttonState } = loadCourseSessionFormContext({
        app: {
          _refreshCourseLessonsAfterSessionSave: jest.fn(async () => {
            throw refreshErr;
          }),
        },
      });

      await app.handleSaveCourseSession();

      expect(firebase.updateCourseSession).toHaveBeenCalledWith('teamA', 'planA', 'sessionA', expect.any(Object));
      expect(app.showToast).toHaveBeenCalledTimes(1);
      expect(app.showToast).toHaveBeenCalledWith('課堂已更新');
      expect(warnSpy).toHaveBeenCalledWith('[handleSaveCourseSession] course lessons refresh failed:', refreshErr);
      expect(buttonState.restore).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });
});
