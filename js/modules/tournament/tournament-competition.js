/* ================================================
   SportHub — Tournament Competition Engine (Pure)
   盃賽 / 聯賽：賽程產生、積分榜、射手榜、紅黃牌統計。
   純函式：無 DOM、無 API 呼叫、無副作用。
   設計原則（2026-06-12）：積分榜 / 射手榜一律由比賽結果
   「即時推導」，不落地儲存——棄權（walkover）改判後榜單
   自動正確，避免歷史上榜單存檔後算壞修不回的失敗模式。
   ================================================ */

Object.assign(App, {

  _sanitizeTournamentCompetitionConfig(raw = {}) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const num = (value, fallback, min, max) => {
      const n = Number(value);
      if (!Number.isFinite(n)) return fallback;
      return Math.min(max, Math.max(min, Math.floor(n)));
    };
    const allowedTiebreakers = ['gd', 'gf', 'h2h', 'wins'];
    const tiebreakers = Array.isArray(src.tiebreakers)
      ? src.tiebreakers.map(key => String(key || '').trim().toLowerCase()).filter(key => allowedTiebreakers.includes(key))
      : [];
    return {
      pointsWin: num(src.pointsWin, 3, 0, 10),
      pointsDraw: num(src.pointsDraw, 1, 0, 10),
      pointsLoss: num(src.pointsLoss, 0, 0, 10),
      doubleRound: src.doubleRound === true,
      matchRepeatCount: num(src.matchRepeatCount ?? src.pairRepeatCount, src.doubleRound === true ? 2 : 1, 1, 20),
      thirdPlace: src.thirdPlace === true,
      walkoverWinScore: num(src.walkoverWinScore, 3, 0, 20),
      walkoverLoseScore: num(src.walkoverLoseScore, 0, 0, 20),
      tiebreakers: tiebreakers.length ? [...new Set(tiebreakers)] : ['gd', 'gf', 'h2h'],
      yellowLimit: num(src.yellowLimit, 0, 0, 20),
      maxRosterSize: num(src.maxRosterSize, 0, 0, 99),
    };
  },

  _getTournamentCompetitionConfig(tournament) {
    return this._sanitizeTournamentCompetitionConfig(tournament?.competitionConfig);
  },

  _normalizeTournamentMatchRepeatCount(value, fallback = 1) {
    const n = Number(value);
    const base = Number.isFinite(n) ? n : Number(fallback);
    if (!Number.isFinite(base)) return 1;
    return Math.min(20, Math.max(1, Math.floor(base)));
  },

  _buildTournamentMatchRecord(data = {}) {
    // null / undefined / 空字串 = 「未記錄」，必須保留 null（不可變成 0）
    const num = value => {
      if (value === null || value === undefined || value === '') return null;
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    };
    const dateTimeValue = value => {
      if (value === null || value === undefined || value === '') return '';
      if (typeof value === 'string') return value.trim();
      if (value instanceof Date || typeof value === 'number' || typeof value?.toDate === 'function' || typeof value?.toMillis === 'function') return value;
      return String(value || '').trim();
    };
    const text = (value, limit = 60) => String(value || '').trim().slice(0, limit);
    const playerList = value => {
      const source = Array.isArray(value)
        ? value
        : String(value || '').split(/[\n,，、/]+/);
      return source
        .map(item => text(item, 30))
        .filter(Boolean)
        .slice(0, 20);
    };
    const validEventTypes = ['goal', 'own_goal', 'yellow', 'red', 'stoppage_time', 'substitution'];
    const events = Array.isArray(data.events)
      ? data.events
          .map(ev => {
            const type = validEventTypes.includes(String(ev?.type || '').trim()) ? String(ev.type).trim() : '';
            const minute = Number.isFinite(Number(ev?.minute)) && Number(ev.minute) > 0 ? Math.floor(Number(ev.minute)) : null;
            const base = {
              type,
              teamId: String(ev?.teamId || '').trim(),
              uid: String(ev?.uid || '').trim(),
              name: text(ev?.name, 40),
              minute,
              note: text(ev?.note || ev?.reason, 60),
            };
            if (type === 'stoppage_time') {
              return { ...base, teamId: '', uid: '', name: '' };
            }
            if (type === 'substitution') {
              return {
                ...base,
                uid: '',
                name: '',
                playersIn: playerList(ev?.playersIn || ev?.inPlayers || ev?.subIn),
                playersOut: playerList(ev?.playersOut || ev?.outPlayers || ev?.subOut),
              };
            }
            return base;
          })
          .filter(ev => {
            if (!ev.type) return false;
            if (ev.type === 'stoppage_time') return !!(ev.minute || ev.note);
            if (ev.type === 'substitution') return !!(ev.teamId && (ev.playersIn.length || ev.playersOut.length));
            return !!ev.teamId;
          })
      : [];
    return {
      id: String(data.id || data._docId || '').trim(),
      stage: ['league', 'cup', 'third'].includes(String(data.stage || '').trim()) ? String(data.stage).trim() : 'league',
      round: Math.max(1, Math.floor(Number(data.round) || 1)),
      slot: Math.max(0, Math.floor(Number(data.slot) || 0)),
      slotKey: String(data.slotKey || '').trim(),
      matchNo: Math.max(0, Math.floor(Number(data.matchNo) || 0)),
      seriesKey: String(data.seriesKey || '').trim(),
      seriesGame: Math.max(1, Math.floor(Number(data.seriesGame) || 1)),
      seriesTotal: Math.max(1, Math.floor(Number(data.seriesTotal) || 1)),
      homeTeamId: String(data.homeTeamId || '').trim(),
      awayTeamId: String(data.awayTeamId || '').trim(),
      homeSourceSlot: String(data.homeSourceSlot || '').trim(),
      awaySourceSlot: String(data.awaySourceSlot || '').trim(),
      sourceType: data.sourceType === 'loser' ? 'loser' : 'winner',
      scheduledAt: dateTimeValue(data.scheduledAt),
      venue: String(data.venue || '').trim(),
      referees: this._normalizeTournamentReferees?.(data.referees) || [],
      refereeUids: Array.isArray(data.refereeUids) ? data.refereeUids.map(uid => String(uid || '').trim()).filter(Boolean) : [],
      status: ['scheduled', 'finished', 'walkover', 'bye'].includes(String(data.status || '').trim()) ? String(data.status).trim() : 'scheduled',
      scoreHome: num(data.scoreHome),
      scoreAway: num(data.scoreAway),
      pkHome: num(data.pkHome),
      pkAway: num(data.pkAway),
      walkoverWinnerTeamId: String(data.walkoverWinnerTeamId || '').trim(),
      events,
      liveUrl: String(data.liveUrl || data.streamUrl || '').trim(),
      recordedByUid: String(data.recordedByUid || '').trim(),
      recordedByName: String(data.recordedByName || '').trim(),
      recordedAt: String(data.recordedAt || '').trim(),
    };
  },

  /** 聯賽循環賽程（circle method）。回傳尚未含 id 的 match payload 陣列。 */
  _repeatTournamentFixtureSeries(fixtures, repeatCount, options = {}) {
    const repeat = this._normalizeTournamentMatchRepeatCount(repeatCount, 1);
    const list = Array.isArray(fixtures) ? fixtures : [];
    if (repeat <= 1) {
      return list.map((match, index) => ({
        ...match,
        matchNo: index + 1,
        seriesKey: match.seriesKey || match.slotKey || '',
        seriesGame: 1,
        seriesTotal: 1,
      }));
    }
    const repeated = [];
    let matchNo = 0;
    const leagueRoundsTotal = Math.max(0, Math.floor(Number(options.leagueRoundsTotal) || 0));
    list.forEach(match => {
      const baseSeriesKey = match.seriesKey || match.slotKey || '';
      if (match.status === 'bye') {
        repeated.push({
          ...match,
          matchNo: ++matchNo,
          seriesKey: baseSeriesKey,
          seriesGame: 1,
          seriesTotal: 1,
        });
        return;
      }
      for (let game = 1; game <= repeat; game++) {
        const swapSides = game % 2 === 0;
        const nextRound = leagueRoundsTotal > 0 ? match.round + leagueRoundsTotal * (game - 1) : match.round;
        const nextSlot = leagueRoundsTotal > 0 ? match.slot : match.slot * repeat + (game - 1);
        const nextSlotKey = leagueRoundsTotal > 0
          ? `lr${nextRound}m${match.slot}`
          : (game === 1 ? match.slotKey : `${match.slotKey}g${game}`);
        const clone = {
          ...match,
          round: nextRound,
          slot: nextSlot,
          slotKey: nextSlotKey,
          matchNo: ++matchNo,
          seriesKey: baseSeriesKey,
          seriesGame: game,
          seriesTotal: repeat,
        };
        if (swapSides) {
          [clone.homeTeamId, clone.awayTeamId] = [clone.awayTeamId, clone.homeTeamId];
          const nextHomeSourceSlot = String(clone.awaySourceSlot || '').trim();
          const nextAwaySourceSlot = String(clone.homeSourceSlot || '').trim();
          if (nextHomeSourceSlot) clone.homeSourceSlot = nextHomeSourceSlot;
          else delete clone.homeSourceSlot;
          if (nextAwaySourceSlot) clone.awaySourceSlot = nextAwaySourceSlot;
          else delete clone.awaySourceSlot;
        }
        repeated.push(clone);
      }
    });
    return repeated;
  },

  _generateLeagueFixtures(teamIds, options = {}) {
    const ids = (Array.isArray(teamIds) ? teamIds : []).map(id => String(id || '').trim()).filter(Boolean);
    if (ids.length < 2) return [];
    const rotation = [...ids];
    if (rotation.length % 2 === 1) rotation.push('');
    const half = rotation.length / 2;
    const roundsTotal = rotation.length - 1;
    const fixtures = [];
    let matchNo = 0;
    for (let round = 1; round <= roundsTotal; round++) {
      for (let i = 0; i < half; i++) {
        const teamA = rotation[i];
        const teamB = rotation[rotation.length - 1 - i];
        if (!teamA || !teamB) continue;
        const flip = round % 2 === 0 && i === 0;
        fixtures.push({
          stage: 'league', round, slot: i, slotKey: `lr${round}m${i}`, matchNo: ++matchNo,
          homeTeamId: flip ? teamB : teamA, awayTeamId: flip ? teamA : teamB, status: 'scheduled',
        });
      }
      rotation.splice(1, 0, rotation.pop());
    }
    const repeat = this._normalizeTournamentMatchRepeatCount(
      options.matchRepeatCount ?? options.pairRepeatCount,
      options.doubleRound === true ? 2 : 1
    );
    return this._repeatTournamentFixtureSeries(fixtures, repeat, { leagueRoundsTotal: roundsTotal });
  },

  /** 標準種子序（1-indexed），size 必須為 2 的次方。 */
  _getCupSeedOrder(size) {
    let order = [1];
    while (order.length < size) {
      const m = order.length * 2 + 1;
      const next = [];
      order.forEach(seed => next.push(seed, m - seed));
      order = next;
    }
    return order;
  },

  /** 盃賽單淘汰賽程（含輪空與可選季軍戰）。 */
  _generateCupBracket(teamIds, options = {}) {
    const ids = (Array.isArray(teamIds) ? teamIds : []).map(id => String(id || '').trim()).filter(Boolean);
    if (ids.length < 2) return [];
    let size = 2;
    while (size < ids.length) size *= 2;
    const seedOrder = this._getCupSeedOrder(size);
    const roundsTotal = Math.round(Math.log2(size));
    const matches = [];
    let matchNo = 0;
    for (let i = 0; i < size / 2; i++) {
      const home = ids[seedOrder[2 * i] - 1] || '';
      const away = ids[seedOrder[2 * i + 1] - 1] || '';
      matches.push({
        stage: 'cup', round: 1, slot: i, slotKey: `r1m${i}`, matchNo: ++matchNo,
        homeTeamId: home || away, awayTeamId: home ? away : '',
        status: home && away ? 'scheduled' : 'bye',
      });
    }
    for (let round = 2; round <= roundsTotal; round++) {
      const count = size / Math.pow(2, round);
      for (let i = 0; i < count; i++) {
        matches.push({
          stage: 'cup', round, slot: i, slotKey: `r${round}m${i}`, matchNo: ++matchNo,
          homeTeamId: '', awayTeamId: '',
          homeSourceSlot: `r${round - 1}m${2 * i}`, awaySourceSlot: `r${round - 1}m${2 * i + 1}`,
          status: 'scheduled',
        });
      }
    }
    if (options.thirdPlace === true && size >= 4) {
      matches.push({
        stage: 'third', round: roundsTotal, slot: 0, slotKey: 'third', matchNo: ++matchNo,
        homeTeamId: '', awayTeamId: '',
        homeSourceSlot: `r${roundsTotal - 1}m0`, awaySourceSlot: `r${roundsTotal - 1}m1`,
        sourceType: 'loser', status: 'scheduled',
      });
    }
    const repeat = this._normalizeTournamentMatchRepeatCount(
      options.matchRepeatCount ?? options.pairRepeatCount,
      1
    );
    return this._repeatTournamentFixtureSeries(matches, repeat);
  },

  _getTournamentRoundLabel(match, bracketSize = 0) {
    if (!match) return '';
    if (match.stage === 'third') return '季軍戰';
    if (match.stage === 'league') return `第 ${match.round} 輪`;
    const teamsInRound = bracketSize > 0 ? bracketSize / Math.pow(2, match.round - 1) : 0;
    if (teamsInRound === 2) return '決賽';
    if (teamsInRound === 4) return '準決賽';
    if (teamsInRound > 4) return `${teamsInRound} 強`;
    return `第 ${match.round} 輪`;
  },

  /** 取得單場勝方 teamId；無法判定回傳 ''。盃賽平手以 PK 判定。 */
  _getTournamentMatchWinnerTeamId(match, matchesBySlot = {}) {
    if (!match) return '';
    if (Array.isArray(match.seriesMatches) && match.seriesMatches.length > 0) {
      return this._getTournamentSeriesWinnerTeamId(match, matchesBySlot);
    }
    return this._getTournamentSingleMatchWinnerTeamId(match, matchesBySlot);
  },

  _getTournamentSingleMatchWinnerTeamId(match, matchesBySlot = {}) {
    if (!match) return '';
    if (match.status === 'bye') return match.homeTeamId || match.awayTeamId || '';
    if (match.status === 'walkover') return String(match.walkoverWinnerTeamId || '').trim();
    if (match.status !== 'finished') return '';
    const home = this._resolveTournamentMatchSide(match, 'home', matchesBySlot);
    const away = this._resolveTournamentMatchSide(match, 'away', matchesBySlot);
    if (!home.teamId || !away.teamId) return '';
    const scoreHome = Number(match.scoreHome);
    const scoreAway = Number(match.scoreAway);
    if (!Number.isFinite(scoreHome) || !Number.isFinite(scoreAway)) return '';
    if (scoreHome > scoreAway) return home.teamId;
    if (scoreAway > scoreHome) return away.teamId;
    const pkHome = Number(match.pkHome);
    const pkAway = Number(match.pkAway);
    if (Number.isFinite(pkHome) && Number.isFinite(pkAway) && pkHome !== pkAway) {
      return pkHome > pkAway ? home.teamId : away.teamId;
    }
    return '';
  },

  _getTournamentSeriesWinnerTeamId(series, matchesBySlot = {}) {
    const items = Array.isArray(series.seriesMatches) ? series.seriesMatches : [];
    if (items.length === 0) return '';
    const total = Math.max(1, ...items.map(item => Number(item.seriesTotal) || 1));
    const threshold = Math.floor(total / 2) + 1;
    const wins = new Map();
    let completed = 0;
    items.forEach(item => {
      if (!['finished', 'walkover', 'bye'].includes(String(item.status || ''))) return;
      completed += 1;
      const winner = this._getTournamentSingleMatchWinnerTeamId(item, matchesBySlot);
      if (!winner) return;
      wins.set(winner, (wins.get(winner) || 0) + 1);
    });
    let leader = '';
    let leaderWins = 0;
    let tied = false;
    wins.forEach((count, teamId) => {
      if (count > leaderWins) {
        leader = teamId;
        leaderWins = count;
        tied = false;
      } else if (count === leaderWins) {
        tied = true;
      }
    });
    if (leader && leaderWins >= threshold) return leader;
    if (completed >= total && leader && !tied) return leader;
    return '';
  },

  /** 解析比賽某一側的 teamId（盃賽晉級鏈即時推導，不落地）。 */
  _resolveTournamentMatchSide(match, side, matchesBySlot = {}, depth = 0) {
    if (!match || depth > 8) return { teamId: '', pending: true };
    const direct = String(side === 'home' ? match.homeTeamId : match.awayTeamId || '').trim();
    if (direct) return { teamId: direct, pending: false };
    const sourceSlot = String(side === 'home' ? match.homeSourceSlot : match.awaySourceSlot || '').trim();
    if (!sourceSlot) return { teamId: '', pending: true };
    const source = matchesBySlot[sourceSlot];
    if (!source) return { teamId: '', pending: true };
    const winner = this._getTournamentMatchWinnerTeamId(source, matchesBySlot);
    if (!winner) return { teamId: '', pending: true };
    if (match.sourceType !== 'loser') return { teamId: winner, pending: false };
    const srcHome = this._resolveTournamentMatchSide(source, 'home', matchesBySlot, depth + 1);
    const srcAway = this._resolveTournamentMatchSide(source, 'away', matchesBySlot, depth + 1);
    if (!srcHome.teamId || !srcAway.teamId) return { teamId: '', pending: true };
    const loser = winner === srcHome.teamId ? srcAway.teamId : srcHome.teamId;
    return { teamId: loser, pending: false };
  },

  _buildTournamentMatchesBySlot(matches) {
    const bySlot = {};
    const groups = {};
    (Array.isArray(matches) ? matches : []).forEach(match => {
      if (!match?.slotKey) return;
      bySlot[match.slotKey] = match;
      const seriesKey = String(match.seriesKey || match.slotKey || '').trim();
      if (!seriesKey) return;
      if (!groups[seriesKey]) groups[seriesKey] = [];
      groups[seriesKey].push(match);
    });
    Object.entries(groups).forEach(([seriesKey, items]) => {
      const ordered = [...items].sort((a, b) =>
        (Number(a.seriesGame || 1) - Number(b.seriesGame || 1))
        || (Number(a.matchNo || 0) - Number(b.matchNo || 0))
      );
      const seriesTotal = Math.max(1, ...ordered.map(item => Number(item.seriesTotal) || 1));
      if (ordered.length > 1 || seriesTotal > 1) {
        bySlot[seriesKey] = {
          ...ordered[0],
          id: `series:${seriesKey}`,
          slotKey: seriesKey,
          seriesKey,
          seriesGame: 1,
          seriesTotal,
          seriesMatches: ordered,
        };
      } else {
        bySlot[seriesKey] = ordered[0];
      }
    });
    return bySlot;
  },

  /** 聯賽積分榜（即時推導）。walkover 計入積分與得失球，不產生射手事件。 */
  _computeLeagueStandings(matches, options = {}) {
    const config = this._sanitizeTournamentCompetitionConfig(options.config || options);
    const nameById = options.nameById || {};
    const rows = new Map();
    const ensureRow = teamId => {
      if (!rows.has(teamId)) {
        rows.set(teamId, { teamId, name: nameById[teamId] || teamId, played: 0, win: 0, draw: 0, loss: 0, gf: 0, ga: 0, gd: 0, points: 0, walkovers: 0 });
      }
      return rows.get(teamId);
    };
    (Array.isArray(options.teamIds) ? options.teamIds : []).forEach(teamId => {
      const safeId = String(teamId || '').trim();
      if (safeId) ensureRow(safeId);
    });
    const played = (Array.isArray(matches) ? matches : []).filter(match =>
      match && match.stage === 'league' && match.homeTeamId && match.awayTeamId
      && (match.status === 'finished' || match.status === 'walkover'));
    played.forEach(match => {
      let scoreHome; let scoreAway;
      if (match.status === 'walkover') {
        const winnerIsHome = match.walkoverWinnerTeamId === match.homeTeamId;
        scoreHome = winnerIsHome ? config.walkoverWinScore : config.walkoverLoseScore;
        scoreAway = winnerIsHome ? config.walkoverLoseScore : config.walkoverWinScore;
        if (!match.walkoverWinnerTeamId) return;
      } else {
        scoreHome = Number(match.scoreHome);
        scoreAway = Number(match.scoreAway);
        if (!Number.isFinite(scoreHome) || !Number.isFinite(scoreAway)) return;
      }
      const home = ensureRow(match.homeTeamId);
      const away = ensureRow(match.awayTeamId);
      home.played += 1; away.played += 1;
      home.gf += scoreHome; home.ga += scoreAway;
      away.gf += scoreAway; away.ga += scoreHome;
      if (match.status === 'walkover') {
        const loser = match.walkoverWinnerTeamId === match.homeTeamId ? away : home;
        loser.walkovers += 1;
      }
      if (scoreHome > scoreAway) { home.win += 1; away.loss += 1; home.points += config.pointsWin; away.points += config.pointsLoss; }
      else if (scoreHome < scoreAway) { away.win += 1; home.loss += 1; away.points += config.pointsWin; home.points += config.pointsLoss; }
      else { home.draw += 1; away.draw += 1; home.points += config.pointsDraw; away.points += config.pointsDraw; }
    });
    rows.forEach(row => { row.gd = row.gf - row.ga; });
    return this._sortLeagueStandingRows([...rows.values()], played, config);
  },

  _sortLeagueStandingRows(rows, playedMatches, config) {
    const compareBy = (a, b, key, h2h) => {
      if (key === 'gd') return b.gd - a.gd;
      if (key === 'gf') return b.gf - a.gf;
      if (key === 'wins') return b.win - a.win;
      if (key === 'h2h' && h2h) {
        const ha = h2h.get(a.teamId) || { points: 0, gd: 0, gf: 0 };
        const hb = h2h.get(b.teamId) || { points: 0, gd: 0, gf: 0 };
        return (hb.points - ha.points) || (hb.gd - ha.gd) || (hb.gf - ha.gf);
      }
      return 0;
    };
    const buildH2h = group => {
      const idSet = new Set(group.map(row => row.teamId));
      const mini = new Map();
      group.forEach(row => mini.set(row.teamId, { points: 0, gd: 0, gf: 0 }));
      playedMatches.forEach(match => {
        if (!idSet.has(match.homeTeamId) || !idSet.has(match.awayTeamId)) return;
        let sh; let sa;
        if (match.status === 'walkover') {
          if (!match.walkoverWinnerTeamId) return;
          const winnerIsHome = match.walkoverWinnerTeamId === match.homeTeamId;
          sh = winnerIsHome ? config.walkoverWinScore : config.walkoverLoseScore;
          sa = winnerIsHome ? config.walkoverLoseScore : config.walkoverWinScore;
        } else {
          sh = Number(match.scoreHome); sa = Number(match.scoreAway);
          if (!Number.isFinite(sh) || !Number.isFinite(sa)) return;
        }
        const home = mini.get(match.homeTeamId);
        const away = mini.get(match.awayTeamId);
        home.gf += sh; home.gd += sh - sa; away.gf += sa; away.gd += sa - sh;
        if (sh > sa) home.points += config.pointsWin;
        else if (sa > sh) away.points += config.pointsWin;
        else { home.points += config.pointsDraw; away.points += config.pointsDraw; }
      });
      return mini;
    };
    const sorted = [...rows].sort((a, b) => (b.points - a.points) || String(a.name || '').localeCompare(String(b.name || '')));
    const result = [];
    let index = 0;
    while (index < sorted.length) {
      let end = index + 1;
      while (end < sorted.length && sorted[end].points === sorted[index].points) end += 1;
      const group = sorted.slice(index, end);
      if (group.length > 1) {
        const h2h = config.tiebreakers.includes('h2h') ? buildH2h(group) : null;
        group.sort((a, b) => {
          for (const key of config.tiebreakers) {
            const diff = compareBy(a, b, key, h2h);
            if (diff !== 0) return diff;
          }
          return String(a.name || '').localeCompare(String(b.name || ''));
        });
      }
      result.push(...group);
      index = end;
    }
    result.forEach((row, i) => { row.rank = i + 1; });
    return result;
  },

  /** 射手榜與紅黃牌統計（即時推導；walkover / bye 場次不計事件）。 */
  _computeTournamentScorerStats(matches, options = {}) {
    const nameById = options.nameById || {};
    const scorers = new Map();
    const cards = new Map();
    const keyOf = ev => ev.uid || `name:${ev.name}`;
    (Array.isArray(matches) ? matches : []).forEach(match => {
      if (!match || match.status !== 'finished') return;
      (match.events || []).forEach(ev => {
        if (!ev || !ev.teamId) return;
        const key = keyOf(ev);
        if (!key || key === 'name:') return;
        const display = ev.name || nameById[ev.uid] || ev.uid;
        if (ev.type === 'goal') {
          const row = scorers.get(key) || { uid: ev.uid || '', name: display, teamId: ev.teamId, goals: 0 };
          row.goals += 1;
          scorers.set(key, row);
        } else if (ev.type === 'yellow' || ev.type === 'red') {
          const row = cards.get(key) || { uid: ev.uid || '', name: display, teamId: ev.teamId, yellow: 0, red: 0 };
          row[ev.type === 'yellow' ? 'yellow' : 'red'] += 1;
          cards.set(key, row);
        }
      });
    });
    return {
      scorers: [...scorers.values()].sort((a, b) => (b.goals - a.goals) || String(a.name || '').localeCompare(String(b.name || ''))),
      cards: [...cards.values()].sort((a, b) => (b.red - a.red) || (b.yellow - a.yellow) || String(a.name || '').localeCompare(String(b.name || ''))),
    };
  },

});
