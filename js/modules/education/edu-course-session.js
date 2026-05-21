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

  _getCourseSessionStudentInitial(name) {
    const chars = Array.from(String(name || '學員').trim());
    return chars[0] || '學';
  },

  _getCourseSessionStudentLinkedUser(student) {
    if (!student || typeof ApiService === 'undefined' || !ApiService.getUserByUid) return null;
    const ids = [student.selfUid, student.uid, student.lineUserId, student.userId]
      .map(v => String(v || '').trim())
      .filter(Boolean);
    for (const id of ids) {
      const user = ApiService.getUserByUid(id);
      if (user) return user;
    }
    return null;
  },

  _getCourseSessionStudentAvatarUrl(student) {
    if (!student) return '';
    const linkedUser = this._getCourseSessionStudentLinkedUser(student);
    const urls = [
      student.linePictureUrl,
      student.lineAvatarUrl,
      student.lineProfile?.pictureUrl,
      student.lineProfile?.pictureURL,
      student.pictureUrl,
      student.photoURL,
      student.photoUrl,
      student.avatarUrl,
      student.avatar,
      student.profileImage,
      student.profileImageUrl,
      student.profilePictureUrl,
      student.image,
      student.imageUrl,
      linkedUser?.linePictureUrl,
      linkedUser?.lineAvatarUrl,
      linkedUser?.lineProfile?.pictureUrl,
      linkedUser?.lineProfile?.pictureURL,
      linkedUser?.pictureUrl,
      linkedUser?.photoURL,
      linkedUser?.photoUrl,
      linkedUser?.avatarUrl,
      linkedUser?.avatar,
    ];
    if (Array.isArray(student.avatarCandidates)) urls.push(...student.avatarCandidates);
    if (Array.isArray(linkedUser?.avatarCandidates)) urls.push(...linkedUser.avatarCandidates);
    if (typeof this._getRenderableAvatarCandidateUrls === 'function') {
      return this._getRenderableAvatarCandidateUrls(urls)[0] || '';
    }
    const seen = new Set();
    return urls
      .flat()
      .map(url => (typeof url === 'string' ? url.trim() : ''))
      .find(url => {
        if (!url || seen.has(url)) return false;
        seen.add(url);
        return true;
      }) || '';
  },

  _renderCourseSessionStudentAvatarIcon() {
    return '<svg class="edu-session-avatar-svg" viewBox="0 0 32 32" aria-hidden="true" focusable="false">'
      + '<path class="edu-session-avatar-cap" d="M6.8 10.4 16 6.4l9.2 4-9.2 4-9.2-4Z"></path>'
      + '<path class="edu-session-avatar-cap-line" d="M10.8 13v3.2c1.44 1.12 3.17 1.68 5.2 1.68s3.76-.56 5.2-1.68V13"></path>'
      + '<circle class="edu-session-avatar-head" cx="16" cy="17.2" r="4.25"></circle>'
      + '<path class="edu-session-avatar-body" d="M8.8 26.2c1.45-3.8 3.85-5.7 7.2-5.7s5.75 1.9 7.2 5.7"></path>'
      + '</svg>';
  },

  _renderCourseSessionStudentAvatar(student, name) {
    const avatarUrl = this._getCourseSessionStudentAvatarUrl(student);
    if (!avatarUrl) {
      return '<span class="edu-session-avatar edu-session-avatar-student" aria-hidden="true">'
        + this._renderCourseSessionStudentAvatarIcon()
        + '</span>';
    }
    return '<span class="edu-session-avatar edu-session-avatar-photo">'
      + '<img class="edu-session-avatar-img" src="' + escapeHTML(avatarUrl) + '" alt="' + escapeHTML(name || 'student') + '" loading="lazy" decoding="async" referrerpolicy="no-referrer" data-edu-session-avatar-fallback="1">'
      + '</span>';
  },

  _bindCourseSessionStudentAvatarFallbacks(root = document) {
    if (!root || typeof root.querySelectorAll !== 'function') return;
    root.querySelectorAll('img[data-edu-session-avatar-fallback="1"]').forEach(img => {
      if (img.dataset.eduSessionAvatarBound === '1') return;
      img.dataset.eduSessionAvatarBound = '1';
      const handleBroken = () => {
        if (img.dataset.eduSessionAvatarFallbackDone === '1') return;
        img.dataset.eduSessionAvatarFallbackDone = '1';
        if (typeof this._rememberBrokenAvatarUrl === 'function') {
          this._rememberBrokenAvatarUrl(img.currentSrc || img.src || '');
        }
        const parent = img.closest('.edu-session-avatar');
        if (!parent) return;
        parent.className = 'edu-session-avatar edu-session-avatar-student';
        parent.setAttribute('aria-hidden', 'true');
        parent.innerHTML = this._renderCourseSessionStudentAvatarIcon();
      };
      img.addEventListener('error', handleBroken, { once: true });
      const isBroken = typeof this._isImgBroken === 'function'
        ? this._isImgBroken(img)
        : (img.complete && img.naturalWidth < 2);
      if (isBroken) handleBroken();
    });
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
    const gender = student?.gender === 'male' ? '男' : student?.gender === 'female' ? '女' : '';
    const age = student?.birthday ? this.calcAge(student.birthday) : null;
    const group = (student?.groupNames || []).join('、');
    const attended = (this._courseAttendanceCount || {})[student?.id] || 0;
    const remaining = plan?.planType === 'session' && plan.totalSessions
      ? Math.max(0, (plan.totalSessions || 0) - attended) + '堂'
      : '—';
    const paidStatus = enrollment?.paidAt ? '已繳費' : (enrollment ? '未繳' : '—');
    const fields = [
      { cls: 'gender', label: '性別', value: gender || '—' },
      { cls: 'age', label: '年齡', value: age != null ? age + '歲' : '—' },
      { cls: 'group', label: '分組', value: group || '未分組' },
      { cls: 'paid', label: '繳費', value: paidStatus },
      { cls: 'remain', label: '剩餘', value: remaining },
    ];
    return fields.map(field => '<span class="edu-session-student-slot edu-session-student-slot-' + field.cls + '" aria-label="' + escapeHTML(field.label) + '">'
      + escapeHTML(field.value)
      + '</span>').join('');
  },

  _renderCourseSessionRosterHeader() {
    return '<div class="edu-session-roster-head" aria-hidden="true">'
      + '<span>性別</span>'
      + '<span>年齡</span>'
      + '<span>分組</span>'
      + '<span>繳費</span>'
      + '<span>剩餘</span>'
      + '</div>';
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
      const name = student.name || '未命名學員';
      return '<div class="edu-session-student">'
        + this._renderCourseSessionStudentAvatar(student, name)
        + '<span class="edu-session-list-main">'
          + '<strong>' + escapeHTML(name) + '</strong>'
          + '<span class="edu-session-student-tags">' + this._renderCourseSessionStudentTags(student, item.enrollment, plan) + '</span>'
        + '</span>'
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
    const rosterCountText = roster.length + ' 位核准學員' + (pendingCount ? '，' + pendingCount + ' 位待審核' : '');
    const planCover = String(plan?.coverImage || plan?.coverUrl || plan?.imageUrl || plan?.image || '').trim();
    const heroStyle = planCover ? ' style="--edu-session-cover:url(\'' + escapeHTML(planCover) + '\')"' : '';

    const sessionCards = sessions.length
      ? sessions.map((session, idx) => this._renderCourseSessionCard(session, {
          index: idx + 1, teamId, planId, isStaff,
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
        + '<div class="edu-session-section-title"><strong>課堂卡片</strong><span>教練、時間、地點與上課人數</span></div>'
        + '<div class="edu-session-list">' + sessionCards + '</div>'
      + '</section>'
      + '<section class="edu-session-roster-panel">'
        + '<div class="edu-session-section-title edu-session-roster-title"><div class="edu-session-roster-title-copy"><strong>方案學員</strong><span>(' + escapeHTML(rosterCountText) + ')</span></div>' + this._renderCourseSessionRosterHeader() + '</div>'
        + '<div class="edu-session-roster">' + (roster.length ? roster.map(item => {
            const student = item.student || {};
            const name = student.name || '未命名學員';
            return '<div class="edu-session-roster-item">'
              + this._renderCourseSessionStudentAvatar(student, name)
              + '<span class="edu-session-list-main">'
                + '<strong>' + escapeHTML(name) + '</strong>'
                + '<span class="edu-session-student-tags">' + this._renderCourseSessionStudentTags(student, item.enrollment, plan) + '</span>'
              + '</span>'
            + '</div>';
          }).join('') : '<div class="edu-session-empty-students">尚未有核准學員</div>') + '</div>'
      + '</section>'
      + '</div>';
    this._bindCourseSessionStudentAvatarFallbacks(container);
  },

  _renderCourseSessionCard(session, ctx) {
    const status = this._getCourseSessionStatusMeta(session);
    const capacity = session.capacity ? '/' + session.capacity : '';
    const current = (session.studentIds || []).length;
    const location = session.location || '地點未設定';
    const sessionDateTime = this._formatCourseSessionDate(session) + ' ' + this._formatCourseSessionTime(session);
    const actions = ctx.isStaff
      ? '<div class="edu-session-card-actions">'
          + '<button class="outline-btn small" onclick="event.stopPropagation();App.openCourseSessionForm(\'' + ctx.teamId + '\',\'' + ctx.planId + '\',\'' + session.id + '\')">編輯</button>'
          + '<button class="outline-btn small danger" onclick="event.stopPropagation();App.deleteCourseSession(\'' + ctx.teamId + '\',\'' + ctx.planId + '\',\'' + session.id + '\')">刪除</button>'
        + '</div>'
      : '';
    return '<article class="edu-session-card edu-session-card-' + status.cls + '">'
      + '<div class="edu-session-card-main">'
        + '<div class="edu-session-card-head">'
          + '<span class="edu-session-number">第 ' + ctx.index + ' 堂</span>'
          + '<span class="edu-session-status edu-session-status-' + status.cls + '">' + escapeHTML(status.label) + '</span>'
          + '<h4>' + escapeHTML(session.title || '未命名課堂') + '</h4>'
        + '</div>'
        + '<div class="edu-session-card-line">'
          + '<span><b>教練</b><em>' + escapeHTML(session.coachName || '未設定') + '</em></span>'
          + '<span><b>時間</b><em>' + escapeHTML(sessionDateTime) + '</em></span>'
          + '<span><b>地點</b><em>' + escapeHTML(location) + '</em></span>'
          + '<span><b>人數</b><em>' + current + capacity + ' 人</em></span>'
        + '</div>'
      + '</div>'
      + actions
      + '</article>';
  },
});
