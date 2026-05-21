/* ================================================
   SportHub — Education: Course Sessions
   ================================================
   堂數制課堂卡片、課堂名單與教練聯繫資訊
   ================================================ */

Object.assign(App, {
  _courseSessionCache: {},
  _eduCourseSessionEditContext: null,

  _getCourseSessionCacheKey(teamId, planId) {
    return teamId + ':' + planId;
  },

  async _loadCourseSessions(teamId, planId) {
    const key = this._getCourseSessionCacheKey(teamId, planId);
    try {
      const list = await FirebaseService.listCourseSessions(teamId, planId);
      list.sort((a, b) => this._getCourseSessionSortValue(a) - this._getCourseSessionSortValue(b));
      this._courseSessionCache[key] = list;
      return list;
    } catch (err) {
      console.error('[edu-course-session] load failed:', err);
      return this._courseSessionCache[key] || [];
    }
  },

  _getCourseSessionSortValue(session) {
    if (!session) return 0;
    const raw = [session.date || '', session.startTime || '00:00'].filter(Boolean).join('T');
    const ms = raw ? new Date(raw).getTime() : NaN;
    return Number.isFinite(ms) ? ms : 0;
  },

  _getEduTeamRecord(teamId) {
    const teams = typeof ApiService !== 'undefined' && ApiService.getTeams ? (ApiService.getTeams() || []) : [];
    return teams.find(t => String(t.id || t._docId || '') === String(teamId)) || null;
  },

  _formatCourseSessionDate(session) {
    if (!session?.date) return '未排定日期';
    const parts = String(session.date).split('-').map(v => parseInt(v, 10));
    if (parts.length !== 3 || parts.some(v => !Number.isFinite(v))) return session.date;
    const date = new Date(parts[0], parts[1] - 1, parts[2]);
    const week = ['日', '一', '二', '三', '四', '五', '六'][date.getDay()];
    return parts[1] + '/' + parts[2] + ' 週' + week;
  },

  _formatCourseSessionTime(session) {
    const start = session?.startTime || '';
    const end = session?.endTime || '';
    if (start && end) return start + ' - ' + end;
    return start || end || '未設定時段';
  },

  _getCourseSessionStatusMeta(session) {
    const status = String(session?.status || '').trim();
    if (status === 'cancelled') return { label: '已取消', cls: 'cancelled' };
    if (status === 'done') return { label: '已完成', cls: 'done' };
    const ms = this._getCourseSessionSortValue(session);
    if (ms && ms < Date.now() - 6 * 60 * 60 * 1000) return { label: '已完成', cls: 'done' };
    if (ms && ms <= Date.now() + 24 * 60 * 60 * 1000) return { label: '即將上課', cls: 'soon' };
    return { label: '已排課', cls: 'scheduled' };
  },

  _getCourseApprovedRoster(teamId, plan, enrollments) {
    const allStudents = this.getEduStudents(teamId) || [];
    const byId = new Map(allStudents.map(s => [String(s.id || s._docId || ''), s]));
    const roster = [];
    const seen = new Set();
    (enrollments || []).filter(e => e.status === 'approved').forEach(e => {
      const key = String(e.studentId || '');
      if (!key || seen.has(key)) return;
      seen.add(key);
      roster.push({ student: byId.get(key) || { id: key, name: e.studentName || '未命名學員' }, enrollment: e });
    });
    if (plan?.groupId) {
      allStudents
        .filter(s => s.enrollStatus === 'active' && (s.groupIds || []).includes(plan.groupId))
        .forEach(s => {
          const key = String(s.id || s._docId || '');
          if (!key || seen.has(key)) return;
          seen.add(key);
          roster.push({ student: s, enrollment: null });
        });
    }
    return roster.sort((a, b) => String(a.student?.name || '').localeCompare(String(b.student?.name || ''), 'zh-Hant'));
  },

  _renderCourseSessionStudentTags(student, enrollment, plan) {
    const tags = [];
    const gender = student?.gender === 'male' ? '男' : student?.gender === 'female' ? '女' : '';
    const age = student?.birthday ? this.calcAge(student.birthday) : null;
    if (gender) tags.push(gender);
    if (age != null) tags.push(age + '歲');
    const group = (student?.groupNames || []).join('、');
    if (group) tags.push(group);
    if (enrollment?.paidAt) tags.push('已繳費');
    const attended = (this._courseAttendanceCount || {})[student?.id] || 0;
    if (plan?.planType === 'session' && plan.totalSessions) {
      tags.push('剩 ' + Math.max(0, (plan.totalSessions || 0) - attended) + ' 堂');
    }
    return tags.map(tag => '<span>' + escapeHTML(tag) + '</span>').join('');
  },

  _renderCourseSessionStudents(studentIds, roster, plan) {
    const selected = new Set((studentIds || []).map(String));
    const visibleRoster = selected.size
      ? roster.filter(item => selected.has(String(item.student?.id || item.student?._docId || '')))
      : [];
    if (!visibleRoster.length) {
      return '<div class="edu-session-empty-students">尚未安排學員</div>';
    }
    return visibleRoster.map(item => {
      const student = item.student || {};
      return '<div class="edu-session-student">'
        + '<strong>' + escapeHTML(student.name || '未命名學員') + '</strong>'
        + '<span class="edu-session-student-tags">' + this._renderCourseSessionStudentTags(student, item.enrollment, plan) + '</span>'
        + '</div>';
    }).join('');
  },

  async _renderCourseSessionBoard(teamId, planId, requestSeq) {
    const container = document.getElementById('edu-ce-list');
    if (!container) return;

    const plan = this.getEduCoursePlans(teamId).find(p => p.id === planId);
    const enrollments = await this._loadCourseEnrollments(teamId, planId);
    if (requestSeq != null && requestSeq !== this._eduCourseEnrollmentRequestSeq) return;
    const sessions = await this._loadCourseSessions(teamId, planId);
    if (requestSeq != null && requestSeq !== this._eduCourseEnrollmentRequestSeq) return;

    this._courseAttendanceCount = {};
    try {
      const attendRecords = await FirebaseService.queryEduAttendance({ teamId, coursePlanId: planId });
      if (requestSeq != null && requestSeq !== this._eduCourseEnrollmentRequestSeq) return;
      attendRecords.forEach(r => {
        this._courseAttendanceCount[r.studentId] = (this._courseAttendanceCount[r.studentId] || 0) + 1;
      });
    } catch (_) {}

    const isStaff = this.isEduClubStaff(teamId);
    const roster = this._getCourseApprovedRoster(teamId, plan, enrollments);
    const pendingCount = enrollments.filter(e => e.status === 'pending').length;
    const nextSession = sessions.find(s => this._getCourseSessionSortValue(s) >= Date.now()) || sessions[0] || null;
    const plannedSeats = sessions.reduce((sum, s) => sum + ((s.studentIds || []).length || 0), 0);
    const planCover = String(plan?.coverImage || plan?.coverUrl || plan?.imageUrl || plan?.image || '').trim();
    const heroStyle = planCover ? ' style="--edu-session-cover:url(\'' + escapeHTML(planCover) + '\')"' : '';

    const sessionCards = sessions.length
      ? sessions.map((session, idx) => this._renderCourseSessionCard(session, {
          index: idx + 1, teamId, planId, plan, roster, isStaff, planCover,
        })).join('')
      : '<div class="edu-session-empty">'
          + '<strong>尚未建立課堂卡片</strong>'
          + '<span>點擊「新增課堂」後，這裡會以橫向附圖卡片顯示每一堂課的時間、人數、教練與學員名單。</span>'
        + '</div>';

    const contactHtml = nextSession
      ? '<div class="edu-session-contact-row"><span>負責人</span><strong>' + escapeHTML(nextSession.managerName || '未設定') + '</strong><em>' + escapeHTML(nextSession.managerContact || '未填聯繫方式') + '</em></div>'
        + '<div class="edu-session-contact-row"><span>執課教練</span><strong>' + escapeHTML(nextSession.coachName || '未設定') + '</strong><em>' + escapeHTML(nextSession.coachContact || '未填聯繫方式') + '</em></div>'
      : '<div class="edu-session-contact-row"><span>負責人 / 教練</span><strong>尚未建立課堂</strong><em>新增課堂時填寫聯繫方式</em></div>';

    container.innerHTML = '<div class="edu-session-board">'
      + '<section class="edu-session-hero"' + heroStyle + '>'
        + '<div class="edu-session-hero-main">'
          + '<span class="edu-session-eyebrow">堂數制課堂</span>'
          + '<h3>' + escapeHTML(plan?.name || '課程方案') + '</h3>'
          + '<p>' + escapeHTML((plan?.startDate || '未設定期間') + (plan?.endDate ? ' - ' + plan.endDate : '')) + '</p>'
          + '<div class="edu-session-hero-actions">'
            + (isStaff ? '<button class="primary-btn small" onclick="App.openCourseSessionForm(\'' + teamId + '\',\'' + planId + '\')">＋ 新增課堂</button>' : '')
            + '<button class="outline-btn small" onclick="App.showEduCheckin(App._ceTeamId, App._cePlanId)">簽到</button>'
            + '<button class="outline-btn small" onclick="App._showCourseAttendanceInfo(App._ceTeamId, App._cePlanId)">出席統計</button>'
          + '</div>'
        + '</div>'
        + '<div class="edu-session-hero-stats">'
          + '<div><span>已建課堂</span><strong>' + sessions.length + '</strong></div>'
          + '<div><span>核准學員</span><strong>' + roster.length + '</strong></div>'
          + '<div><span>安排人次</span><strong>' + plannedSeats + '</strong></div>'
          + '<div><span>待審核</span><strong>' + pendingCount + '</strong></div>'
        + '</div>'
      + '</section>'
      + '<section class="edu-session-contact-panel">'
        + '<div class="edu-session-section-title"><strong>課務聯繫</strong><span>顯示下一堂或最近一堂課的聯繫資訊</span></div>'
        + '<div class="edu-session-contact-grid">' + contactHtml + '</div>'
      + '</section>'
      + '<section class="edu-session-list-panel">'
        + '<div class="edu-session-section-title"><strong>課堂卡片</strong><span>每一堂課的時間、人數與學員標籤</span></div>'
        + '<div class="edu-session-list">' + sessionCards + '</div>'
      + '</section>'
      + '<section class="edu-session-roster-panel">'
        + '<div class="edu-session-section-title"><strong>方案學員</strong><span>' + roster.length + ' 位核准學員' + (pendingCount ? '，' + pendingCount + ' 位待審核' : '') + '</span></div>'
        + '<div class="edu-session-roster">' + (roster.length ? roster.map(item => {
            const student = item.student || {};
            return '<div class="edu-session-roster-item"><strong>' + escapeHTML(student.name || '未命名學員') + '</strong><span>' + this._renderCourseSessionStudentTags(student, item.enrollment, plan) + '</span></div>';
          }).join('') : '<div class="edu-session-empty-students">尚未有核准學員</div>') + '</div>'
      + '</section>'
      + '</div>';
  },

  _renderCourseSessionCard(session, ctx) {
    const status = this._getCourseSessionStatusMeta(session);
    const capacity = session.capacity ? '/' + session.capacity : '';
    const current = (session.studentIds || []).length;
    const cover = session.coverImage || ctx.planCover || '';
    const visual = cover
      ? '<div class="edu-session-card-img"><img src="' + escapeHTML(cover) + '" alt="" loading="lazy" decoding="async"></div>'
      : '<div class="edu-session-card-img edu-session-card-img-empty"><span>Lesson</span></div>';
    const focus = session.focus ? '<p class="edu-session-focus">' + escapeHTML(session.focus) + '</p>' : '';
    const location = session.location ? '<span>' + escapeHTML(session.location) + '</span>' : '<span>地點未設定</span>';
    const actions = ctx.isStaff
      ? '<div class="edu-session-card-actions">'
          + '<button class="outline-btn small" onclick="event.stopPropagation();App.openCourseSessionForm(\'' + ctx.teamId + '\',\'' + ctx.planId + '\',\'' + session.id + '\')">編輯</button>'
          + '<button class="outline-btn small danger" onclick="event.stopPropagation();App.deleteCourseSession(\'' + ctx.teamId + '\',\'' + ctx.planId + '\',\'' + session.id + '\')">刪除</button>'
        + '</div>'
      : '';
    return '<article class="edu-session-card edu-session-card-' + status.cls + '">'
      + visual
      + '<div class="edu-session-card-body">'
        + '<div class="edu-session-card-top">'
          + '<span class="edu-session-number">第 ' + ctx.index + ' 堂</span>'
          + '<span class="edu-session-status edu-session-status-' + status.cls + '">' + escapeHTML(status.label) + '</span>'
        + '</div>'
        + '<h4>' + escapeHTML(session.title || '未命名課堂') + '</h4>'
        + '<div class="edu-session-meta-row">'
          + '<span>' + escapeHTML(this._formatCourseSessionDate(session)) + '</span>'
          + '<span>' + escapeHTML(this._formatCourseSessionTime(session)) + '</span>'
          + location
          + '<span>' + current + capacity + ' 人</span>'
        + '</div>'
        + '<div class="edu-session-people-grid">'
          + '<div><span>負責人</span><strong>' + escapeHTML(session.managerName || '未設定') + '</strong><em>' + escapeHTML(session.managerContact || '未填聯繫') + '</em></div>'
          + '<div><span>執課教練</span><strong>' + escapeHTML(session.coachName || '未設定') + '</strong><em>' + escapeHTML(session.coachContact || '未填聯繫') + '</em></div>'
        + '</div>'
        + focus
        + '<div class="edu-session-card-students">' + this._renderCourseSessionStudents(session.studentIds, ctx.roster, ctx.plan) + '</div>'
        + actions
      + '</div>'
      + '</article>';
  },
});
