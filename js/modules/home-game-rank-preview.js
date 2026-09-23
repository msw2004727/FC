/* ================================================
   Home Game Rank Preview
   ================================================ */

Object.assign(App, {
  _homeGameRankPreviewSeq: { 'shot-game': 0, 'kick-game': 0 },
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
    const preview = this._getHomeGameRankPreviewParts(gameKey)?.preview;
    if (!preview) return;

    preview.textContent = '';
    preview.hidden = false;
    delete preview.dataset.loading;
    preview.dataset.bucket = meta.bucket;

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
    list.setAttribute('role', 'list');
    rows.forEach((row, index) => {
      const rank = index + 1;
      const pill = document.createElement('span');
      pill.className = 'home-game-rank-pill';
      pill.setAttribute('role', 'listitem');
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
    if (typeof ApiService === 'undefined' || typeof ApiService[methodName] !== 'function') {
      throw new Error('Leaderboard API unavailable');
    }
    const rawRows = await ApiService[methodName]({ period: 'monthly', bucket: meta.bucket, limit: 4, throwOnError: true });
    let rows = this._normalizeHomeGameRankRows(gameKey, rawRows);
    await this._hydrateHomeGameRankUsers(rows);
    rows = this._normalizeHomeGameRankRows(gameKey, rows);
    return rows;
  },

  async loadHomeGameRankPreview(gameKey) {
    const parts = this._getHomeGameRankPreviewParts(gameKey);
    const button = parts?.button;
    const preview = parts?.preview;
    const card = parts?.card;
    if (!button || !preview || !card || button.disabled || button.style.display === 'none'
      || card.style.display === 'none' || this.currentPage !== 'page-home'
      || this._isHomeGameVisible?.(gameKey) === false) {
      return { ok: false, reason: 'unavailable' };
    }

    const meta = this._getHomeGameRankMonthMeta();
    const seq = ++this._homeGameRankPreviewSeq[gameKey];
    const authUid = typeof auth !== 'undefined' ? String(auth?.currentUser?.uid || '') : '';
    const stillCurrent = () => seq === this._homeGameRankPreviewSeq[gameKey]
      && this.currentPage === 'page-home'
      && this._getHomeGameRankMonthMeta().bucket === meta.bucket
      && this._isHomeGameVisible?.(gameKey) !== false
      && (typeof auth !== 'undefined' ? String(auth?.currentUser?.uid || '') : '') === authUid
      && button.isConnected && preview.isConnected && button.style.display !== 'none' && card.style.display !== 'none';

    this._startHomeGameRankLoading(parts);
    try {
      const rows = await this._loadHomeGameRankPreview(gameKey, meta);
      if (!stillCurrent()) return { ok: false, reason: 'stale' };
      this._renderHomeGameRankPreview(gameKey, rows, meta);
      button.textContent = '更新本月排行';
      button.setAttribute('aria-label', `更新${parts.gameName}本月排行`);
      button.setAttribute('aria-expanded', 'true');
      return { ok: true };
    } catch (_) {
      if (!stillCurrent()) return { ok: false, reason: 'stale' };
      preview.textContent = '排行暫時無法載入，請重試';
      preview.hidden = false;
      delete preview.dataset.loading;
      delete preview.dataset.bucket;
      button.textContent = '重試載入本月排行';
      button.setAttribute('aria-label', `重試載入${parts.gameName}本月排行`);
      button.setAttribute('aria-expanded', 'true');
      return { ok: false, reason: 'error' };
    } finally {
      if (seq === this._homeGameRankPreviewSeq[gameKey]) {
        button.disabled = false;
        button.removeAttribute('aria-busy');
        preview.removeAttribute('aria-busy');
        if (!stillCurrent() && button.textContent === '載入中…') {
          this._clearHomeGameRankLoading(parts);
          button.textContent = '查看本月排行';
          button.setAttribute('aria-label', `查看${parts.gameName}本月排行`);
        }
      }
    }
  },
});
