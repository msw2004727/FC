/* ================================================
   SportHub — Education: Notifications
   ================================================
   簽到成功通知、課前提醒、週/月出席報告
   ================================================ */

Object.assign(App, {

  /**
   * 簽到成功通知家長
   * 從 edu-checkin.js / edu-checkin-scan.js 呼叫
   */
  _notifyEduCheckin(teamId, groupId, records) {
    if (!records || !records.length) return;
    if (typeof this._deliverMessageWithLinePush !== 'function') return;

    const team = ApiService.getTeam(teamId);
    const teamName = team ? team.name : '';
    const groups = this.getEduGroups(teamId);
    const group = groups.find(g => g.id === groupId);
    const groupName = group ? group.name : '';

    records.forEach(record => {
      const targetUid = record.parentUid || record.selfUid;
      if (!targetUid) return;

      // 不通知執行簽到的教練自己
      const curUser = ApiService.getCurrentUser();
      if (curUser && curUser.uid === targetUid) return;

      const title = '簽到成功';
      const body = (record.studentName || '學員') + ' 已在 ' +
        record.date + ' ' + (record.time || '') +
        ' 簽到' + (groupName ? '「' + groupName + '」' : '') +
        (teamName ? '（' + teamName + '）' : '');

      this._deliverMessageWithLinePush(
        title, body,
        'system', '系統',
        targetUid,
        teamName || 'SportHub',
        {
          actionType: 'edu_checkin',
          actionStatus: 'completed',
          meta: {
            teamId,
            groupId,
            studentId: record.studentId,
            studentName: record.studentName,
            date: record.date,
          },
        },
        {
          lineCategory: 'edu_checkin',
          lineTitle: title,
          lineBody: body,
          lineOptions: { source: 'edu_checkin' },
        }
      );
    });
  },

  /**
   * 課前提醒（教練手動觸發或排程）
   */
  sendEduClassReminder(teamId, groupId) {
    if (typeof this._deliverMessageWithLinePush !== 'function') return;

    const team = ApiService.getTeam(teamId);
    const teamName = team ? team.name : '';
    const groups = this.getEduGroups(teamId);
    const group = groups.find(g => g.id === groupId);
    const groupName = group ? group.name : '';
    const schedule = group ? group.schedule : '';

    const students = this.getEduStudents(teamId);
    const groupStudents = students.filter(s =>
      s.enrollStatus === 'active' && (s.groupIds || []).includes(groupId)
    );

    const title = '上課提醒';
    const body = (groupName || '教學班') + '即將上課' +
      (schedule ? '（' + schedule + '）' : '') +
      '，請準時出席！';

    const notifiedUids = new Set();
    groupStudents.forEach(s => {
      const targetUid = s.parentUid || s.selfUid;
      if (!targetUid || notifiedUids.has(targetUid)) return;
      notifiedUids.add(targetUid);

      this._deliverMessageWithLinePush(
        title, body,
        'system', '系統',
        targetUid,
        teamName || 'SportHub',
        {
          actionType: 'edu_reminder',
          actionStatus: 'pending',
          meta: { teamId, groupId, groupName },
        },
        {
          lineCategory: 'edu_reminder',
          lineTitle: title,
          lineBody: body,
          lineOptions: { source: 'edu_reminder' },
        }
      );
    });

    if (typeof this.showToast === 'function') {
      this.showToast('已發送提醒給 ' + notifiedUids.size + ' 位家長/學員');
    }
  },

  /**
   * 出席報告（週/月報）
   */
  async sendEduAttendanceReport(teamId, groupId, periodType) {
    if (typeof this._deliverMessageWithLinePush !== 'function') return;

    const team = ApiService.getTeam(teamId);
    const teamName = team ? team.name : '';
    const groups = this.getEduGroups(teamId);
    const group = groups.find(g => g.id === groupId);
    const groupName = group ? group.name : '';

    const students = this.getEduStudents(teamId);
    const groupStudents = students.filter(s =>
      s.enrollStatus === 'active' && (s.groupIds || []).includes(groupId)
    );

    // 計算期間
    const now = new Date();
    let startDate, periodLabel;
    if (periodType === 'weekly') {
      const weekAgo = new Date(now);
      weekAgo.setDate(weekAgo.getDate() - 7);
      startDate = weekAgo.getFullYear() + '-' + String(weekAgo.getMonth() + 1).padStart(2, '0') + '-' + String(weekAgo.getDate()).padStart(2, '0');
      periodLabel = '本週';
    } else {
      startDate = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-01';
      periodLabel = now.getMonth() + 1 + ' 月';
    }

    // 查詢出席紀錄
    let records = [];
    try {
      records = await FirebaseService.queryEduAttendance({ teamId, groupId });
      records = records.filter(r => r.date >= startDate);
    } catch (_) {}

    const notifiedUids = new Set();
    groupStudents.forEach(s => {
      const targetUid = s.parentUid || s.selfUid;
      if (!targetUid || notifiedUids.has(targetUid)) return;
      notifiedUids.add(targetUid);

      const myRecords = records.filter(r => r.studentId === s.id);
      const title = periodLabel + '出席報告';
      const body = s.name + '在' + periodLabel +
        (groupName ? '「' + groupName + '」' : '') +
        '共出席 ' + myRecords.length + ' 次。' +
        (teamName ? '（' + teamName + '）' : '');

      this._deliverMessageWithLinePush(
        title, body,
        'system', '系統',
        targetUid,
        teamName || 'SportHub',
        {
          actionType: 'edu_report',
          actionStatus: 'completed',
          meta: { teamId, groupId, studentId: s.id, period: periodType, count: myRecords.length },
        },
        {
          lineCategory: 'edu_report',
          lineTitle: title,
          lineBody: body,
          lineOptions: { source: 'edu_report' },
        }
      );
    });

    if (typeof this.showToast === 'function') {
      this.showToast('已發送' + periodLabel + '出席報告');
    }
  },

});
