/* ================================================
   SportHub Achievement Badge Helpers
   Shared badge lookup and rendering helpers for
   profile-facing pages during the folder refactor.
   ================================================ */

Object.assign(App, {

  _buildAchievementBadges() {
    const getStats = () => App._getAchievementStats?.();
    const getEvaluator = () => App._getAchievementEvaluator?.();

    const getEvaluatedAchievementsForUser = (user) => {
      const safeUser = user || ApiService.getCurrentUser?.() || null;
      return getEvaluator()?.getEvaluatedAchievements?.({
        targetUser: safeUser,
        targetUid: safeUser?.uid || safeUser?._docId,
      }) || (ApiService.getAchievements?.() || []);
    };

    /**
     * 異步版：支援讀取其他用戶的成就進度（從 Firestore 子集合）
     * 當前用戶 → 走快取（同步）；其他用戶 → async 讀子集合
     */
    const getEvaluatedAchievementsForUserAsync = async (user) => {
      const safeUser = user || ApiService.getCurrentUser?.() || null;
      const targetUid = safeUser?.uid || safeUser?._docId;
      const currentUser = ApiService.getCurrentUser?.() || null;
      const currentUid = currentUser?.uid || currentUser?._docId;

      // 當前用戶：走同步路徑（快取已載入）
      if (!targetUid || targetUid === currentUid) {
        return getEvaluatedAchievementsForUser(safeUser);
      }

      // 其他用戶：從子集合讀取 per-user 進度
      const achievements = (ApiService.getAchievements?.() || []).filter(Boolean);
      if (!achievements.length) return [];

      let perUserProgress = [];
      if (typeof FirebaseService !== 'undefined' && typeof FirebaseService.loadUserAchievementProgress === 'function') {
        try {
          perUserProgress = await FirebaseService.loadUserAchievementProgress(targetUid);
        } catch (_) { /* fallback to template */ }
      }

      if (!perUserProgress.length) {
        // 沒有 per-user 資料 → 回傳模板（current: 0, completedAt: null）
        return achievements.map(a => ({ ...a }));
      }

      const progressMap = new Map();
      perUserProgress.forEach(r => {
        const achId = r.achId || r._docId;
        if (achId) progressMap.set(achId, r);
      });

      return achievements.map(a => {
        const perUser = progressMap.get(a.id);
        if (perUser && perUser.completedAt) {
          return { ...a, current: perUser.current || 0, completedAt: perUser.completedAt };
        }
        return { ...a };
      });
    };

    const getEarnedBadgeViewModels = (achievements, badges) => {
      return getStats()?.getEarnedBadgeViewModels?.(achievements, badges) || [];
    };

    const getBadgeCount = (achievements, badges) => {
      return getStats()?.getBadgeCount?.(achievements, badges)
        || getEarnedBadgeViewModels(achievements, badges).length;
    };

    const getCurrentUserEarnedBadgeViewModels = () => {
      return getEarnedBadgeViewModels(
        getEvaluatedAchievementsForUser(ApiService.getCurrentUser?.() || null),
        ApiService.getBadges?.() || []
      );
    };

    const getCurrentUserBadgeCount = () => {
      return getCurrentUserEarnedBadgeViewModels().length;
    };

    const buildBadgeListHtml = (earnedBadges, options = {}) => {
      const items = Array.isArray(earnedBadges) ? earnedBadges : [];
      const listClass = options.listClass || 'uc-badge-list';
      const itemClass = options.itemClass || 'uc-badge-item';
      const nameClass = options.nameClass || 'uc-badge-name';
      const placeholderClass = options.placeholderClass || 'badge-img-placeholder';
      const emptyText = options.emptyText || '尚未獲得徽章';
      const imageFallbackHtml = options.imageFallbackHtml || '';
      const useCategoryBorder = options.useCategoryBorder === true;

      if (!items.length) {
        return `<div style="font-size:.82rem;color:var(--text-muted)">${escapeHTML(emptyText)}</div>`;
      }

      return `<div class="${escapeHTML(listClass)}">${items.map(item => {
        const badge = item?.badge || {};
        const borderStyle = useCategoryBorder && item?.color
          ? ` style="border-color:${escapeHTML(item.color)}"`
          : '';
        const imageHtml = badge.image
          ? `<img src="${escapeHTML(badge.image)}" alt="${escapeHTML(badge.name || '')}" loading="lazy">`
          : imageFallbackHtml;

        return `<div class="${escapeHTML(itemClass)}">
          <div class="${escapeHTML(placeholderClass)}"${borderStyle}>${imageHtml}</div>
          <span class="${escapeHTML(nameClass)}">${escapeHTML(badge.name || '')}</span>
        </div>`;
      }).join('')}</div>`;
    };

    const buildEarnedBadgeListHtml = (achievements, badges, options = {}) => {
      const sourceAchievements = Array.isArray(achievements)
        ? achievements
        : getEvaluatedAchievementsForUser(ApiService.getCurrentUser?.() || null);
      const sourceBadges = Array.isArray(badges) ? badges : (ApiService.getBadges?.() || []);
      return buildBadgeListHtml(getEarnedBadgeViewModels(sourceAchievements, sourceBadges), options);
    };

    return {
      getEvaluatedAchievementsForUser,
      getEvaluatedAchievementsForUserAsync,
      getEarnedBadgeViewModels,
      getBadgeCount,
      getCurrentUserEarnedBadgeViewModels,
      getCurrentUserBadgeCount,
      buildBadgeListHtml,
      buildEarnedBadgeListHtml,
    };
  },

});

App._registerAchievementPart('badges', App._buildAchievementBadges());
