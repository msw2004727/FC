/* ================================================
   SportHub - Education: Course UI Adapter
   ================================================ */

(function () {
  const FALLBACK_WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'];

  function toText(value) {
    return String(value == null ? '' : value).trim();
  }

  function toArray(value) {
    return Array.isArray(value) ? value.filter(item => item != null && String(item).trim() !== '') : [];
  }

  function isRejectedStatus(value) {
    return toText(value) === 'rejected';
  }

  function todayString() {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function parseDateOnly(value) {
    const raw = toText(value);
    if (!raw) return null;
    const parts = raw.split('-').map(part => parseInt(part, 10));
    if (parts.length !== 3 || parts.some(part => !Number.isFinite(part))) return null;
    return new Date(parts[0], parts[1] - 1, parts[2]);
  }

  function formatDateOnly(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function parseTimeStart(value) {
    const raw = toText(value);
    const match = raw.match(/(\d{1,2}):(\d{2})/);
    if (!match) return '';
    return `${match[1].padStart(2, '0')}:${match[2]}`;
  }

  function isSafeRenderableUrl(value) {
    const raw = toText(value);
    if (!raw) return '';
    if (/^data:image\/(?:png|jpe?g|webp|gif);base64,/i.test(raw)) return raw;
    if (/^blob:/i.test(raw)) return raw;
    if (/^https?:\/\//i.test(raw)) return raw;
    if (/^(?:\.{0,2}\/)?[A-Za-z0-9_./%#?=&:+-]+$/i.test(raw) && !/javascript:/i.test(raw)) return raw;
    return '';
  }

  Object.assign(App, {
    _isTeamCourseUiV2Enabled() {
      if (typeof isTeamCourseUiV2Enabled === 'function') return !!isTeamCourseUiV2Enabled();
      return true;
    },

    _isCoursePlanEnded(plan, today = todayString()) {
      return !!(plan && plan.endDate && String(plan.endDate) < today);
    },

    _getCoursePlanCoverUrl(plan) {
      const candidates = [
        plan?.coverImage,
        plan?.coverUrl,
        plan?.imageUrl,
        plan?.image,
        plan?.imageVariants?.cover,
        plan?.imageVariants?.homeNext,
      ];
      for (const candidate of candidates) {
        const safe = isSafeRenderableUrl(candidate);
        if (safe) return safe;
      }
      return '';
    },

    _hasCoursePlanPriceValue(value) {
      if (value === null || value === undefined) return false;
      return String(value).trim() !== '';
    },

    _formatCoursePlanPrice(value) {
      if (!this._hasCoursePlanPriceValue(value)) return '';
      const amount = Number(value);
      if (!Number.isFinite(amount) || amount < 0) return '';
      return amount === 0 ? '免費' : `NT$ ${amount.toLocaleString()}`;
    },

    _getCoursePlanScheduleText(plan) {
      if (!plan) return '未設定';
      if (plan.planType === 'weekly') {
        const labels = toArray(plan.weekdays).map(day => {
          if (typeof this._weekdayLabel === 'function') return `週${this._weekdayLabel(day)}`;
          return `週${FALLBACK_WEEKDAY_LABELS[Number(day)] || day}`;
        });
        return `${labels.join('、') || '未設定'}${plan.timeSlot ? ` ${plan.timeSlot}` : ''}`.trim();
      }
      return `共 ${Number(plan.totalSessions || 0)} 堂`;
    },

    _getCoursePlanDateText(plan) {
      if (!plan?.startDate && !plan?.endDate) return '未設定';
      return `${plan.startDate || '未設定'} ~ ${plan.endDate || ''}`.trim();
    },

    _getCoursePlanStatusMeta(plan, today = todayString()) {
      if (this._isCoursePlanEnded(plan, today)) {
        return { key: 'ended', label: '已結束', className: 'edu-cp-status-ended' };
      }
      if (plan?.allowSignup) {
        return { key: 'open', label: '開放報名', className: 'edu-cp-status-open' };
      }
      return { key: 'closed', label: '暫停報名', className: 'edu-cp-status-closed' };
    },

    _isUserEnrolledInCoursePlan(plan, uid, teamId) {
      const viewerUid = toText(uid);
      if (!plan || !viewerUid) return false;
      const students = typeof this.getEduStudents === 'function' ? this.getEduStudents(teamId) : [];
      const myStudents = toArray(students).filter(student =>
        toText(student.selfUid) === viewerUid || toText(student.parentUid) === viewerUid
      );
      if (!myStudents.length) return false;

      const myStudentIds = new Set(myStudents.map(student => toText(student.id || student._docId)).filter(Boolean));
      const enrollments = toArray(plan._enrollments);
      if (enrollments.some(enrollment =>
        myStudentIds.has(toText(enrollment.studentId)) && !isRejectedStatus(enrollment.status)
      )) {
        return true;
      }

      const groupId = toText(plan.groupId);
      if (!groupId) return false;
      return myStudents.some(student =>
        toText(student.enrollStatus || 'active') === 'active'
        && toArray(student.groupIds).map(toText).includes(groupId)
      );
    },

    _isCoursePlanVisibleToUser(plan, context = {}) {
      if (!plan) return false;
      if (context.isStaff) return true;
      if (plan.visibleOnTeamPage !== false) return true;
      return this._isUserEnrolledInCoursePlan(plan, context.uid, context.teamId);
    },

    _normalizeCoursePlanViewModel(plan = {}, context = {}) {
      const effectiveCount = Number(plan._effectiveCount || context.effectiveCount || 0);
      const maxCapacity = Number(plan.maxCapacity || 0);
      return {
        id: toText(plan.id || plan._docId),
        name: toText(plan.name) || '未命名課程',
        planType: plan.planType === 'session' ? 'session' : 'weekly',
        typeLabel: plan.planType === 'session' ? '堂數課' : '每週課',
        groupName: toText(plan.groupName) || '未分組',
        coverUrl: this._getCoursePlanCoverUrl(plan),
        dateText: this._getCoursePlanDateText(plan),
        scheduleText: this._getCoursePlanScheduleText(plan),
        priceText: this._formatCoursePlanPrice(plan.price),
        countText: `${effectiveCount}${maxCapacity ? `/${maxCapacity}` : ''} 人`,
        status: this._getCoursePlanStatusMeta(plan, context.today),
        tags: [
          ...toArray(plan.categoryTags),
          ...toArray(plan.featureTags),
        ].slice(0, 6).map(toText),
        raw: plan,
      };
    },

    _getCoursePlanDisplayBuckets(plans = [], selectedTab = 'active', today = todayString()) {
      const activePlans = toArray(plans).filter(plan => plan.active !== false);
      const currentPlans = activePlans.filter(plan => !this._isCoursePlanEnded(plan, today));
      const endedPlans = activePlans.filter(plan => this._isCoursePlanEnded(plan, today));
      const visiblePlans = selectedTab === 'ended' ? endedPlans : currentPlans;
      return {
        currentPlans,
        endedPlans,
        visiblePlans,
        groupedPlans: [
          { type: 'weekly', plans: visiblePlans.filter(plan => plan.planType === 'weekly') },
          { type: 'session', plans: visiblePlans.filter(plan => plan.planType !== 'weekly') },
        ].filter(group => group.plans.length > 0),
      };
    },

    _getCoursePlanNextWeeklyOccurrence(plan, now = new Date()) {
      if (!plan || plan.planType !== 'weekly') return null;
      const weekdays = toArray(plan.weekdays).map(day => Number(day)).filter(day => Number.isInteger(day) && day >= 0 && day <= 6);
      if (!weekdays.length || !plan.startDate || !plan.endDate) return null;
      const startDate = parseDateOnly(plan.startDate);
      const endDate = parseDateOnly(plan.endDate);
      if (!startDate || !endDate) return null;
      const firstCandidate = new Date(Math.max(startDate.getTime(), new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()));
      const startTime = parseTimeStart(plan.timeSlot);
      for (let offset = 0; offset <= 370; offset += 1) {
        const candidate = new Date(firstCandidate);
        candidate.setDate(firstCandidate.getDate() + offset);
        if (candidate > endDate) break;
        if (!weekdays.includes(candidate.getDay())) continue;
        const candidateDate = formatDateOnly(candidate);
        const candidateMs = startTime ? new Date(`${candidateDate}T${startTime}`).getTime() : candidate.getTime();
        if (Number.isFinite(candidateMs) && candidateMs >= now.getTime()) {
          return { date: candidateDate, startTime, timestamp: candidateMs, label: `${candidateDate}${startTime ? ` ${startTime}` : ''}` };
        }
      }
      return null;
    },
  });
})();
