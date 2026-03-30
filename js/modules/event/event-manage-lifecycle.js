/* === SportHub — Activity CRUD operations ===
   依賴：event-manage.js (shared helpers)
   ============================================ */

Object.assign(App, {

  _cancelActivityBusyMap: Object.create(null),

  editExternalActivity(id) {
    const e = ApiService.getEvent(id);
    if (!e || e.type !== 'external') return;
    if (!this._canManageEvent(e)) { this.showToast('您只能編輯自己的活動'); return; }
    this.openCreateExternalEventModal(id);
  },

  editMyActivity(id) {
    const e = ApiService.getEvent(id);
    if (!e) return;
    if (!this._canManageEvent(e)) { this.showToast('您只能編輯自己的活動'); return; }
    // 外部活動走專用編輯流程
    if (e.type === 'external') { this.editExternalActivity(id); return; }
    this._editEventId = id;
    // 確保事件已綁定（防止 Phase 1 非同步時機導致未綁定）
    this.bindImageUpload('ce-image', 'ce-upload-preview');
    this.bindTeamOnlyToggle();
    this.bindEventFeeToggle?.();
    this.bindGenderRestrictionToggle?.();
    this.bindPrivateEventToggle?.();
    this.showModal('create-event-modal');
    this._eventSubmitInFlight = false;
    this._setCreateEventSubmitIdleLabel('儲存修改');
    document.getElementById('ce-title').value = e.title || '';
    document.getElementById('ce-type').value = e.type || 'friendly';
    document.getElementById('ce-location').value = e.location || '';
    // 解析儲存格式 YYYY/MM/DD HH:mm~HH:mm → datetime-local
    const dateTime = (e.date || '').split(' ');
    const dateParts = (dateTime[0] || '').split('/');
    const timeStr = dateTime[1] || '';
    const timeParts = timeStr.split('~');
    if (dateParts.length === 3) {
      document.getElementById('ce-date').value = `${dateParts[0]}-${dateParts[1].padStart(2,'0')}-${dateParts[2].padStart(2,'0')}`;
    }
    const ceTS = document.getElementById('ce-time-start');
    const ceTE = document.getElementById('ce-time-end');
    if (ceTS) ceTS.value = timeParts[0] || '14:00';
    if (ceTE) ceTE.value = timeParts[1] || '16:00';
    this._setEventFeeFormState?.(
      this._isEventFeeEnabled?.(e) ?? Number(e?.fee || 0) > 0,
      Number(e?.fee || 0) > 0 ? e.fee : 0
    );
    document.getElementById('ce-max').value = e.max || 20;
    document.getElementById('ce-waitlist').value = 0;
    document.getElementById('ce-min-age').value = e.minAge || 0;
    document.getElementById('ce-notes').value = e.notes || '';
    this._initSportTagPicker(e.sportTag || 'football');
    this._setGenderRestrictionState?.(!!e.genderRestrictionEnabled, e.allowedGender || '');
    this._setPrivateEventState?.(!!e.privateEvent);
    // 開放報名時間
    this._setEventRegOpenTimeValue?.(e.regOpenTime || '');
    // 俱樂部限定
    const ceTeamOnly = document.getElementById('ce-team-only');
    if (ceTeamOnly) {
      ceTeamOnly.checked = !!e.teamOnly;
      // 編輯模式：若為俱樂部限定且建立者無俱樂部，需先填充下拉再還原選擇
      if (e.teamOnly) {
        const ceTeamSelect = document.getElementById('ce-team-select');
        if (ceTeamSelect) {
          const presetTeamIds = (Array.isArray(e.creatorTeamIds) && e.creatorTeamIds.length > 0)
            ? e.creatorTeamIds
            : (e.creatorTeamId ? [e.creatorTeamId] : []);
          const presetTeamNames = (Array.isArray(e.creatorTeamNames) && e.creatorTeamNames.length > 0)
            ? e.creatorTeamNames
            : (e.creatorTeamName ? [e.creatorTeamName] : []);
          this._populateTeamSelect(ceTeamSelect, presetTeamIds, presetTeamNames);
        }
      }
      this._updateTeamOnlyLabel();
    }
    const preview = document.getElementById('ce-upload-preview');
    if (e.image && preview) {
      preview.innerHTML = `<img src="${e.image}" style="width:100%;height:100%;object-fit:cover;border-radius:var(--radius-sm)">`;
      preview.classList.add('has-image');
    }
    // 委託人預填
    this._delegates = Array.isArray(e.delegates) ? [...e.delegates] : [];
    this._initDelegateSearch();
  },

  // ── 結束活動 ──
  async closeMyActivity(id) {
    const e = ApiService.getEvent(id);
    if (e && !this._canManageEvent(e)) { this.showToast('您只能管理自己的活動'); return; }
    if (!await this.appConfirm('確定要結束此活動？')) return;
    ApiService.updateEvent(id, { status: 'ended' });
    ApiService._writeOpLog('event_end', '結束活動', `結束「${e.title}」`);
    this.renderMyActivities();
    this.renderActivityList();
    this.renderHotEvents();
    this.showToast('活動已結束');
  },

  // ── 取消活動 ──
  async cancelMyActivity(id) {
    if (this._cancelActivityBusyMap[id]) return;

    const e = ApiService.getEvent(id);
    if (!e) return;
    if (e && !this._canManageEvent(e)) { this.showToast('您只能管理自己的活動'); return; }
    this._cancelActivityBusyMap[id] = true;
    try {
      if (!await this.appConfirm('確定要取消此活動？')) return;

      // Trigger 4：活動取消通知 — 通知所有報名者與候補者
      const notifyUids = this._collectEventNotifyRecipientUids(e, id);
      notifyUids.forEach(uid => {
        this._sendNotifFromTemplate('event_cancelled', {
          eventName: e.title, date: e.date, location: e.location,
        }, uid, 'activity', '活動');
      });

      ApiService.updateEvent(id, { status: 'cancelled' });
      // 活動被取消 → 刪除所有個人取消紀錄
      await this._cleanupCancelledRecords(id);
      ApiService._writeOpLog('event_cancel', '取消活動', `取消「${e.title}」`);
      this.renderMyActivities();
      this.renderActivityList();
      this.renderHotEvents();
      this.showToast('活動已取消');
    } finally {
      delete this._cancelActivityBusyMap[id];
    }
  },

  // ── 重新開放（已取消 → open/full） ──
  async reopenMyActivity(id) {
    const e = ApiService.getEvent(id);
    if (!e) return;
    if (!this._canManageEvent(e)) { this.showToast('您只能管理自己的活動'); return; }

    // 檢查活動時間是否在未來
    const startDate = this._parseEventStartDate(e.date);
    if (startDate && startDate <= new Date()) {
      await this.appConfirm('活動時間已過，請先編輯活動並更新時間後再重新開放。');
      return;
    }

    if (!await this.appConfirm('確定要重新開放此活動？')) return;

    const newStatus = this._isEventTrulyFull(e) ? 'full' : 'open';
    ApiService.updateEvent(id, { status: newStatus });
    ApiService._writeOpLog('event_reopen', '重開活動', `重開「${e.title}」`);
    this.renderMyActivities();
    this.renderActivityList();
    this.renderHotEvents();
    this.showToast('活動已重新開放');
  },

  // ── 重新上架（已結束 → open/full） ──
  async relistMyActivity(id) {
    const e = ApiService.getEvent(id);
    if (!e) return;
    if (!this._canManageEvent(e)) { this.showToast('您只能管理自己的活動'); return; }

    // 檢查活動時間是否在未來
    const startDate = this._parseEventStartDate(e.date);
    if (startDate && startDate <= new Date()) {
      await this.appConfirm('活動時間已過，請先編輯活動並更新時間後再上架。');
      return;
    }

    if (!await this.appConfirm('確定要重新上架此活動？\n報名名單與候補名單將會保留。')) return;

    const newStatus = this._isEventTrulyFull(e) ? 'full' : 'open';
    ApiService.updateEvent(id, { status: newStatus });
    ApiService._writeOpLog('event_relist', '重新上架', `重新上架「${e.title}」`);

    // 通知已報名的用戶
    const notifyUids = this._collectEventNotifyRecipientUids(e, id);
    notifyUids.forEach(uid => {
      this._sendNotifFromTemplate('event_relisted', {
        eventName: e.title, date: e.date, location: e.location,
      }, uid, 'activity', '活動');
    });

    this.renderMyActivities();
    this.renderActivityList();
    this.renderHotEvents();
    this.showToast('活動已重新上架');
  },

  /** 清理某活動的所有個人取消紀錄（活動被刪除或取消時呼叫） */
  async _cleanupCancelledRecords(eventId) {
    if (!await this._ensureActivityRecordsReady()) return;
    const source = ApiService._src('activityRecords');
    for (let i = source.length - 1; i >= 0; i--) {
      if (source[i].eventId === eventId && source[i].status === 'cancelled') {
        if (!ModeManager.isDemo() && source[i]._docId) {
          db.collection('activityRecords').doc(source[i]._docId).delete()
            .catch(err => console.error('[cleanupCancelledRecords]', err));
        }
        source.splice(i, 1);
      }
    }
  },

  // ── 管理者移除參加者 ──
  async _removeParticipant(eventId, uid, name, isCompanion) {
    if (!await this.appConfirm(`確定要將 ${name} 從報名名單中移除嗎？`)) return;

    const event = ApiService.getEvent(eventId);
    if (!event) return;

    const useCF = typeof shouldUseServerRegistration === 'function' && shouldUseServerRegistration();

    if (useCF && !ModeManager.isDemo()) {
      // ═══ CF 路徑：呼叫 cancelRegistration（reason='manager_remove'）═══
      try {
        // 找到對應的 registration ID
        const allRegs = ApiService._src('registrations');
        let reg;
        if (isCompanion) {
          reg = allRegs.find(r => r.eventId === eventId && r.companionId === uid && r.status !== 'cancelled' && r.status !== 'removed');
        } else {
          reg = allRegs.find(r => r.eventId === eventId && r.userId === uid && r.participantType !== 'companion' && r.status !== 'cancelled' && r.status !== 'removed');
        }
        if (!reg) { this.showToast('找不到對應的報名紀錄'); return; }

        const _removeTimeout = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('移除操作逾時，請重新整理後再試')), 15000));
        const cfResult = await Promise.race([
          firebase.app().functions('asia-east1').httpsCallable('cancelRegistration')({
            eventId,
            registrationIds: [reg.id],
            reason: 'manager_remove',
            requestId: `remove_${uid}_${eventId}_${Date.now()}`,
          }),
          _removeTimeout,
        ]);
        const data = cfResult.data;
        // 樂觀更新本地快取
        reg.status = 'removed';
        reg.removedAt = new Date().toISOString();
        if (data.event && event) {
          event.current = data.event.current;
          event.waitlist = data.event.waitlist;
          event.participants = data.event.participants;
          event.waitlistNames = data.event.waitlistNames;
          event.status = data.event.status;
        }
        FirebaseService._saveToLS?.('registrations', FirebaseService._cache?.registrations);
        FirebaseService._saveToLS?.('events', FirebaseService._cache?.events);
      } catch (err) {
        console.error('[removeParticipant CF]', err);
        const cfMsg = {
          ALREADY_CANCELLED: '已取消此報名',
          REG_NOT_FOUND: '找不到報名紀錄',
          EVENT_NOT_FOUND: '活動不存在',
          PERMISSION_DENIED: '無權限執行此操作',
        };
        const errCode = err?.details || err?.message || '';
        const isNetworkOrTimeout = /timeout|network|fetch|ECONNREFUSED|逾時/i.test(err?.message || '');
        this.showToast('移除失敗：' + (cfMsg[errCode] || (isNetworkOrTimeout ? '連線逾時，請檢查網路後重新整理再試' : err.message || '')));
        return;
      }
    } else {
      // ═══ 原有路徑（fallback）═══
      if (!isCompanion && !await this._ensureActivityRecordsReady({ required: true })) return;

      const allRegs = ApiService._src('registrations');
      const batch = (!ModeManager.isDemo() && typeof db !== 'undefined') ? db.batch() : null;

      let reg;
      if (isCompanion) {
        reg = allRegs.find(r => r.eventId === eventId && r.companionId === uid && r.status !== 'cancelled' && r.status !== 'removed');
      } else {
        reg = allRegs.find(r => r.eventId === eventId && r.userId === uid && r.participantType !== 'companion' && r.status !== 'cancelled' && r.status !== 'removed');
      }

      const wasConfirmed = reg ? reg.status === 'confirmed' : false;

      if (reg) {
        reg.status = 'removed';
        reg.removedAt = new Date().toISOString();
        if (batch && reg._docId) {
          batch.update(db.collection('registrations').doc(reg._docId), {
            status: 'removed',
            removedAt: firebase.firestore.FieldValue.serverTimestamp(),
          });
        }
      }

      if (!isCompanion) {
        const arSource = ApiService._src('activityRecords');
        const ar = arSource.find(a => a.eventId === eventId && a.uid === uid && a.status !== 'cancelled' && a.status !== 'removed');
        if (ar) {
          ar.status = 'removed';
          if (batch && ar._docId) {
            batch.update(db.collection('activityRecords').doc(ar._docId), { status: 'removed' });
          }
        }
      }

      if (wasConfirmed) {
        const activeRegs = allRegs.filter(
          r => r.eventId === eventId && (r.status === 'confirmed' || r.status === 'waitlisted')
        );
        const confirmedCount = activeRegs.filter(r => r.status === 'confirmed').length;
        let slotsAvailable = (event.max || 0) - confirmedCount;

        while (slotsAvailable > 0) {
          const candidate = this._getNextWaitlistCandidate(eventId);
          if (!candidate) break;
          this._promoteSingleCandidateLocal(event, candidate);
          if (batch && candidate._docId) {
            batch.update(db.collection('registrations').doc(candidate._docId), { status: 'confirmed' });
          }
          const arDocIds = this._getPromotedArDocIds(event, candidate);
          if (batch) {
            arDocIds.forEach(docId => batch.update(db.collection('activityRecords').doc(docId), { status: 'registered' }));
          }
          slotsAvailable--;
        }
      }

      const activeAfterRemoval = allRegs.filter(
        r => r.eventId === eventId && (r.status === 'confirmed' || r.status === 'waitlisted')
      );
      if (typeof FirebaseService !== 'undefined' && typeof FirebaseService._rebuildOccupancy === 'function') {
        const occupancy = FirebaseService._rebuildOccupancy(event, activeAfterRemoval);
        FirebaseService._applyRebuildOccupancy(event, occupancy);
      }

      if (batch && event._docId) {
        batch.update(db.collection('events').doc(event._docId), {
          current: event.current, waitlist: event.waitlist,
          participants: event.participants || [], waitlistNames: event.waitlistNames || [],
          status: event.status,
        });
        try {
          await batch.commit();
        } catch (err) {
          console.error('[removeParticipant] batch commit failed:', err);
          this.showToast('移除同步失敗，請重試');
          return;
        }
      }
      if (typeof FirebaseService !== 'undefined' && typeof FirebaseService._saveToLS === 'function') {
        FirebaseService._saveToLS('registrations', FirebaseService._cache.registrations);
        FirebaseService._saveToLS('events', FirebaseService._cache.events);
      }
    }

    ApiService._writeOpLog('participant_removed', '移除參加者', `從「${event.title}」移除 ${name}`);

    this._manualEditingUid = null;
    this._manualEditingEventId = null;
    this._renderAttendanceTable(eventId, this._manualEditingContainerId);
    this.showToast(`已將 ${name} 從報名名單中移除`);
  },

  // ── 刪除活動 ──
  async deleteMyActivity(id) {
    if (!this.hasPermission('event.delete') && !this.hasPermission('activity.manage.entry')) { this.showToast('權限不足'); return; }
    const e = ApiService.getEvent(id);
    if (e && !this._canManageEvent(e)) { this.showToast('您只能管理自己的活動'); return; }
    if (!(await this.appConfirm('確定要刪除此活動？刪除後無法恢復。'))) return;
    const title = e.title;
    let deleted = false;
    try {
      deleted = await ApiService.deleteEvent(id);
    } catch (err) {
      console.error('[deleteMyActivity]', err);
      this.showToast('刪除失敗，請稍後再試');
      return;
    }
    if (!deleted) {
      this.showToast('刪除失敗，請重新整理後再試');
      return;
    }
    // 活動被刪除 → 刪除所有個人取消紀錄
    await this._cleanupCancelledRecords(id);
    ApiService._writeOpLog('event_delete', '刪除活動', `刪除「${title}」`);
    this.renderMyActivities();
    this.renderActivityList();
    this.renderHotEvents();
    this.showToast('活動已刪除');
  },

});
