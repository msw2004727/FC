/* ================================================
   SportHub — Team: Form Validation & Value Extraction
   從 team-form.js 抽出（Phase 4 §10.1）
   依賴：config.js, api-service.js, team-form.js (_teamFormState)
   ================================================ */

Object.assign(App, {

  /**
   * 從表單提取所有欄位值並執行驗證。
   * @returns {Object|null} 提取後的值物件，驗證失敗時回傳 null（已顯示 toast）。
   */
  _extractTeamFormValues() {
    const name = document.getElementById('ct-team-name').value.trim();
    const nameEn = document.getElementById('ct-team-name-en').value.trim();
    const nationality = document.getElementById('ct-team-nationality').value;
    const region = document.getElementById('ct-team-region').value.trim();
    const founded = document.getElementById('ct-team-founded').value;
    const contact = document.getElementById('ct-team-contact').value.trim();
    const contactLinksData = this._getTeamContactLinksFormData?.({ validate: true }) || { enabled: false, links: [] };
    const bio = document.getElementById('ct-team-bio').value.trim();

    if (!name) { this.showToast('請輸入俱樂部名稱'); return null; }
    if (!document.getElementById('ct-team-sport-tag')?.value) { this.showToast('請選擇運動類型'); return null; }
    // 2026-04-25：地區必填、且必須在清單內（22 縣市 + 「其他」、強制下拉選單）
    if (!region) { this.showToast('請選擇地區'); return null; }
    const _validRegions = (typeof TW_REGIONS_WITH_OTHER !== 'undefined' && Array.isArray(TW_REGIONS_WITH_OTHER)) ? TW_REGIONS_WITH_OTHER : [];
    if (_validRegions.length > 0 && !_validRegions.includes(region)) {
      this.showToast('地區必須從清單選擇');
      return null;
    }

    // ── 記錄舊職位（編輯模式用於降級檢查）──
    if (contactLinksData.error) {
      this.showToast(contactLinksData.error);
      return null;
    }

    let oldCaptainUid = null;
    let oldCoachUids = [];
    let oldLeaderUids = [];
    let oldTeam = null;
    if (this._teamFormState.editId) {
      oldTeam = ApiService.getTeam(this._teamFormState.editId);
      if (oldTeam) {
        oldCaptainUid = oldTeam.captainUid || null;
        oldCoachUids = (Array.isArray(oldTeam.coachUids) ? oldTeam.coachUids : []).filter(Boolean);
        oldLeaderUids = (oldTeam.leaderUids || (oldTeam.leaderUid ? [oldTeam.leaderUid] : [])).filter(Boolean);
      }
    }

    const users = ApiService.getUserDirectory?.() || [];
    const unresolvedStaffNames = this._teamFormState.unresolvedStaffNames || { leaders: [], captain: '', coaches: [] };
    const mergeUniqueNames = (...groups) => {
      const seen = new Set();
      const result = [];
      groups.flat().forEach(name => {
        const value = String(name || '').trim();
        const key = value.toLowerCase();
        if (!value || seen.has(key)) return;
        seen.add(key);
        result.push(value);
      });
      return result;
    };

    // 驗證領隊（新建：至少一位且非 legacy；編輯：允許保留）
    if (!this._teamFormState.editId && this._teamFormState.leaders.length === 0) {
      this.showToast('請選擇至少一位俱樂部領隊');
      return null;
    }
    const realLeaderUids = [...this._teamFormState.leaders];
    if (!this._teamFormState.editId && realLeaderUids.length === 0) {
      this.showToast('俱樂部領隊必須為有效用戶，請重新選擇');
      return null;
    }

    // 解析領隊名稱
    const resolvedLeaderNames = this._teamFormState.leaders.map(uid => {
      const u = users.find(user => user.uid === uid || user._docId === uid);
      return u?.name || u?.displayName || this._getTeamFormStaffDisplayName?.(uid) || '';
    }).filter(Boolean);
    const leaderNames = mergeUniqueNames(resolvedLeaderNames, unresolvedStaffNames.leaders || []);

    // Resolve team manager (captain) name
    let captain = '';
    let selectedCaptainUser = null;
    if (this._teamFormState.captain) {
      selectedCaptainUser = users.find(user => user.uid === this._teamFormState.captain || user._docId === this._teamFormState.captain);
      captain = selectedCaptainUser?.name
        || selectedCaptainUser?.displayName
        || this._getTeamFormStaffDisplayName?.(this._teamFormState.captain)
        || '';
    }
    if (!captain) captain = String(unresolvedStaffNames.captain || '').trim();

    if (!this._teamFormState.editId) {
      if (!this._teamFormState.captain) {
        this.showToast('請設定俱樂部經理（必填）');
        return null;
      }
      if (!selectedCaptainUser) {
        this.showToast('俱樂部經理必須為有效用戶，請重新選擇');
        return null;
      }
    } else if (this._teamFormState.captain && !selectedCaptainUser && !captain) {
      this.showToast('俱樂部經理資料無效，請重新選擇俱樂部經理');
      return null;
    }

    const captainUidForSave = this._teamFormState.captain || null;

    // Resolve coach names
    const resolvedCoachNames = this._teamFormState.coaches.map(uid => {
      const u = users.find(user => user.uid === uid || user._docId === uid);
      return u?.name || u?.displayName || this._getTeamFormStaffDisplayName?.(uid) || '';
    }).filter(Boolean);
    const coaches = mergeUniqueNames(resolvedCoachNames, unresolvedStaffNames.coaches || []);

    const newCoachUids = [...this._teamFormState.coaches];

    return {
      name, nameEn, nationality, region, founded, contact, bio,
      contactLinksEnabled: !!contactLinksData.enabled, contactLinks: contactLinksData.links || [],
      oldCaptainUid, oldCoachUids, oldLeaderUids,
      realLeaderUids, leaderNames, captain, selectedCaptainUser,
      captainUidForSave, coaches, newCoachUids, users,
    };
  },

});
