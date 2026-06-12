/* ================================================
   SportHub — Tournament Match Data (ApiService 擴充)
   盃賽 / 聯賽比賽（tournaments/{docId}/matches 子集合）CRUD。
   依專案規範：資料操作統一透過 ApiService；此檔以
   Object.assign(ApiService) 擴充，不修改 firebase-crud.js
   （該檔含報名鎖定函式，外科手術式修改規範要求避免變動）。
   Firestore Rules：主辦 / 委託 / 主辦隊幹部可建立與管理；
   裁判長與被指派裁判僅能更新比分相關欄位。
   ================================================ */

Object.assign(ApiService, {

  _stripTournamentMatchDocId(payload) {
    const clone = { ...payload };
    delete clone._docId;
    return clone;
  },

  async listTournamentMatches(tournamentId) {
    const collectionRef = await FirebaseService._getTournamentSubcollectionRef(tournamentId, 'matches');
    const snapshot = await collectionRef.get();
    const matches = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data(), _docId: doc.id }));
    const stageOrder = { league: 0, cup: 0, third: 1 };
    return matches.sort((a, b) =>
      ((stageOrder[a.stage] || 0) - (stageOrder[b.stage] || 0))
      || ((Number(a.round) || 0) - (Number(b.round) || 0))
      || ((Number(a.matchNo) || 0) - (Number(b.matchNo) || 0)));
  },

  /** 整批寫入賽程（產生 / 重新產生）。會先刪除既有比賽再寫入新賽程。 */
  async replaceTournamentMatchesAtomic(tournamentId, matches) {
    if (!(await FirebaseService.ensureAuthReadyForWrite())) throw new Error('AUTH_NOT_READY');
    const list = Array.isArray(matches) ? matches : [];
    if (list.length > 400) throw new Error('TOURNAMENT_MATCHES_TOO_MANY');
    const collectionRef = await FirebaseService._getTournamentSubcollectionRef(tournamentId, 'matches');
    const existingSnap = await collectionRef.get();
    const batch = db.batch();
    existingSnap.docs.forEach(doc => batch.delete(doc.ref));
    const now = firebase.firestore.FieldValue.serverTimestamp();
    const saved = list.map(match => {
      const id = String(match.id || '').trim() || generateId('cm_');
      const payload = this._stripTournamentMatchDocId({ ...match, id });
      batch.set(collectionRef.doc(id), { ...payload, createdAt: now, updatedAt: now });
      return { ...payload, _docId: id };
    });
    await batch.commit();
    ApiService._writeOpLog?.('tourn_schedule', '產生賽程', `賽事 ${tournamentId} 寫入 ${saved.length} 場比賽`);
    return saved;
  },

  async updateTournamentMatchAwait(tournamentId, matchId, updates) {
    if (!(await FirebaseService.ensureAuthReadyForWrite())) throw new Error('AUTH_NOT_READY');
    const safeMatchId = String(matchId || '').trim();
    if (!safeMatchId) throw new Error('TOURNAMENT_MATCH_ID_REQUIRED');
    const collectionRef = await FirebaseService._getTournamentSubcollectionRef(tournamentId, 'matches');
    const payload = this._stripTournamentMatchDocId({ ...updates });
    delete payload.id;
    delete payload.createdAt;
    await collectionRef.doc(safeMatchId).update({
      ...payload,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    return { id: safeMatchId, ...payload, _docId: safeMatchId };
  },

  async deleteTournamentMatchAwait(tournamentId, matchId) {
    if (!(await FirebaseService.ensureAuthReadyForWrite())) throw new Error('AUTH_NOT_READY');
    const safeMatchId = String(matchId || '').trim();
    if (!safeMatchId) throw new Error('TOURNAMENT_MATCH_ID_REQUIRED');
    const collectionRef = await FirebaseService._getTournamentSubcollectionRef(tournamentId, 'matches');
    await collectionRef.doc(safeMatchId).delete();
    return { id: safeMatchId };
  },

});
