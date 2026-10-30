/** @jest-environment jsdom */
const { VALUES, load, mount, activate } = require('./event-binding-render-support');
afterEach(() => { document.body.innerHTML = ''; delete window.__x; });
describe.each(VALUES)('事件繫結強化：教育模組原值 %p', value => {
  test('掃碼頁返回批次簽到', async () => {
    const { app } = load('education/edu-checkin-scan.js');
    Object.assign(app, { _eduCheckinPageRequestSeq: 0, currentPage: 'page-edu-checkin', showPage: async () => {}, _startEduScan: () => {} });
    mount('<div id="edu-checkin-container"></div>'); await app.showEduCheckinScan(value);
    activate(app, '.outline-btn', [['_stopEduScan', []], ['showEduCheckin', [value]]]);
  });
  test('已核准學員名單與繳費', () => {
    const { app } = load('education/edu-course-enrollment-render.js');
    mount(app._renderApprovedEnrollmentCard({ id: value, studentId: value, studentName: value }, { price: 1 }, [], value, value, true));
    expect(document.querySelector('.edu-ce-name').textContent).toBe(value);
    activate(app, '.edu-ce-remove-approved-btn', [['_removeApprovedCourseEnrollment', el => [value, value, value, el]]]);
    activate(app, '.edu-ce-paid-label input', [['_toggleEnrollPaid', [value, value, value]]], 'change');
  });
  test('課堂列表與課程名', () => {
    const { app } = load('education/edu-course-lessons-render.js');
    Object.assign(app, { _getCourseLessonStatusMeta: () => ({ cls: 'active', label: '課堂' }), _getCourseLessonStudentCount: () => 1,
      _isCourseLessonRescheduledSession: () => false, _isCourseLessonMakeupSession: () => false,
      _getCourseLessonEventLinkState: () => ({}), _formatCourseLessonDateTime: () => '' });
    mount(app._renderCourseLessonList({ id: value, name: value }, [{ id: value, title: value }], { teamId: value, isStaff: true, planType: 'weekly' }));
    expect(document.querySelector('.edu-course-lesson-head h3').textContent).toBe(value);
    activate(app, '.edu-course-lesson-card', [['showCourseLessonRoster', [value, value, value]]]);
    activate(app, '.edu-course-lesson-convert-event-btn', [['convertCourseLessonToEvent', el => [value, value, value, el]]]);
    activate(app, '.edu-course-lesson-share-btn', [['shareEduCourseLesson', [value, value, value]]]);
  });
  test('課堂學員名單：名片與出席選項', () => {
    const { app } = load('education/edu-course-lessons-render.js');
    Object.assign(app, { _getCourseLessonStatusMeta: () => ({ cls: 'active', label: '' }), _isCourseLessonRescheduledSession: () => false,
      _getCourseLessonAttendanceMeta: () => ({ cls: 'pending', label: '' }), _formatCourseLessonDateTime: () => '' });
    mount(app._renderCourseLessonRosterView({ session: { title: value }, students: [{ id: value, displayName: value }] },
      { teamId: value, planId: value, isStaff: true, manageMode: true }));
    expect(document.querySelector('.edu-course-member-pill').textContent).toBe(value);
    activate(app, '.edu-course-member-pill', [['showUserProfile', [value]]]);
    document.querySelector('.edu-roster-cb-signin').checked = true;
    activate(app, '.edu-roster-cb-signin', [['setCourseLessonRosterDraft', [value, 'signin']]], 'change');
  });
  test('課堂載入失敗重試', () => {
    const { app } = load('education/edu-course-lessons.js');
    mount(app._renderCourseLessonRosterLoadFailure(value, value, value));
    activate(app, '.primary-btn', [['showCourseLessonRoster', [value, value, value, { forceRefresh: true }]]]);
  });
  test('出席月曆累加內容', async () => {
    const records = [{ date: '2026-10-15', studentId: value, studentName: value }];
    const { app } = load('education/edu-course-plan-attendance.js', {}, {}, { FirebaseService: { queryEduAttendance: async () => records } });
    Object.assign(app, { _attendInfoTeamId: value, _attendInfoPlanId: value, _attendInfoYear: 2026, _attendInfoMonth: 9, getEduStudents: () => [{ id: value, name: value }] });
    mount('<div id="_eduAttendCalBody"></div>'); await app._renderAttendInfoCalendar();
    activate(app, '.edu-attend-cal-has', [['_showAttendDayDetail', ['2026-10-15']]]);
  });
  test('課程方案快取列表與課程名', () => {
    const { app } = load('education/edu-course-plan-render.js', { getCurrentUser: () => null });
    app._getCoursePlanViewerEnrollmentState = () => ({});
    mount('<div id="edu-course-plan-list"></div>');
    app._renderEduCoursePlanCachedList(value, true, [{ id: value, name: value, allowSignup: true }]);
    expect(document.querySelector('.edu-course-name').textContent).toBe(value);
    activate(app, '.edu-cp-detail-btn', [['showEduCoursePlanDetail', [value, value]]]);
    activate(app, '.edu-cp-manage-list', [['showCourseEnrollmentList', [value, value]]]);
    activate(app, '.edu-cp-signup-btn', [['applyCourseEnrollment', el => [value, value, el]]]);
  });
  test('課程方案人員搜尋', () => {
    const { app } = load('education/edu-course-plan.js');
    mount('<div id="edu-cp-manager-suggest"></div>');
    app._renderCoursePlanStaffSuggestList('manager', [{ key: value, name: value }]);
    expect(document.querySelector('.tus-name').textContent).toBe(value);
    activate(app, '.team-user-suggest-item', [['selectCoursePlanStaff', ['manager', encodeURIComponent(value)]]], 'mousedown');
  });
  test('課堂表單範本', () => {
    const { app } = load('education/edu-course-session-form.js');
    Object.assign(app, { _getCourseSessionTemplates: () => [{ id: value, name: value }], _getCourseSessionTemplatesFromLocal: () => [] });
    mount('<div id="edu-session-template-selector"></div>'); app._renderCourseSessionTemplateSelector();
    activate(app, '.edu-session-template-chip', [['_loadCourseSessionTemplate', [value]]]);
    activate(app, '.edu-session-template-chip button', [['_deleteCourseSessionTemplate', [value]]]);
  });
  test('課堂名片 JSON 分支與備註列', () => {
    const { app } = load('education/edu-course-session.js');
    app._getCourseSessionMemberPillClass = () => 'pill';
    for (const uid of [value, '']) {
      app._getCourseSessionStudentProfileMeta = () => ({ displayName: value, uid });
      mount(app._renderCourseSessionMemberPill({}, value));
      expect(document.querySelector('.pill').textContent).toBe(value);
      activate(app, '.pill', [['showUserProfile', uid ? [value, { uid }] : [value]]]);
    }
    mount(app._renderCourseSessionRosterNoteCell({ id: value }, { id: value, coachNotes: value }, { teamId: value, planId: value, isStaff: true }));
    activate(app, '.edu-session-note-edit', [['editCourseSessionRosterNote', [value, value, value, value]]]);
  });
  test('教育詳情課程與分組新增', () => {
    const { app } = load('education/edu-detail-render.js');
    Object.assign(app, { isEduClubStaff: () => true, _normalizeEduDetailTab: x => x, renderEduGroupList: () => {} });
    for (const tab of ['course', 'group']) {
      mount('<div id="edu-detail-tab-content"></div>'); app._eduActiveTab = tab; app._renderEduTabContent(value);
      activate(app, '.primary-btn', [[tab === 'course' ? 'showEduCoursePlanForm' : 'showEduGroupForm', [value]]]);
    }
  });
  test('教育詳情快取完成後新增', async () => {
    const { app } = load('education/edu-detail-render.js');
    Object.assign(app, { isEduClubStaff: () => true, _normalizeEduDetailTab: x => x,
      _eduCoursePlansCache: { [value]: [] }, _eduGroupsCache: { [value]: [] },
      renderEduCoursePlanList: async () => {}, renderEduGroupList: async () => {} });
    for (const tab of ['course', 'group']) {
      mount('<div id="edu-detail-tab-content"></div>'); app._eduActiveTab = tab; await app._renderEduTabContent(value);
      const method = tab === 'course' ? 'showEduCoursePlanForm' : 'showEduGroupForm'; app[method] = jest.fn();
      const count = document.querySelectorAll('*').length; document.querySelector('.primary-btn').click();
      expect(app[method]).toHaveBeenCalledTimes(1); expect(app[method]).toHaveBeenCalledWith(value);
      expect(window.__x).toBeUndefined(); expect(document.querySelectorAll('*').length).toBe(count);
    }
  });
  test('分組列表', () => {
    const { app } = load('education/edu-group-list.js');
    Object.assign(app, { isEduClubStaff: () => true, getEduStudents: () => [], getUnmatchedPendingStudents: () => [] });
    mount('<div id="edu-group-list"></div>'); app._renderEduGroupListRows(value, [{ id: value, name: value }]);
    expect(document.querySelector('.edu-group-name').textContent).toBe(value);
    activate(app, '.edu-group-card', [['showEduStudentList', [value, value]]]);
    activate(app, '.outline-btn', [['showEduGroupForm', [value, value]]]);
  });
  test('加入學員列', () => {
    const { app } = load('education/edu-student-form.js'); app.calcAge = () => null;
    mount(app._buildAssignStudentRows([{ id: value, name: value }], value, value));
    expect(document.querySelector('.edu-student-name').textContent).toBe(value);
    activate(app, '.primary-btn', [['_assignStudentToGroup', [value, value, value]]]);
  });
  test('學員名單：審核與正式學員', () => {
    const { app } = load('education/edu-student-list.js'); app.calcAge = () => null;
    mount(app._renderPendingStudentRow(value, value, { id: value, name: value }));
    expect(document.querySelector('.edu-student-name').textContent).toBe(value);
    activate(app, '.edu-approve-btn', [['_approveFromList', el => [value, value, el]]]);
    activate(app, '.edu-reject-btn', [['_rejectFromList', el => [value, value, el]]]);
    mount(app._renderActiveStudentRow(value, value, { id: value, name: value }, true));
    activate(app, '[onclick*="showEduStudentForm"]', [['showEduStudentForm', [value, value]]]);
    activate(app, '[onclick*="_removeStudentFromGroup"]', [['_removeStudentFromGroup', el => [value, value, value, el]]]);
  });
});
