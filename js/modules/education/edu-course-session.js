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

  _parseCoursePlanTimeSlot(timeSlot) {
    const raw = String(timeSlot || '').trim();
    const parts = raw.split(/\s*[-~–—]\s*/).map(part => part.trim()).filter(Boolean);
    const normalize = (value, fallback) => {
      const match = String(value || '').match(/^(\d{1,2}):(\d{2})/);
      if (!match) return fallback;
      const hour = Math.max(0, Math.min(23, parseInt(match[1], 10)));
      const minute = Math.max(0, Math.min(59, parseInt(match[2], 10)));
      return String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0');
    };
    return {
      startTime: normalize(parts[0], '19:00'),
      endTime: normalize(parts[1], '20:30'),
    };
  },

  _addDaysToCourseDate(dateStr, days) {
    const parts = String(dateStr || '').split('-').map(value => parseInt(value, 10));
    if (parts.length !== 3 || parts.some(value => !Number.isFinite(value))) return '';
    const date = new Date(parts[0], parts[1] - 1, parts[2]);
    date.setDate(date.getDate() + Number(days || 0));
    return date.getFullYear() + '-'
      + String(date.getMonth() + 1).padStart(2, '0') + '-'
      + String(date.getDate()).padStart(2, '0');
  },

  _getSessionPlanAutoDate(plan, index, totalSessions) {
    const startDate = String(plan?.startDate || '').trim();
    const endDate = String(plan?.endDate || '').trim();
    if (!startDate) return '';
    if (!endDate || totalSessions <= 1) return this._addDaysToCourseDate(startDate, index * 7);
    const start = new Date(startDate);
    const end = new Date(endDate);
    const diffDays = Math.max(0, Math.round((end.getTime() - start.getTime()) / 86400000));
    const offset = Math.round((diffDays * index) / Math.max(1, totalSessions - 1));
    return this._addDaysToCourseDate(startDate, offset);
  },

  _getCoursePlanDefaultSessionStaff(teamId, plan = {}) {
    const team = this._getEduTeamRecord?.(teamId) || {};
    const user = typeof ApiService !== 'undefined' ? ApiService.getCurrentUser?.() : null;
    const managerName = String(
      plan.managerName
      || user?.displayName
      || user?.name
      || team.leader
      || team.captain
      || team.captainName
      || ''
    ).trim();
    const managerContact = String(
      plan.managerContact
      || team.contact
      || team.eduSettings?.contact
      || ''
    ).trim();
    const coachName = String(
      plan.coachName
      || plan.coach
      || (Array.isArray(team.coaches) ? team.coaches[0] : '')
      || team.leader
      || team.captain
      || managerName
      || ''
    ).trim();
    return {
      managerName,
      managerContact,
      coachName,
      coachContact: String(plan.coachContact || managerContact || '').trim(),
    };
  },

  async _getCoursePlanAutoSessionStudentIds(teamId, plan) {
    if (!teamId || !plan || typeof this._loadCourseEnrollments !== 'function' || typeof this._getCourseApprovedRoster !== 'function') {
      return [];
    }
    try {
      const enrollments = await this._loadCourseEnrollments(teamId, plan.id || plan._docId);
      return this._getCourseApprovedRoster(teamId, plan, enrollments)
        .map(item => String(item?.student?.id || item?.student?._docId || '').trim())
        .filter(Boolean);
    } catch (err) {
      console.warn('[course sessions] approved roster preload failed:', err);
      return [];
    }
  },

  _getCourseSessionExistingSlotMap(sessions) {
    const sorted = [...(sessions || [])].sort((a, b) => this._getCourseSessionSortValue(a) - this._getCourseSessionSortValue(b));
    const used = new Set();
    const bySlot = new Map();
    sorted.forEach((session) => {
      const explicit = Number(session?.sessionNumber || session?.lessonNumber || 0);
      let slot = Number.isInteger(explicit) && explicit > 0 ? explicit : 0;
      while (!slot || used.has(slot)) slot = slot + 1;
      used.add(slot);
      bySlot.set(slot, session);
    });
    return bySlot;
  },

  _buildAutoCourseSessionPayload(teamId, plan, index, overrides = {}) {
    const slot = index + 1;
    const isWeekly = plan?.planType === 'weekly';
    const sessionSchedule = !isWeekly && Array.isArray(plan?.sessionSchedules)
      ? (plan.sessionSchedules[index] || {})
      : {};
    const scheduledTime = [sessionSchedule.startTime, sessionSchedule.endTime].filter(Boolean).join('-');
    const time = this._parseCoursePlanTimeSlot(isWeekly ? plan?.timeSlot : scheduledTime);
    const staff = this._getCoursePlanDefaultSessionStaff(teamId, plan);
    const date = overrides.date || (isWeekly ? '' : (sessionSchedule.date || this._getSessionPlanAutoDate(plan, index, Number(plan?.totalSessions || 0))));
    return {
      id: overrides.id || (isWeekly ? 'auto_weekly_' + String(date || slot).replace(/[^0-9a-zA-Z_-]/g, '') : 'auto_session_' + slot),
      title: overrides.title || (Array.isArray(plan?.lessonTitles) && plan.lessonTitles[index] ? plan.lessonTitles[index] : '第 ' + slot + ' 堂課'),
      status: 'scheduled',
      date,
      startTime: overrides.startTime || sessionSchedule.startTime || time.startTime,
      endTime: overrides.endTime || sessionSchedule.endTime || time.endTime,
      location: String(plan?.location || '').trim(),
      capacity: Number.isFinite(Number(plan?.maxCapacity)) && Number(plan.maxCapacity) > 0 ? Number(plan.maxCapacity) : null,
      studentIds: Array.isArray(overrides.studentIds) ? overrides.studentIds : [],
      managerName: staff.managerName,
      managerContact: staff.managerContact,
      coachName: staff.coachName,
      coachContact: staff.coachContact,
      assistantCoaches: [],
      assistantCoachNames: [],
      focus: '',
      notes: '',
      sessionNumber: slot,
      autoGenerated: true,
      autoSource: isWeekly ? 'weekly-plan' : 'session-plan',
    };
  },

  _isAutoManagedCourseSession(session) {
    const id = String(session?.id || session?._docId || '').trim();
    const source = String(session?.autoSource || '').trim();
    return session?.autoGenerated === true
      || source === 'session-plan'
      || source === 'weekly-plan'
      || /^auto_(session|weekly)_/.test(id);
  },

  _isCourseSessionFrozenForRoster(session, statusMeta) {
    const status = String(session?.status || '').trim();
    const meta = statusMeta || this._getCourseSessionStatusMeta?.(session);
    return status === 'done' || meta?.cls === 'done';
  },

  _getCourseSessionDisplayStudentCount(session, options = {}) {
    const frozenCount = Array.isArray(session?.studentIds) ? session.studentIds.length : 0;
    if (this._isCourseSessionFrozenForRoster(session, options.statusMeta)) return frozenCount;
    const rawDynamicCount = options.currentStudentCount;
    const dynamicCount = rawDynamicCount === null || rawDynamicCount === undefined || rawDynamicCount === ''
      ? NaN
      : Number(rawDynamicCount);
    if (Number.isFinite(dynamicCount) && dynamicCount >= 0) return dynamicCount;
    return frozenCount;
  },

  _getCourseSessionDisplayStudentIds(session, roster) {
    const frozenIds = Array.isArray(session?.studentIds)
      ? session.studentIds.map(value => String(value || '').trim()).filter(Boolean)
      : [];
    if (this._isCourseSessionFrozenForRoster(session)) return frozenIds;
    const dynamicIds = (Array.isArray(roster) ? roster : [])
      .map(item => String(item?.student?.id || item?.student?._docId || '').trim())
      .filter(Boolean);
    return dynamicIds.length ? dynamicIds : frozenIds;
  },

  _buildExpectedAutoCourseSessions(teamId, plan, studentIds) {
    if (!plan) return [];
    const rosterIds = Array.isArray(studentIds) ? studentIds : [];
    if (plan.planType === 'weekly') {
      const dates = typeof this.generateWeeklyDates === 'function' ? this.generateWeeklyDates(plan) : [];
      const time = this._parseCoursePlanTimeSlot(plan.timeSlot);
      return dates.map((date, index) => this._buildAutoCourseSessionPayload(teamId, plan, index, {
        id: 'auto_weekly_' + String(date).replace(/-/g, ''),
        date,
        startTime: time.startTime,
        endTime: time.endTime,
        studentIds: rosterIds,
      }));
    }
    if (plan.planType !== 'session') return [];
    const total = Number(plan.totalSessions || 0);
    if (!Number.isInteger(total) || total < 1) return [];
    const expected = [];
    for (let index = 0; index < total; index += 1) {
      expected.push(this._buildAutoCourseSessionPayload(teamId, plan, index, {
        id: 'auto_session_' + (index + 1),
        studentIds: rosterIds,
      }));
    }
    return expected;
  },

  _buildMissingAutoCourseSessions(teamId, plan, sessions, studentIds) {
    if (!plan) return [];
    const existing = Array.isArray(sessions) ? sessions : [];
    const expected = this._buildExpectedAutoCourseSessions(teamId, plan, studentIds);
    if (plan.planType === 'weekly') {
      const existingByDate = new Map(existing.map(session => [String(session.date || ''), session]).filter(([date]) => date));
      return expected.filter(payload => !existingByDate.has(String(payload.date || '')));
    }
    if (plan.planType !== 'session') return [];
    const bySlot = this._getCourseSessionExistingSlotMap(existing);
    return expected.filter(payload => !bySlot.has(Number(payload.sessionNumber || 0)));
  },

  _buildAutoCourseSessionUpdatePayload(existing, expected) {
    if (!this._isAutoManagedCourseSession(existing)) return null;
    if (this._isCourseSessionFrozenForRoster(existing)) return null;
    const updates = {};
    const same = (a, b) => {
      const normalize = value => (value === undefined || value === '') ? null : value;
      return normalize(a) === normalize(b);
    };
    ['date', 'startTime', 'endTime', 'location', 'capacity'].forEach((key) => {
      if (!same(existing?.[key], expected?.[key])) updates[key] = expected[key] ?? null;
    });
    const currentIds = Array.isArray(existing?.studentIds) ? existing.studentIds.map(String) : [];
    const nextIds = Array.isArray(expected?.studentIds) ? expected.studentIds.map(String) : [];
    if (JSON.stringify(currentIds) !== JSON.stringify(nextIds)) updates.studentIds = nextIds;
    return Object.keys(updates).length ? updates : null;
  },

  async _syncExistingAutoCourseSessionsFromPlan(teamId, plan, sessions, studentIds) {
    if (typeof FirebaseService === 'undefined' || typeof FirebaseService.updateCourseSession !== 'function') return 0;
    const expected = this._buildExpectedAutoCourseSessions(teamId, plan, studentIds);
    if (!expected.length) return 0;
    const existing = Array.isArray(sessions) ? sessions : [];
    const byDate = new Map(existing.map(session => [String(session.date || ''), session]).filter(([date]) => date));
    const bySlot = this._getCourseSessionExistingSlotMap(existing);
    let updated = 0;
    for (const payload of expected) {
      const target = plan?.planType === 'weekly'
        ? byDate.get(String(payload.date || ''))
        : bySlot.get(Number(payload.sessionNumber || 0));
      const sessionId = String(target?.id || target?._docId || '').trim();
      if (!target || !sessionId) continue;
      const updates = this._buildAutoCourseSessionUpdatePayload(target, payload);
      if (!updates) continue;
      await FirebaseService.updateCourseSession(teamId, String(plan.id || plan._docId || ''), sessionId, updates);
      Object.assign(target, updates);
      updated += 1;
    }
    return updated;
  },

  async _ensureCoursePlanSessionsFromPlan(teamId, plan, options = {}) {
    const planId = String(plan?.id || plan?._docId || '').trim();
    if (!teamId || !planId || typeof FirebaseService === 'undefined' || typeof FirebaseService.createCourseSession !== 'function') {
      return { created: 0, sessions: [] };
    }
    const existing = await this._loadCourseSessions(teamId, planId);
    const studentIds = options.includeApprovedRoster === false
      ? []
      : await this._getCoursePlanAutoSessionStudentIds(teamId, { ...plan, id: planId });
    const normalizedPlan = { ...plan, id: planId };
    const updated = await this._syncExistingAutoCourseSessionsFromPlan(teamId, normalizedPlan, existing, studentIds);
    const missing = this._buildMissingAutoCourseSessions(teamId, normalizedPlan, existing, studentIds);
    if (!missing.length) {
      const sessions = [...existing].sort((a, b) => this._getCourseSessionSortValue(a) - this._getCourseSessionSortValue(b));
      this._courseSessionCache[this._getCourseSessionCacheKey(teamId, planId)] = sessions;
      return { created: 0, updated, sessions };
    }
    const created = [];
    for (const payload of missing) {
      created.push(await FirebaseService.createCourseSession(teamId, planId, payload));
    }
    const sessions = [...existing, ...created].sort((a, b) => this._getCourseSessionSortValue(a) - this._getCourseSessionSortValue(b));
    this._courseSessionCache[this._getCourseSessionCacheKey(teamId, planId)] = sessions;
    return { created: created.length, updated, sessions };
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

  _getCourseSessionStaffUserByUidOrName(uidLike, nameLike, users) {
    const normalize = value => String(value || '').trim();
    const uid = normalize(uidLike);
    const name = normalize(nameLike).toLowerCase();
    const userList = Array.isArray(users) ? users : [];
    if (uid) {
      const found = userList.find(user => [user.uid, user.lineUserId, user._docId, user.id]
        .map(normalize)
        .filter(Boolean)
        .includes(uid));
      if (found) return found;
    }
    if (name) {
      return userList.find(user => [user.displayName, user.name, user.nickname]
        .map(value => normalize(value).toLowerCase())
        .some(value => value && value === name)) || null;
    }
    return null;
  },

  _getCourseSessionStaffContact(user) {
    if (!user || typeof user !== 'object') return '';
    const direct = [
      user.contactUrl, user.lineUrl, user.lineLink, user.lineLinkUrl, user.socialUrl, user.website,
      user.phone, user.mobile, user.email,
    ].map(value => String(value || '').trim()).find(Boolean);
    if (direct) return direct;
    const socialLinks = user.socialLinks || {};
    const platformMap = this._socialPlatforms || {
      fb: { prefix: 'https://www.facebook.com/' },
      ig: { prefix: 'https://www.instagram.com/' },
      threads: { prefix: 'https://www.threads.net/@' },
      yt: { prefix: 'https://www.youtube.com/@' },
      twitter: { prefix: 'https://x.com/' },
      line: { prefix: 'https://line.me/ti/p/' },
    };
    for (const key of ['line', 'ig', 'fb', 'threads', 'twitter', 'yt']) {
      const value = String(socialLinks[key] || '').trim();
      if (!value) continue;
      if (/^https?:\/\//i.test(value)) return value;
      const prefix = platformMap[key]?.prefix || '';
      if (prefix) return prefix + encodeURIComponent(value.replace(/^@/, ''));
    }
    return '';
  },

  _getCourseSessionStaffCandidates(teamId) {
    const team = this._getEduTeamRecord(teamId);
    if (!team) return [];
    const users = typeof ApiService !== 'undefined' && ApiService.getAdminUsers ? (ApiService.getAdminUsers() || []) : [];
    const map = new Map();
    const normalize = value => String(value || '').trim();
    const add = (uidLike, nameLike, roleLabel, roleRank) => {
      const user = this._getCourseSessionStaffUserByUidOrName(uidLike, nameLike, users);
      const uid = normalize(user?.uid || user?.lineUserId || uidLike);
      const name = normalize(user?.displayName || user?.name || nameLike || uid);
      if (!name && !uid) return;
      const key = uid ? 'uid:' + uid : 'name:' + name.toLowerCase();
      const existing = map.get(key);
      const candidate = existing || {
        key,
        uid,
        name,
        roleLabel,
        roleRank,
        contact: this._getCourseSessionStaffContact(user),
        searchText: '',
      };
      if (!existing || roleRank > candidate.roleRank) {
        candidate.roleLabel = roleLabel;
        candidate.roleRank = roleRank;
      }
      candidate.searchText = [candidate.name, candidate.uid, candidate.roleLabel]
        .map(value => String(value || '').toLowerCase())
        .join(' ');
      map.set(key, candidate);
    };

    add(team.captainUid, team.captain || team.captainName, '負責人', 3);
    const leaderUids = Array.isArray(team.leaderUids) ? team.leaderUids : (team.leaderUid ? [team.leaderUid] : []);
    const leaderNames = Array.isArray(team.leaderNames) ? team.leaderNames : (Array.isArray(team.leaders) ? team.leaders : (team.leader ? [team.leader] : []));
    leaderUids.forEach((uid, index) => add(uid, leaderNames[index], '領隊', 2));
    leaderNames.forEach(name => add(null, name, '領隊', 2));
    const coachUids = Array.isArray(team.coachUids) ? team.coachUids : [];
    const coachNames = Array.isArray(team.coachNames) ? team.coachNames : (Array.isArray(team.coaches) ? team.coaches : []);
    coachUids.forEach((uid, index) => add(uid, coachNames[index], '教練', 1));
    coachNames.forEach(name => add(null, name, '教練', 1));

    return Array.from(map.values())
      .filter(item => item.roleRank >= 1)
      .sort((a, b) => b.roleRank - a.roleRank || a.name.localeCompare(b.name, 'zh-Hant'));
  },

  _renderCourseSessionStaffSuggestList(kind, results) {
    const container = document.getElementById('edu-session-' + kind + '-suggest');
    if (!container) return;
    if (!results.length) {
      container.innerHTML = '';
      container.classList.remove('show');
      return;
    }
    container.innerHTML = results.map(item => {
      const role = item.roleLabel ? '<span class="tus-uid">' + escapeHTML(item.roleLabel) + '</span>' : '';
      return '<div class="team-user-suggest-item" onmousedown="event.preventDefault();App.selectCourseSessionStaff(\'' + kind + '\',\'' + encodeURIComponent(item.key) + '\')">'
        + '<span class="tus-name">' + escapeHTML(item.name) + '</span>'
        + role
        + '</div>';
    }).join('');
    container.classList.add('show');
  },

  searchCourseSessionStaff(kind) {
    const ctx = this._eduCourseSessionEditContext;
    if (!ctx) return;
    const inputId = kind === 'assistant' ? 'edu-session-assistant-search' : 'edu-session-' + kind;
    const query = document.getElementById(inputId)?.value.trim().toLowerCase() || '';
    const container = document.getElementById('edu-session-' + kind + '-suggest');
    if (!query) {
      if (container) {
        container.innerHTML = '';
        container.classList.remove('show');
      }
      return;
    }
    const candidates = this._getCourseSessionStaffCandidates(ctx.teamId);
    const exclude = kind === 'assistant'
      ? new Set((this._eduCourseSessionAssistantCoaches || []).map(item => item.key || (item.uid ? 'uid:' + item.uid : 'name:' + String(item.name || '').toLowerCase())))
      : new Set();
    const results = candidates
      .filter(item => !exclude.has(item.key) && item.searchText.includes(query))
      .slice(0, 6);
    this._renderCourseSessionStaffSuggestList(kind, results);
  },

  selectCourseSessionStaff(kind, encodedKey) {
    const ctx = this._eduCourseSessionEditContext;
    if (!ctx) return;
    const key = decodeURIComponent(encodedKey || '');
    const candidate = this._getCourseSessionStaffCandidates(ctx.teamId).find(item => item.key === key);
    if (!candidate) return;
    if (kind === 'assistant') {
      this._addCourseSessionAssistantCoach(candidate);
      const input = document.getElementById('edu-session-assistant-search');
      if (input) input.value = '';
    } else {
      const input = document.getElementById('edu-session-' + kind);
      const contact = document.getElementById(kind === 'manager' ? 'edu-session-manager-contact' : 'edu-session-coach-contact');
      if (input) input.value = candidate.name || '';
      if (contact && candidate.contact && !contact.value.trim()) contact.value = candidate.contact;
      this.previewCourseSessionContact?.(kind);
    }
    const container = document.getElementById('edu-session-' + kind + '-suggest');
    if (container) {
      container.innerHTML = '';
      container.classList.remove('show');
    }
  },

  _normalizeCourseSessionAssistantCoaches(value) {
    const list = Array.isArray(value) ? value : [];
    const seen = new Set();
    return list.map(item => {
      if (typeof item === 'string') return { uid: '', name: item.trim(), roleLabel: '助理教練', contact: '' };
      return {
        uid: String(item?.uid || '').trim(),
        name: String(item?.name || item?.displayName || '').trim(),
        roleLabel: String(item?.roleLabel || '助理教練').trim(),
        contact: String(item?.contact || '').trim(),
      };
    }).filter(item => item.name).map(item => {
      const key = item.uid ? 'uid:' + item.uid : 'name:' + item.name.toLowerCase();
      return { ...item, key };
    }).filter(item => {
      if (seen.has(item.key)) return false;
      seen.add(item.key);
      return true;
    }).slice(0, 5);
  },

  _addCourseSessionAssistantCoach(candidate) {
    const list = this._normalizeCourseSessionAssistantCoaches(this._eduCourseSessionAssistantCoaches || []);
    if (list.length >= 5) {
      this.showToast?.('助理教練最多 5 位');
      return;
    }
    const item = {
      uid: String(candidate?.uid || '').trim(),
      name: String(candidate?.name || '').trim(),
      roleLabel: String(candidate?.roleLabel || '助理教練').trim(),
      contact: String(candidate?.contact || '').trim(),
    };
    if (!item.name) return;
    item.key = item.uid ? 'uid:' + item.uid : 'name:' + item.name.toLowerCase();
    if (list.some(existing => existing.key === item.key)) return;
    this._eduCourseSessionAssistantCoaches = [...list, item];
    this._renderCourseSessionAssistantCoachTags?.();
  },

  addCourseSessionAssistantCoachFromInput() {
    const input = document.getElementById('edu-session-assistant-search');
    const name = input?.value.trim() || '';
    if (!name) return;
    const ctx = this._eduCourseSessionEditContext;
    const exact = ctx ? this._getCourseSessionStaffCandidates(ctx.teamId).find(item => item.name === name) : null;
    this._addCourseSessionAssistantCoach(exact || { uid: '', name, roleLabel: '助理教練', contact: '' });
    if (input) input.value = '';
    const container = document.getElementById('edu-session-assistant-suggest');
    if (container) {
      container.innerHTML = '';
      container.classList.remove('show');
    }
  },

  removeCourseSessionAssistantCoach(encodedKey) {
    const key = decodeURIComponent(encodedKey || '');
    this._eduCourseSessionAssistantCoaches = this._normalizeCourseSessionAssistantCoaches(this._eduCourseSessionAssistantCoaches || [])
      .filter(item => item.key !== key);
    this._renderCourseSessionAssistantCoachTags?.();
  },

  _renderCourseSessionAssistantCoachTags() {
    const container = document.getElementById('edu-session-assistant-tags');
    if (!container) return;
    const list = this._normalizeCourseSessionAssistantCoaches(this._eduCourseSessionAssistantCoaches || []);
    if (!list.length) {
      container.innerHTML = '<span class="edu-session-assistant-empty">未加入助理教練</span>';
      return;
    }
    container.innerHTML = list.map(item => '<span class="team-tag edu-session-assistant-tag" data-no-translate>'
      + escapeHTML(item.name)
      + '<small>' + escapeHTML(item.roleLabel || '助理教練') + '</small>'
      + '<span class="team-tag-x" onclick="App.removeCourseSessionAssistantCoach(\'' + encodeURIComponent(item.key) + '\')">×</span>'
      + '</span>').join('');
  },

  _getCourseSessionAssistantCoachPayload() {
    return this._normalizeCourseSessionAssistantCoaches(this._eduCourseSessionAssistantCoaches || [])
      .map(item => ({
        uid: item.uid || '',
        name: item.name || '',
        roleLabel: item.roleLabel || '助理教練',
        contact: item.contact || '',
      }));
  },

  _getCourseSessionStudentInitial(name) {
    const chars = Array.from(String(name || '學員').trim());
    return chars[0] || '學';
  },

  _getCourseSessionStudentLinkedUser(student) {
    if (!student || typeof ApiService === 'undefined' || !ApiService.getUserByUid) return null;
    const ids = [student.selfUid, student.uid, student.lineUserId, student.userId, student.parentUid]
      .map(v => String(v || '').trim())
      .filter(Boolean);
    for (const id of ids) {
      const user = ApiService.getUserByUid(id);
      if (user) return user;
    }
    return null;
  },

  _getCourseSessionStudentProfileMeta(student, name) {
    const linkedUser = this._getCourseSessionStudentLinkedUser(student);
    const displayName = String(
      name
      || student?.displayName
      || student?.name
      || student?.studentName
      || linkedUser?.displayName
      || linkedUser?.name
      || '未命名學員'
    ).trim();
    const uid = [
      student?.selfUid,
      student?.uid,
      student?.lineUserId,
      student?.userId,
      linkedUser?.uid,
      linkedUser?.lineUserId,
      linkedUser?._docId,
      linkedUser?.id,
      student?.parentUid,
    ].map(value => String(value || '').trim()).find(Boolean) || '';
    return { displayName, uid, user: linkedUser };
  },

  _getCourseSessionMemberPillClass(student, name, options = {}) {
    if (options.link === false && options.staticClass) return options.staticClass;
    const meta = this._getCourseSessionStudentProfileMeta(student, name);
    const row = { name: meta.displayName, uid: meta.uid, user: meta.user, isMissingName: !meta.displayName };
    const base = typeof this._getTeamDetailMemberNameClass === 'function'
      ? this._getTeamDetailMemberNameClass(row)
      : 'td-member-name-pill uc-user';
    const classes = [base, 'edu-course-member-pill'];
    if (options.link === false) classes.push('is-static');
    return classes.join(' ');
  },

  _renderCourseSessionMemberPill(student, name, options = {}) {
    const meta = this._getCourseSessionStudentProfileMeta(student, name);
    const displayName = meta.displayName || '未命名學員';
    const className = this._getCourseSessionMemberPillClass(student, displayName, options);
    const profileNameArg = escapeHTML(JSON.stringify(displayName));
    const profileUidArg = meta.uid ? ',{uid:' + escapeHTML(JSON.stringify(meta.uid)) + '}' : '';
    const clickAttr = options.link === false
      ? ''
      : " onclick='event.stopPropagation();App.showUserProfile(" + profileNameArg + profileUidArg + ")'";
    return '<span class="' + escapeHTML(className) + '" data-no-translate' + clickAttr + ' title="' + escapeHTML(displayName) + '">' + escapeHTML(displayName) + '</span>';
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

  _isCourseSessionContactUrlLike(value) {
    const raw = String(value || '').trim();
    if (!raw) return false;
    return /^https?:\/\//i.test(raw)
      || /^www\./i.test(raw)
      || /^[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i.test(raw);
  },

  _normalizeCourseSessionContactUrl(value) {
    if (!this._isCourseSessionContactUrlLike(value)) return '';
    const shared = this._normalizeEventSocialUrl?.(value) || this._normalizeTeamContactUrl?.(value) || '';
    if (shared) return shared;
    const raw = String(value || '').trim();
    const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
    try {
      const url = new URL(withProtocol);
      if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
      url.hash = '';
      return url.href;
    } catch (_) {
      return '';
    }
  },

  _detectCourseSessionContactPlatform(value) {
    const normalized = this._normalizeCourseSessionContactUrl(value);
    let host = '';
    try {
      host = normalized ? new URL(normalized).hostname.toLowerCase().replace(/^www\./, '') : '';
    } catch (_) {}
    const matches = (...domains) => domains.some(domain => host === domain || host.endsWith(`.${domain}`));
    if (matches('line.me', 'lin.ee')) return { key: 'line', label: 'LINE', icon: 'LINE', host };
    if (matches('facebook.com', 'fb.com', 'messenger.com', 'm.me')) return { key: 'facebook', label: 'Facebook', icon: 'f', host };
    if (matches('instagram.com')) return { key: 'instagram', label: 'Instagram', icon: 'IG', host };
    if (matches('threads.net', 'threads.com')) return { key: 'threads', label: 'Threads', icon: '@', host };
    if (matches('x.com', 'twitter.com')) return { key: 'x', label: 'X', icon: 'X', host };
    if (matches('youtube.com', 'youtu.be')) return { key: 'youtube', label: 'YouTube', icon: '▶', host };
    if (matches('tiktok.com')) return { key: 'tiktok', label: 'TikTok', icon: '♪', host };
    if (matches('discord.gg', 'discord.com')) return { key: 'discord', label: 'Discord', icon: 'D', host };
    if (matches('telegram.org', 'telegram.me', 't.me')) return { key: 'telegram', label: 'Telegram', icon: 'TG', host };
    if (matches('linktr.ee', 'linktree.com')) return { key: 'linktree', label: 'Linktree', icon: 'LT', host };
    return { key: 'link', label: host || '連結', icon: '↗', host };
  },

  _renderCourseSessionContactIcon(meta) {
    const key = meta?.key || 'link';
    const iconClass = `event-social-link-icon event-social-link-icon-${escapeHTML(key)}`;
    const imageIcons = {
      instagram: 'img/Instagram-Logo--Streamline-Plump-Gradient.png',
      threads: 'img/Thread-Block-Logo--Streamline-Ultimate.png',
    };
    if (imageIcons[key]) {
      return `<span class="${iconClass}" aria-hidden="true"><img src="${escapeHTML(imageIcons[key])}" alt=""></span>`;
    }
    return `<span class="${iconClass}" aria-hidden="true">${escapeHTML(meta?.icon || '↗')}</span>`;
  },

  _renderCourseSessionContactValue(value) {
    const raw = String(value || '').trim();
    if (!raw) return '<em>未填聯繫方式</em>';
    const normalized = this._normalizeCourseSessionContactUrl(raw);
    if (!normalized) return '<em>' + escapeHTML(raw) + '</em>';
    const meta = this._detectCourseSessionContactPlatform(normalized);
    const linksHtml = '<a class="event-social-link-btn" data-platform="' + escapeHTML(meta.key) + '" href="' + escapeHTML(normalized) + '" target="sporthub_social" rel="noopener noreferrer" aria-label="' + escapeHTML(meta.label) + '" title="' + escapeHTML(meta.label) + '">'
      + this._renderCourseSessionContactIcon(meta)
      + '</a>';
    return '<span class="event-social-link-list edu-session-contact-links">' + linksHtml + '</span>';
  },

  previewCourseSessionContact(kind) {
    const inputId = kind === 'manager' ? 'edu-session-manager-contact' : 'edu-session-coach-contact';
    const previewId = kind === 'manager' ? 'edu-session-manager-contact-preview' : 'edu-session-coach-contact-preview';
    const preview = document.getElementById(previewId);
    if (!preview) return;
    const value = document.getElementById(inputId)?.value.trim() || '';
    if (!value) {
      preview.innerHTML = '<span>輸入網址會自動顯示社群按鈕</span>';
      preview.classList.remove('has-link');
      return;
    }
    const normalized = this._normalizeCourseSessionContactUrl(value);
    if (!normalized) {
      preview.innerHTML = '<span>手動聯繫：' + escapeHTML(value) + '</span>';
      preview.classList.remove('has-link');
      return;
    }
    preview.innerHTML = this._renderCourseSessionContactValue(normalized);
    preview.classList.add('has-link');
  },

  _getCourseSessionMapUrl(location) {
    const text = String(location || '').trim();
    if (!text) return '';
    return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(text);
  },

  _renderCourseSessionContactCard(label, name, contact) {
    return '<div class="edu-session-contact-row">'
      + '<span>' + escapeHTML(label) + '</span>'
      + '<strong>' + escapeHTML(name || '未設定') + '</strong>'
      + this._renderCourseSessionContactValue(contact)
      + '</div>';
  },

  _renderCourseSessionAssistantList(session) {
    const assistants = this._normalizeCourseSessionAssistantCoaches(session?.assistantCoaches || session?.assistantCoachNames || []);
    if (!assistants.length) return '<span class="edu-session-detail-muted">未安排</span>';
    return '<div class="edu-session-detail-assistants">'
      + assistants.map(item => '<span>' + escapeHTML(item.name) + '</span>').join('')
      + '</div>';
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

  _renderCourseSessionRosterNoteCell(student, enrollment, options = {}) {
    const note = String(enrollment?.coachNotes || '').trim();
    const studentId = String(student?.id || student?._docId || enrollment?.studentId || '').trim();
    const enrollId = String(enrollment?.id || '').trim();
    const text = note || '—';
    const editBtn = options.isStaff
      ? '<button type="button" class="edu-session-note-edit" aria-label="編輯備註" title="編輯備註" onclick="event.stopPropagation();App.editCourseSessionRosterNote(\'' + escapeHTML(options.teamId || '') + '\',\'' + escapeHTML(options.planId || '') + '\',\'' + escapeHTML(studentId) + '\',\'' + escapeHTML(enrollId) + '\')"></button>'
      : '';
    if (options.inline) {
      if (!note && !editBtn) return '';
      return '<span class="edu-session-roster-note-inline" aria-label="備註">'
        + (note ? '<span class="edu-session-note-text" title="' + escapeHTML(text) + '">' + escapeHTML(text) + '</span>' : '')
        + editBtn
        + '</span>';
    }
    return '<span class="edu-session-student-slot edu-session-student-slot-note" aria-label="備註">'
      + '<span class="edu-session-note-text" title="' + escapeHTML(text) + '">' + escapeHTML(text) + '</span>'
      + editBtn
      + '</span>';
  },

  _renderCourseSessionStudentTags(student, enrollment, plan, options = {}) {
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
    let html = fields.map(field => '<span class="edu-session-student-slot edu-session-student-slot-' + field.cls + '" aria-label="' + escapeHTML(field.label) + '">'
      + escapeHTML(field.value)
      + '</span>').join('');
    if (options.showNotes) {
      html += this._renderCourseSessionRosterNoteCell(student, enrollment, options);
    }
    return html;
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
        + '<span class="edu-session-list-main edu-session-list-main-pill">'
          + this._renderCourseSessionMemberPill(student, name, { link: true })
          + '<span class="edu-session-student-tags">' + this._renderCourseSessionStudentTags(student, item.enrollment, plan) + '</span>'
        + '</span>'
      + '</div>';
    }).join('');
  },

  async editCourseSessionRosterNote(teamId, planId, studentId, enrollId) {
    if (!this.isEduClubStaff?.(teamId)) {
      this.showToast?.('權限不足');
      return;
    }
    const enrollments = await this._loadCourseEnrollments(teamId, planId);
    const enrollment = enrollments.find(e => String(e.id || '') === String(enrollId || ''))
      || enrollments.find(e => String(e.studentId || '') === String(studentId || '') && e.status !== 'rejected')
      || null;
    const student = (this.getEduStudents(teamId) || []).find(s => String(s.id || s._docId || '') === String(studentId || '')) || {};
    const current = String(enrollment?.coachNotes || '').slice(0, 30);
    const overlay = document.createElement('div');
    overlay.className = 'edu-info-overlay edu-session-note-overlay';
    overlay.onclick = (event) => { if (event.target === overlay) overlay.remove(); };
    overlay.innerHTML = '<div class="edu-info-dialog edu-session-note-dialog">'
      + '<div class="edu-info-dialog-title">編輯學員備註</div>'
      + '<div class="edu-session-note-student">' + escapeHTML(student.name || enrollment?.studentName || '學員') + '</div>'
      + '<textarea id="edu-session-note-input" maxlength="30" rows="2" placeholder="最多 30 字">' + escapeHTML(current) + '</textarea>'
      + '<div class="edu-session-note-count"><span id="edu-session-note-count">' + current.length + '</span>/30</div>'
      + '<div class="modal-actions">'
        + '<button class="outline-btn" onclick="this.closest(\'.edu-info-overlay\').remove()">取消</button>'
        + '<button class="primary-btn" id="edu-session-note-save">儲存備註</button>'
      + '</div>'
      + '</div>';
    document.body.appendChild(overlay);
    const input = document.getElementById('edu-session-note-input');
    const count = document.getElementById('edu-session-note-count');
    input?.addEventListener('input', () => { if (count) count.textContent = String((input.value || '').length); });
    document.getElementById('edu-session-note-save')?.addEventListener('click', async () => {
      const notes = (input?.value || '').trim().slice(0, 30);
      const buttonState = this._setEduBtnLoading('#edu-session-note-save');
      try {
        await this._saveCourseSessionRosterNote(teamId, planId, studentId, enrollId, notes);
        overlay.remove();
        this.showToast?.('備註已更新');
        await this._renderCourseSessionBoard(teamId, planId);
      } catch (err) {
        console.error('[editCourseSessionRosterNote]', err);
        this.showToast?.((err && err.message) || '儲存備註失敗');
      } finally {
        buttonState.restore();
      }
    });
  },

  async _saveCourseSessionRosterNote(teamId, planId, studentId, enrollId, notes) {
    const key = this._getCourseEnrollCacheKey(teamId, planId);
    let enrollments = this._courseEnrollCache[key] || await this._loadCourseEnrollments(teamId, planId);
    let enrollment = enrollments.find(e => String(e.id || '') === String(enrollId || ''))
      || enrollments.find(e => String(e.studentId || '') === String(studentId || '') && e.status !== 'rejected')
      || null;
    const isAuto = enrollment && String(enrollment.id || '').startsWith('_auto_');
    if (!enrollment || isAuto) {
      const canMaterializeAuto = !(typeof isEduAutoMigrationCompleted === 'function'
        && isEduAutoMigrationCompleted());
      if (!canMaterializeAuto) {
        throw new Error('報名資料已完成遷移，請重新整理名單後再操作');
      }
      const student = (this.getEduStudents(teamId) || []).find(s => String(s.id || s._docId || '') === String(studentId || '')) || {};
      const realId = this._generateEduId('enr');
      const doc = {
        id: realId,
        studentId,
        studentName: student.name || enrollment?.studentName || '',
        selfUid: student.selfUid || enrollment?.selfUid || null,
        parentUid: student.parentUid || enrollment?.parentUid || null,
        status: 'approved',
        paidAt: enrollment?.paidAt || null,
        coachNotes: notes,
        reviewerName: enrollment?.reviewerName || null,
        reviewedAt: enrollment?.reviewedAt || null,
      };
      const created = await FirebaseService.createCourseEnrollment(teamId, planId, doc);
      const autoIndex = enrollments.findIndex(e => String(e.id || '') === String(enrollId || ''));
      if (autoIndex >= 0) enrollments[autoIndex] = created;
      else enrollments.push(created);
      this._courseEnrollCache[key] = enrollments;
      return created;
    }
    await FirebaseService.updateCourseEnrollment(teamId, planId, enrollment.id, { coachNotes: notes });
    enrollment.coachNotes = notes;
    return enrollment;
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
      attendRecords.filter(r => (r.kind || 'signin') === 'signin').forEach(r => {
        this._courseAttendanceCount[r.studentId] = (this._courseAttendanceCount[r.studentId] || 0) + 1;
      });
    } catch (_) {}

    const isStaff = this.isEduClubStaff(teamId);
    const roster = this._getCourseApprovedRoster(teamId, plan, enrollments);
    const pendingCount = enrollments.filter(e => e.status === 'pending').length;
    const nextSession = sessions.find(s => this._getCourseSessionSortValue(s) >= Date.now()) || sessions[0] || null;
    const plannedSeats = sessions.reduce((sum, s) => sum + this._getCourseSessionDisplayStudentCount(s, { currentStudentCount: roster.length }), 0);
    const rosterCountText = roster.length + ' 位核准學員' + (pendingCount ? '，' + pendingCount + ' 位待審核' : '');
    const planCover = String(plan?.coverImage || plan?.coverUrl || plan?.imageUrl || plan?.image || '').trim();
    const heroStyle = planCover ? ' style="--edu-session-cover:url(\'' + escapeHTML(planCover) + '\')"' : '';

    const sessionCards = sessions.length
      ? sessions.map((session, idx) => this._renderCourseSessionCard(session, {
          index: idx + 1, teamId, planId, isStaff, currentStudentCount: roster.length,
        })).join('')
      : '<div class="edu-session-empty">'
          + '<strong>尚未建立課堂卡片</strong>'
          + '<span>點擊「新增課堂」後，這裡會以精簡橫式卡片顯示每一堂課的名稱、時間、地點與人數。</span>'
        + '</div>';

    const contactHtml = nextSession
      ? this._renderCourseSessionContactCard('負責人', nextSession.managerName, nextSession.managerContact)
        + this._renderCourseSessionContactCard('執課教練', nextSession.coachName, nextSession.coachContact)
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
        + '<div class="edu-session-section-title"><strong>課堂卡片</strong><span>點卡片查看教練、聯繫、助理與完整課務資訊</span></div>'
        + '<div class="edu-session-list">' + sessionCards + '</div>'
      + '</section>'
      + '<section class="edu-session-roster-panel">'
        + '<div class="edu-session-section-title edu-session-roster-title"><div class="edu-session-roster-title-copy"><strong>方案學員</strong><span>(' + escapeHTML(rosterCountText) + ')</span></div>' + this._renderCourseSessionRosterHeader() + '</div>'
        + '<div class="edu-session-roster">' + (roster.length ? roster.map(item => {
            const student = item.student || {};
            const name = student.name || '未命名學員';
            return '<div class="edu-session-roster-item">'
              + '<span class="edu-session-list-main">'
                + '<span class="edu-session-roster-name-line">' + this._renderCourseSessionMemberPill(student, name, { link: true }) + this._renderCourseSessionRosterNoteCell(student, item.enrollment, { inline: true, isStaff, teamId, planId }) + '</span>'
                + '<span class="edu-session-student-tags edu-session-student-tags-notes">' + this._renderCourseSessionStudentTags(student, item.enrollment, plan, { isStaff, teamId, planId }) + '</span>'
              + '</span>'
            + '</div>';
          }).join('') : '<div class="edu-session-empty-students">尚未有核准學員</div>') + '</div>'
      + '</section>'
      + '</div>';
    this._bindCourseSessionStudentAvatarFallbacks(container);
  },

  async openCourseSessionDetail(teamId, planId, sessionId) {
    const plan = this.getEduCoursePlans(teamId).find(p => p.id === planId);
    const sessions = await this._loadCourseSessions(teamId, planId);
    const session = sessions.find(item => String(item.id || '') === String(sessionId || ''));
    if (!session) {
      this.showToast?.('找不到課堂資料');
      return;
    }
    const enrollments = await this._loadCourseEnrollments(teamId, planId);
    const roster = this._getCourseApprovedRoster(teamId, plan, enrollments);
    const status = this._getCourseSessionStatusMeta(session);
    const capacity = session.capacity ? '/' + session.capacity : '';
    const displayStudentIds = this._getCourseSessionDisplayStudentIds(session, roster);
    const current = this._getCourseSessionDisplayStudentCount(session, { currentStudentCount: displayStudentIds.length });
    const locationValue = String(session.location || '').trim();
    const location = locationValue || '地點未設定';
    const mapUrl = locationValue ? this._getCourseSessionMapUrl(locationValue) : '';
    const mapLink = mapUrl
      ? '<a class="edu-session-location-link edu-session-detail-location-link" href="' + escapeHTML(mapUrl) + '" target="sporthub_map" rel="noopener noreferrer">' + escapeHTML(location) + '</a>'
      : escapeHTML(location);
    const isStaff = this.isEduClubStaff?.(teamId);
    const overlay = document.createElement('div');
    overlay.className = 'edu-info-overlay edu-session-detail-overlay';
    overlay.onclick = (event) => { if (event.target === overlay) overlay.remove(); };
    overlay.innerHTML = '<div class="edu-info-dialog edu-session-detail-dialog">'
      + '<div class="edu-session-detail-head">'
        + '<div class="edu-session-detail-head-main">'
          + '<span class="edu-session-status edu-session-status-' + status.cls + '">' + escapeHTML(status.label) + '</span>'
          + '<h3>' + escapeHTML(session.title || '未命名課堂') + '</h3>'
          + '<p>' + escapeHTML(plan?.name || '課程方案') + '</p>'
        + '</div>'
        + '<div class="edu-session-detail-actions">'
          + (isStaff ? '<button type="button" class="edu-session-icon-btn edu-session-detail-edit" aria-label="編輯課堂" title="編輯課堂" onclick="event.stopPropagation();var overlay=this.closest(\'.edu-info-overlay\');if(overlay)overlay.remove();App.openCourseSessionForm(\'' + escapeHTML(teamId) + '\',\'' + escapeHTML(planId) + '\',\'' + escapeHTML(session.id || '') + '\')"></button>' : '')
          + '<button class="modal-close-btn" onclick="this.closest(\'.edu-info-overlay\').remove()">×</button>'
        + '</div>'
      + '</div>'
      + '<div class="edu-session-detail-grid">'
        + '<div class="edu-session-detail-item"><span>日期時間</span><strong>' + escapeHTML(this._formatCourseSessionDate(session) + ' ' + this._formatCourseSessionTime(session)) + '</strong></div>'
        + '<div class="edu-session-detail-item"><span>上課人數</span><strong>' + current + capacity + ' 人</strong></div>'
        + '<div class="edu-session-detail-item edu-session-detail-wide"><span>地點</span><strong>' + mapLink + '</strong></div>'
        + '<div class="edu-session-detail-item"><span>負責人</span><strong>' + escapeHTML(session.managerName || '未設定') + '</strong>' + this._renderCourseSessionContactValue(session.managerContact) + '</div>'
        + '<div class="edu-session-detail-item"><span>執課教練</span><strong>' + escapeHTML(session.coachName || '未設定') + '</strong>' + this._renderCourseSessionContactValue(session.coachContact) + '</div>'
        + '<div class="edu-session-detail-item edu-session-detail-wide"><span>助理教練</span>' + this._renderCourseSessionAssistantList(session) + '</div>'
        + '<div class="edu-session-detail-item edu-session-detail-wide"><span>課堂重點</span><strong>' + escapeHTML(session.focus || '未填寫') + '</strong></div>'
        + '<div class="edu-session-detail-item edu-session-detail-wide"><span>備註</span><em>' + escapeHTML(session.notes || '未填寫') + '</em></div>'
      + '</div>'
      + '<div class="edu-session-detail-students">'
        + '<div class="edu-session-section-title"><strong>本堂學員</strong><span>' + current + ' 位</span></div>'
        + this._renderCourseSessionStudents(displayStudentIds, roster, plan)
      + '</div>'
      + '</div>';
    document.body.appendChild(overlay);
    this._bindCourseSessionStudentAvatarFallbacks(overlay);
  },

  _renderCourseSessionCard(session, ctx) {
    const status = this._getCourseSessionStatusMeta(session);
    const capacity = session.capacity ? '/' + session.capacity : '';
    const current = this._getCourseSessionDisplayStudentCount(session, { currentStudentCount: ctx.currentStudentCount });
    const locationValue = String(session.location || '').trim();
    const location = locationValue || '地點未設定';
    const mapUrl = locationValue ? this._getCourseSessionMapUrl(locationValue) : '';
    const locationHtml = mapUrl
      ? '<a class="edu-session-location-link" href="' + escapeHTML(mapUrl) + '" target="sporthub_map" rel="noopener noreferrer" onclick="event.stopPropagation()">' + escapeHTML(location) + '</a>'
      : '<em>' + escapeHTML(location) + '</em>';
    const sessionDateTime = this._formatCourseSessionDate(session) + ' ' + this._formatCourseSessionTime(session);
    const actions = ctx.isStaff
      ? '<div class="edu-session-card-actions">'
          + '<button class="outline-btn small edu-session-card-edit" aria-label="編輯課堂" title="編輯課堂" onclick="event.stopPropagation();App.openCourseSessionForm(\'' + ctx.teamId + '\',\'' + ctx.planId + '\',\'' + session.id + '\')">編輯</button>'
          + '<button class="outline-btn small danger edu-session-card-delete" aria-label="刪除課堂" title="刪除課堂" onclick="event.stopPropagation();App.deleteCourseSession(\'' + ctx.teamId + '\',\'' + ctx.planId + '\',\'' + session.id + '\')">刪除</button>'
        + '</div>'
      : '';
    return '<article class="edu-session-card edu-session-card-' + status.cls + '" role="button" tabindex="0" onclick="App.openCourseSessionDetail(\'' + ctx.teamId + '\',\'' + ctx.planId + '\',\'' + session.id + '\')" onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();App.openCourseSessionDetail(\'' + ctx.teamId + '\',\'' + ctx.planId + '\',\'' + session.id + '\')}">'
      + '<div class="edu-session-card-main">'
        + '<div class="edu-session-card-head">'
          + '<span class="edu-session-number">第 ' + ctx.index + ' 堂</span>'
          + '<span class="edu-session-status edu-session-status-' + status.cls + '">' + escapeHTML(status.label) + '</span>'
          + '<h4>' + escapeHTML(session.title || '未命名課堂') + '</h4>'
        + '</div>'
        + '<div class="edu-session-card-line">'
          + '<span><b>時間</b><em>' + escapeHTML(sessionDateTime) + '</em></span>'
          + '<span class="edu-session-card-location"><b>地點</b>' + locationHtml + '</span>'
          + '<span><b>人數</b><em>' + current + capacity + ' 人</em></span>'
        + '</div>'
      + '</div>'
      + actions
      + '</article>';
  },
});
