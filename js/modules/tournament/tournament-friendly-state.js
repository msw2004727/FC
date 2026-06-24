/* ================================================
   SportHub — Tournament Friendly: State Management
   從 tournament-friendly-detail.js 抽出（Phase 4 §10.3）
   狀態載入、快取同步、可見性判斷。
   ================================================ */

Object.assign(App, {

  _friendlyTournamentDetailRealtime: null,
  _friendlyTournamentDetailRealtimeRenderTimer: null,

  _isTournamentViewerInTeam(user, teamId) {
    if (!user || !teamId) return false;
    if (typeof this._isUserInTeam === 'function' && this._isUserInTeam(user, teamId)) return true;
    const team = ApiService.getTeam?.(teamId);
    if (!team) return false;
    return this._isTournamentTeamOfficerForTeam?.(team, user) === true;
  },

  _syncFriendlyTournamentCacheRecord(tournamentId, applications, entries) {
    const live = ApiService.getTournament?.(tournamentId);
    if (!live) return;
    live.registeredTeams = this._getFriendlyTournamentRegisteredTeamIdsFromEntries?.(entries, live) || [];
  },

  async _persistFriendlyTournamentCompatState(tournamentId, state = null) {
    const currentState = state || this._getFriendlyTournamentState?.(tournamentId);
    const tournament = currentState?.tournament;
    if (!tournament || !this._isFriendlyTournamentRecord(tournament)) return currentState;
    if (!this._canManageTournamentRecord?.(tournament)) return currentState;

    const applications = (currentState.applications || [])
      .map(item => this._buildFriendlyTournamentApplicationRecord(item))
      .filter(item => item.id || item.teamId);
    const entries = (currentState.entries || [])
      .map(item => this._buildFriendlyTournamentEntryRecord(item))
      .filter(item => item.teamId);
    const registeredTeams = this._getFriendlyTournamentRegisteredTeamIdsFromEntries?.(entries, tournament) || [];

    try {
      await ApiService.updateTournamentAwait(tournamentId, { registeredTeams });
    } catch (err) {
      console.warn('[persistFriendlyTournamentCompatState] sync failed:', err);
    }

    const nextState = {
      ...currentState,
      applications,
      entries,
      tournament: this._buildFriendlyTournamentRecord({
        ...tournament,
        registeredTeams,
      }),
    };
    this._syncFriendlyTournamentCacheRecord(tournamentId, applications, entries);
    this._friendlyTournamentDetailStateById[tournamentId] = nextState;
    return nextState;
  },

  _getFriendlyTournamentSnapshotRecord(doc) {
    if (!doc) return null;
    const exists = doc.exists !== false;
    if (!exists) return null;
    const data = typeof doc.data === 'function' ? (doc.data() || {}) : (doc || {});
    const id = doc.id || data.id || data._docId || '';
    return { id, ...data, _docId: id };
  },

  _mapFriendlyTournamentSnapshotDocs(snapshot, builder) {
    return (snapshot?.docs || [])
      .map(doc => this._getFriendlyTournamentSnapshotRecord(doc))
      .filter(Boolean)
      .map(item => builder.call(this, item));
  },

  _mapFriendlyTournamentEntrySnapshotDocs(snapshot) {
    return (snapshot?.docs || [])
      .map(doc => {
        const record = this._getFriendlyTournamentSnapshotRecord(doc);
        if (record && !record.teamId) record.teamId = doc.id || record.id || record._docId || '';
        return record;
      })
      .filter(Boolean)
      .map(item => this._buildFriendlyTournamentEntryRecord(item));
  },

  _mapFriendlyTournamentMemberSnapshotDocs(snapshot) {
    return (snapshot?.docs || [])
      .map(doc => {
        const record = this._getFriendlyTournamentSnapshotRecord(doc);
        if (record && !record.uid) record.uid = doc.id || record.id || record._docId || '';
        return record;
      })
      .filter(Boolean)
      .map(item => this._buildFriendlyTournamentRosterMemberRecord(item));
  },

  _sortFriendlyTournamentApplications(applications = []) {
    return (Array.isArray(applications) ? applications : [])
      .slice()
      .sort((a, b) => String(b.appliedAt || '').localeCompare(String(a.appliedAt || '')));
  },

  _sortFriendlyTournamentEntries(entries = []) {
    return (Array.isArray(entries) ? entries : [])
      .slice()
      .sort((a, b) => {
        if (a.entryStatus === 'host' && b.entryStatus !== 'host') return -1;
        if (a.entryStatus !== 'host' && b.entryStatus === 'host') return 1;
        return String(a.approvedAt || '').localeCompare(String(b.approvedAt || ''));
      });
  },

  _withFriendlyTournamentHostEntry(base, entries = []) {
    const entryMap = new Map();
    (Array.isArray(entries) ? entries : []).forEach(item => {
      const record = this._buildFriendlyTournamentEntryRecord(item);
      if (record.teamId) entryMap.set(record.teamId, record);
    });

    const hostTeam = base?.hostTeamId ? ApiService.getTeam?.(base.hostTeamId) : null;
    if (base?.hostTeamId && !entryMap.has(base.hostTeamId)) {
      entryMap.set(base.hostTeamId, this._buildFriendlyTournamentEntryRecord({
        teamId: base.hostTeamId,
        teamName: base.hostTeamName || hostTeam?.name || '',
        teamImage: base.hostTeamImage || hostTeam?.image || '',
        entryStatus: 'host',
        countsTowardLimit: this._isTournamentHostParticipating?.(base) !== false,
        memberRoster: [],
      }));
    }
    return this._sortFriendlyTournamentEntries([...entryMap.values()]);
  },

  _buildFriendlyTournamentDetailStateFromRecords(tournamentId, base, rawApplications = [], rawEntries = [], rawMatches = [], options = {}) {
    if (!base) return null;

    const applicationMap = new Map();
    (Array.isArray(rawApplications) ? rawApplications : []).forEach(item => {
      const record = this._buildFriendlyTournamentApplicationRecord(item);
      const key = record.id || record.teamId;
      if (key) applicationMap.set(key, record);
    });

    const entries = this._withFriendlyTournamentHostEntry(base, rawEntries);
    const applications = this._sortFriendlyTournamentApplications([...applicationMap.values()]);
    const tournament = this._buildFriendlyTournamentRecord({
      ...base,
      registeredTeams: this._getFriendlyTournamentRegisteredTeamIdsFromEntries?.(entries, base) || [],
    });
    const matches = (Array.isArray(rawMatches) ? rawMatches : [])
      .map(match => this._buildTournamentMatchRecord?.(match) || match);

    this._syncFriendlyTournamentCacheRecord(tournamentId, applications, entries);
    return {
      tournament,
      applications,
      entries,
      matches,
      rosterHydrated: options.rosterHydrated === true,
      rosterHydrateError: options.rosterHydrateError === true,
    };
  },

  async _loadFriendlyTournamentDetailState(tournamentId) {
    const base = ApiService.getFriendlyTournamentRecord?.(tournamentId) || ApiService.getTournament?.(tournamentId);
    if (!base) return null;
    if (!this._isFriendlyTournamentRecord(base)) {
      return { tournament: base, applications: [], entries: [] };
    }

    const fallbackApplications = Array.isArray(base.teamApplications) ? base.teamApplications : [];
    const fallbackEntries = Array.isArray(base.teamEntries) ? base.teamEntries : [];
    const currentUser = ApiService.getCurrentUser?.();
    const currentUserTeamIds = currentUser
      ? (typeof this._getFriendlyTournamentUserActionTeamIds === 'function'
        ? this._getFriendlyTournamentUserActionTeamIds(currentUser)
        : (typeof this._getUserTeamIds === 'function' ? this._getUserTeamIds(currentUser) : []))
      : [];
    const teamHydrationPromise = (async () => {
      if (!currentUserTeamIds.length || typeof ApiService.getTeamAsync !== 'function') return [];
      return await Promise.all(currentUserTeamIds.map(teamId =>
        ApiService.getTeamAsync(teamId).catch(() => null)
      ));
    })();
    const canManage = this._canManageTournamentRecord?.(base, currentUser);
    const applicationPromise = (async () => {
      if (canManage) {
        return await ApiService.listTournamentApplications(tournamentId).catch(() => fallbackApplications);
      }
      if (!currentUser) return fallbackApplications;
      if (currentUserTeamIds.length === 0) return fallbackApplications;
      const fetched = await Promise.all(currentUserTeamIds.map(teamId =>
        ApiService.getTournamentApplication(tournamentId, `ta_${teamId}`).catch(() => null)
      ));
      return [...fallbackApplications, ...fetched.filter(Boolean)];
    })();
    // 盃賽/聯賽：同步載入賽程比賽（友誼賽無賽程，跳過）
    const isCompetitionMode = ['cup', 'league'].includes(this._getTournamentMode?.(base) || 'friendly');
    const matchesPromise = isCompetitionMode && typeof ApiService.listTournamentMatches === 'function'
      ? ApiService.listTournamentMatches(tournamentId).catch(() => [])
      : Promise.resolve([]);
    const [rawApplications, rawEntries, rawMatches] = await Promise.all([
      applicationPromise,
      ApiService.listTournamentEntries(tournamentId).catch(() => fallbackEntries),
      matchesPromise,
      teamHydrationPromise,
    ]).then(([applications, entries, matches]) => [applications, entries, matches]);

    const state = this._buildFriendlyTournamentDetailStateFromRecords(
      tournamentId,
      base,
      [...fallbackApplications, ...rawApplications],
      [...fallbackEntries, ...rawEntries],
      rawMatches,
      { rosterHydrated: false }
    );
    this._friendlyTournamentDetailStateById[tournamentId] = state;
    return this._friendlyTournamentDetailStateById[tournamentId];
  },

  _getFriendlyTournamentRealtimeApplicationTeamIds(user = ApiService.getCurrentUser?.()) {
    const ids = typeof this._getFriendlyTournamentUserActionTeamIds === 'function'
      ? this._getFriendlyTournamentUserActionTeamIds(user)
      : (typeof this._getUserTeamIds === 'function' ? this._getUserTeamIds(user) : []);
    return [...new Set((ids || []).map(id => String(id || '').trim()).filter(Boolean))];
  },

  _stopFriendlyTournamentDetailRealtime(expectedTournamentId = '') {
    const current = this._friendlyTournamentDetailRealtime;
    if (!current) return;
    const safeExpectedId = String(expectedTournamentId || '').trim();
    if (safeExpectedId && current.tournamentId !== safeExpectedId) return;
    (current.unsubs || []).forEach(unsub => {
      try { if (typeof unsub === 'function') unsub(); } catch (_) {}
    });
    Object.values(current.memberUnsubs || {}).forEach(unsub => {
      try { if (typeof unsub === 'function') unsub(); } catch (_) {}
    });
    clearTimeout(this._friendlyTournamentDetailRealtimeRenderTimer);
    this._friendlyTournamentDetailRealtimeRenderTimer = null;
    this._friendlyTournamentDetailRealtime = null;
  },

  _composeFriendlyTournamentRealtimeState(tournamentId) {
    const realtime = this._friendlyTournamentDetailRealtime;
    if (!realtime || realtime.tournamentId !== String(tournamentId || '').trim()) return null;
    const current = this._getFriendlyTournamentState?.(tournamentId) || {};
    const base = realtime.tournament || current.tournament || ApiService.getFriendlyTournamentRecord?.(tournamentId) || ApiService.getTournament?.(tournamentId);
    if (!base) return null;

    const rawApplications = realtime.applicationsReady
      ? [...realtime.applicationsById.values()]
      : (current.applications || []);
    const existingEntryByTeam = new Map((current.entries || []).map(entry => [String(entry.teamId || '').trim(), entry]));
    const rawEntries = realtime.entriesReady
      ? [...realtime.entriesByTeam.values()].map(entry => {
        const teamId = String(entry.teamId || '').trim();
        const members = realtime.membersByTeam.has(teamId)
          ? realtime.membersByTeam.get(teamId)
          : (existingEntryByTeam.get(teamId)?.memberRoster || entry.memberRoster || []);
        return { ...entry, memberRoster: members };
      })
      : (current.entries || []);
    const rosterHydrated = realtime.expectedMemberTeamIds.size === 0
      || [...realtime.expectedMemberTeamIds].every(teamId => realtime.membersByTeam.has(teamId));

    const state = this._buildFriendlyTournamentDetailStateFromRecords(
      tournamentId,
      base,
      rawApplications,
      rawEntries,
      current.matches || [],
      { rosterHydrated }
    );
    this._friendlyTournamentDetailStateById[tournamentId] = state;
    return state;
  },

  _renderFriendlyTournamentRealtimeDetail(tournamentId) {
    const safeTournamentId = String(tournamentId || '').trim();
    if (!safeTournamentId || this.currentPage !== 'page-tournament-detail' || String(this.currentTournament || '') !== safeTournamentId) return;
    const state = this._getFriendlyTournamentState?.(safeTournamentId);
    const tournament = state?.tournament || ApiService.getFriendlyTournamentRecord?.(safeTournamentId) || ApiService.getTournament?.(safeTournamentId);
    if (!tournament || !this._isFriendlyTournamentRecord?.(tournament)) return;

    const img = document.getElementById('td-img-placeholder');
    if (img) {
      if (tournament.image) {
        img.innerHTML = '<img src="' + tournament.image + '" alt="' + escapeHTML(tournament.name || '') + '" style="width:100%;height:100%;object-fit:cover;display:block;border-radius:var(--radius)">';
        img.style.border = 'none';
      } else {
        img.textContent = 'Tournament image';
        img.style.border = '';
      }
    }
    const title = document.getElementById('td-title');
    if (title) {
      title.innerHTML = escapeHTML(tournament.name || '') + ' ' + (this._favHeartHtml?.(this.isTournamentFavorited?.(safeTournamentId), 'Tournament', safeTournamentId) || '');
    }

    this.renderRegisterButton?.(tournament);
    this.renderTournamentInfo?.(tournament);
    if (this._getFriendlyTournamentActiveTab?.() === 'teams') this.renderTournamentTab?.('teams');
    if (this._friendlyTournamentRosterListState?.tournamentId === safeTournamentId && !this._friendlyTournamentRosterListState.editingUid) {
      this._renderFriendlyTournamentRosterListModal?.();
    }
    this._renderFriendlyTournamentRosterPicker?.(safeTournamentId);
  },

  _scheduleFriendlyTournamentRealtimeRender(tournamentId, options = {}) {
    const safeTournamentId = String(tournamentId || '').trim();
    if (!safeTournamentId) return;
    this._composeFriendlyTournamentRealtimeState(safeTournamentId);
    clearTimeout(this._friendlyTournamentDetailRealtimeRenderTimer);
    const delay = options.immediate ? 0 : 80;
    this._friendlyTournamentDetailRealtimeRenderTimer = setTimeout(() => {
      this._renderFriendlyTournamentRealtimeDetail(safeTournamentId);
    }, delay);
  },

  _syncFriendlyTournamentMemberRealtimeListeners(tournamentId, tournamentRef, entries = []) {
    const realtime = this._friendlyTournamentDetailRealtime;
    if (!realtime || realtime.tournamentId !== String(tournamentId || '').trim()) return;
    const nextTeamIds = new Set((entries || [])
      .filter(entry => entry && (entry.entryStatus === 'host' || entry.entryStatus === 'approved'))
      .map(entry => String(entry.teamId || '').trim())
      .filter(Boolean));

    Object.keys(realtime.memberUnsubs || {}).forEach(teamId => {
      if (nextTeamIds.has(teamId)) return;
      try { realtime.memberUnsubs[teamId]?.(); } catch (_) {}
      delete realtime.memberUnsubs[teamId];
      realtime.membersByTeam.delete(teamId);
    });
    realtime.expectedMemberTeamIds = nextTeamIds;

    nextTeamIds.forEach(teamId => {
      if (realtime.memberUnsubs[teamId]) return;
      const unsub = tournamentRef.collection('entries').doc(teamId).collection('members').onSnapshot(snapshot => {
        realtime.membersByTeam.set(teamId, this._mapFriendlyTournamentMemberSnapshotDocs(snapshot));
        this._scheduleFriendlyTournamentRealtimeRender(tournamentId);
      }, err => {
        console.warn('[Tournament:Realtime] members listener failed:', teamId, err);
      });
      realtime.memberUnsubs[teamId] = unsub;
    });
  },

  async _startFriendlyTournamentDetailRealtime(tournamentId, initialState = null) {
    const safeTournamentId = String(tournamentId || '').trim();
    if (!safeTournamentId || typeof FirebaseService === 'undefined') return false;
    if (this._friendlyTournamentDetailRealtime?.tournamentId === safeTournamentId) return true;
    this._stopFriendlyTournamentDetailRealtime();

    let tournamentRef = null;
    try {
      if (typeof FirebaseService._getTournamentDocRefById !== 'function') return false;
      tournamentRef = await FirebaseService._getTournamentDocRefById(safeTournamentId);
    } catch (err) {
      console.warn('[Tournament:Realtime] detail listener setup failed:', err);
      return false;
    }
    if (!tournamentRef || typeof tournamentRef.onSnapshot !== 'function') return false;

    const user = ApiService.getCurrentUser?.();
    const canManage = !!this._canManageTournamentRecord?.(initialState?.tournament || ApiService.getTournament?.(safeTournamentId), user);
    const applicationTeamIds = this._getFriendlyTournamentRealtimeApplicationTeamIds(user);
    const realtime = {
      tournamentId: safeTournamentId,
      tournamentRef,
      unsubs: [],
      memberUnsubs: {},
      tournament: initialState?.tournament || null,
      applicationsById: new Map((initialState?.applications || []).map(item => [item.id || item.teamId, item])),
      entriesByTeam: new Map((initialState?.entries || []).map(item => [item.teamId, item]).filter(([teamId]) => teamId)),
      membersByTeam: new Map((initialState?.entries || [])
        .filter(entry => Array.isArray(entry.memberRoster) && entry.memberRoster.length > 0)
        .map(entry => [entry.teamId, entry.memberRoster])),
      expectedMemberTeamIds: new Set(),
      applicationsReady: false,
      entriesReady: false,
    };
    this._friendlyTournamentDetailRealtime = realtime;

    realtime.unsubs.push(tournamentRef.onSnapshot(doc => {
      const record = this._getFriendlyTournamentSnapshotRecord(doc);
      if (record) realtime.tournament = this._buildFriendlyTournamentRecord(record);
      this._scheduleFriendlyTournamentRealtimeRender(safeTournamentId);
    }, err => {
      console.warn('[Tournament:Realtime] tournament listener failed:', err);
    }));

    if (canManage) {
      realtime.unsubs.push(tournamentRef.collection('applications').onSnapshot(snapshot => {
        realtime.applicationsById = new Map(this._mapFriendlyTournamentSnapshotDocs(snapshot, this._buildFriendlyTournamentApplicationRecord)
          .map(item => [item.id || item.teamId, item]));
        realtime.applicationsReady = true;
        this._scheduleFriendlyTournamentRealtimeRender(safeTournamentId);
      }, err => {
        console.warn('[Tournament:Realtime] applications listener failed:', err);
      }));
    } else {
      const appUnsubs = applicationTeamIds.map(teamId => {
        const appId = 'ta_' + teamId;
        return tournamentRef.collection('applications').doc(appId).onSnapshot(doc => {
          const record = this._getFriendlyTournamentSnapshotRecord(doc);
          if (record) {
            const app = this._buildFriendlyTournamentApplicationRecord(record);
            realtime.applicationsById.set(app.id || app.teamId || appId, app);
          } else {
            realtime.applicationsById.delete(appId);
          }
          realtime.applicationsReady = true;
          this._scheduleFriendlyTournamentRealtimeRender(safeTournamentId);
        }, err => {
          console.warn('[Tournament:Realtime] application listener failed:', appId, err);
        });
      });
      realtime.unsubs.push(...appUnsubs);
      if (appUnsubs.length === 0) realtime.applicationsReady = true;
    }

    realtime.unsubs.push(tournamentRef.collection('entries').onSnapshot(snapshot => {
      const entries = this._mapFriendlyTournamentEntrySnapshotDocs(snapshot);
      realtime.entriesByTeam = new Map(entries.map(item => [item.teamId, item]).filter(([teamId]) => teamId));
      realtime.entriesReady = true;
      this._syncFriendlyTournamentMemberRealtimeListeners(safeTournamentId, tournamentRef, entries);
      this._scheduleFriendlyTournamentRealtimeRender(safeTournamentId);
    }, err => {
      console.warn('[Tournament:Realtime] entries listener failed:', err);
    }));

    this._scheduleFriendlyTournamentRealtimeRender(safeTournamentId, { immediate: true });
    return true;
  },

  _getFriendlyTournamentVisibleApplications(state, user = ApiService.getCurrentUser?.()) {
    const tournament = state?.tournament;
    if (!tournament) return [];
    const canManage = this._canManageTournamentRecord?.(tournament, user);
    const activeEntryTeamIds = new Set((state.entries || [])
      .filter(entry => entry.entryStatus === 'host' || entry.entryStatus === 'approved')
      .map(entry => String(entry.teamId || '').trim())
      .filter(Boolean));
    return (state.applications || []).filter(application => {
      const status = String(application.status || '').trim().toLowerCase();
      const teamId = String(application.teamId || '').trim();
      if (activeEntryTeamIds.has(teamId)) return false;
      if (status === 'approved' || status === 'cancelled' || status === 'withdrawn' || status === 'removed' || status === 'rejected') return false;
      return canManage || this._isTournamentViewerInTeam(user, application.teamId);
    });
  },

});
