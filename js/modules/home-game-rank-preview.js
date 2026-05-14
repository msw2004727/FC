/* ================================================
   Home Game Rank Preview
   ================================================ */

Object.assign(App, {
  _homeGameRankPreviewSeq: 0,
  _homeGameRankPreviewUserCache: {},

  _getHomeGameRankMonthMeta(nowMs) {
    const baseMs = Number.isFinite(nowMs) ? nowMs : Date.now();
    const taipei = new Date(baseMs + 8 * 60 * 60 * 1000);
    const year = taipei.getUTCFullYear();
    const month = taipei.getUTCMonth() + 1;
    return {
      bucket: `monthly_${year}-${String(month).padStart(2, '0')}`,
      label: `${year}年${month}月榜`,
    };
  },

  _getHomeGameRankUid(row) {
    return String(row?.uid || row?.id || row?.userId || row?.lineUserId || '').trim();
  },

  _getHomeGameRankName(row) {
    const uid = this._getHomeGameRankUid(row);
    const value = String(row?.displayName || row?.nick || row?.nickname || row?.name || '').trim();
    if (value) return value;
    return uid ? `玩家${uid.slice(-4)}` : '玩家';
  },

  _pickHomeGameRankAvatarUrl(source) {
    if (!source || typeof source !== 'object') return '';
    const keys = ['pictureUrl', 'photoURL', 'avatarUrl', 'avatar', 'linePictureUrl', 'lineAvatarUrl', 'image', 'profileImage'];
    for (const key of keys) {
      const value = String(source[key] || '').trim();
      if (/^https?:\/\//i.test(value)) return value;
    }
    return '';
  },

  _findHomeGameRankCachedUser(uid) {
    if (!uid) return null;
    const fromRankCache = this._homeGameRankPreviewUserCache?.[uid];
    if (fromRankCache) return fromRankCache;

    const users = (typeof FirebaseService !== 'undefined' && Array.isArray(FirebaseService?._cache?.users))
      ? FirebaseService._cache.users
      : [];
    return users.find(user => {
      const ids = [user?.uid, user?.id, user?.lineUserId, user?._docId].map(v => String(v || '').trim());
      return ids.includes(uid);
    }) || null;
  },

  async _hydrateHomeGameRankUsers(rows) {
    if (!Array.isArray(rows) || !rows.length || typeof db === 'undefined') return;
    this._homeGameRankPreviewUserCache = this._homeGameRankPreviewUserCache || {};
    const uids = rows
      .map(row => this._getHomeGameRankUid(row))
      .filter(uid => uid && !Object.prototype.hasOwnProperty.call(this._homeGameRankPreviewUserCache, uid));
    if (!uids.length) return;

    await Promise.all(uids.slice(0, 8).map(async uid => {
      try {
        const snap = await db.collection('users').doc(uid).get();
        this._homeGameRankPreviewUserCache[uid] = snap.exists ? { id: snap.id, ...snap.data() } : null;
      } catch (_) {
        this._homeGameRankPreviewUserCache[uid] = null;
      }
    }));
  },

  _getHomeGameRankAvatarUrl(row) {
    const direct = this._pickHomeGameRankAvatarUrl(row);
    if (direct) return direct;
    const user = this._findHomeGameRankCachedUser(this._getHomeGameRankUid(row));
    return this._pickHomeGameRankAvatarUrl(user);
  },

  _getHomeGameRankInitial(name) {
    const text = String(name || '').trim();
    if (!text) return '?';
    return text.slice(0, 1).toUpperCase();
  },

  _getHomeGameRankScore(gameKey, row) {
    if (gameKey === 'kick-game') {
      const distance = Number(row?.bestDistance ?? row?.distance ?? row?.score ?? 0);
      if (!Number.isFinite(distance) || distance <= 0) return null;
      const value = distance >= 100 ? Math.round(distance) : Math.round(distance * 10) / 10;
      return { raw: distance, text: `${value}m` };
    }
    const score = Number(row?.bestScore ?? row?.score ?? 0);
    if (!Number.isFinite(score) || score <= 0) return null;
    return { raw: score, text: Math.round(score).toLocaleString('zh-TW') };
  },

  _normalizeHomeGameRankRows(gameKey, rows) {
    return (Array.isArray(rows) ? rows : [])
      .map(row => {
        const score = this._getHomeGameRankScore(gameKey, row);
        if (!score) return null;
        return {
          ...row,
          uid: this._getHomeGameRankUid(row),
          displayName: this._getHomeGameRankName(row),
          scoreRaw: score.raw,
          scoreText: score.text,
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.scoreRaw - a.scoreRaw)
      .slice(0, 4);
  },

  _createHomeGameRankAvatar(row) {
    const name = row?.displayName || '';
    const avatarUrl = this._getHomeGameRankAvatarUrl(row);
    if (avatarUrl) {
      const img = document.createElement('img');
      img.className = 'home-game-rank-avatar';
      img.src = avatarUrl;
      img.alt = '';
      img.loading = 'lazy';
      img.referrerPolicy = 'no-referrer';
      img.onerror = () => {
        const fallback = document.createElement('span');
        fallback.className = 'home-game-rank-avatar';
        fallback.textContent = this._getHomeGameRankInitial(name);
        img.replaceWith(fallback);
      };
      return img;
    }
    const fallback = document.createElement('span');
    fallback.className = 'home-game-rank-avatar';
    fallback.textContent = this._getHomeGameRankInitial(name);
    return fallback;
  },

  _renderHomeGameRankPreview(gameKey, rows, meta) {
    const previewId = gameKey === 'kick-game' ? 'home-game-rank-kick' : 'home-game-rank-shot';
    const preview = document.getElementById(previewId);
    const card = preview?.closest?.('.home-game-card');
    if (!preview || !card) return;

    preview.textContent = '';
    preview.hidden = false;
    card.classList.add('has-rank-preview');

    if (!rows.length) {
      const empty = document.createElement('span');
      empty.className = 'home-game-rank-empty';
      empty.textContent = `${meta.label} 等你上榜`;
      preview.appendChild(empty);
      return;
    }

    const head = document.createElement('div');
    head.className = 'home-game-rank-head';
    const month = document.createElement('span');
    month.className = 'home-game-rank-month';
    month.textContent = meta.label;
    const top = document.createElement('span');
    top.className = 'home-game-rank-top';
    top.textContent = 'TOP4';
    head.append(month, top);

    const list = document.createElement('div');
    list.className = 'home-game-rank-list';
    rows.forEach((row, index) => {
      const rank = index + 1;
      const pill = document.createElement('span');
      pill.className = 'home-game-rank-pill';
      const badge = document.createElement('span');
      badge.className = `home-game-rank-badge rank-${rank}`;
      badge.textContent = String(rank);
      const name = document.createElement('span');
      name.className = 'home-game-rank-name';
      name.textContent = row.displayName;
      const score = document.createElement('span');
      score.className = 'home-game-rank-score';
      score.textContent = row.scoreText;
      pill.append(badge, this._createHomeGameRankAvatar(row), name, score);
      list.appendChild(pill);
    });

    preview.append(head, list);
  },

  async _loadHomeGameRankPreview(gameKey, meta) {
    const methodName = gameKey === 'kick-game' ? 'getKickGameLeaderboard' : 'getShotGameLeaderboard';
    if (typeof ApiService === 'undefined' || typeof ApiService[methodName] !== 'function') return [];
    const rawRows = await ApiService[methodName]({ period: 'monthly', bucket: meta.bucket, limit: 4 });
    let rows = this._normalizeHomeGameRankRows(gameKey, rawRows);
    await this._hydrateHomeGameRankUsers(rows);
    rows = this._normalizeHomeGameRankRows(gameKey, rows);
    return rows;
  },

  _scheduleHomeGameRankPreview({ shotAvailable, kickAvailable } = {}) {
    const seq = ++this._homeGameRankPreviewSeq;
    const run = () => {
      if (seq !== this._homeGameRankPreviewSeq) return;
      const meta = this._getHomeGameRankMonthMeta();
      const tasks = [];
      if (shotAvailable) {
        tasks.push(this._loadHomeGameRankPreview('shot-game', meta)
          .then(rows => { if (seq === this._homeGameRankPreviewSeq) this._renderHomeGameRankPreview('shot-game', rows, meta); })
          .catch(() => {}));
      }
      if (kickAvailable) {
        tasks.push(this._loadHomeGameRankPreview('kick-game', meta)
          .then(rows => { if (seq === this._homeGameRankPreviewSeq) this._renderHomeGameRankPreview('kick-game', rows, meta); })
          .catch(() => {}));
      }
      void Promise.all(tasks);
    };

    if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(run, { timeout: 1200 });
    } else {
      setTimeout(run, 80);
    }
  },
});
