/* ================================================
   SportHub Achievement Badge Helpers
   Shared badge lookup and rendering helpers for
   profile-facing pages during the folder refactor.
   ================================================ */

Object.assign(App, {

  _buildAchievementBadges() {
    const getStats = () => App._getAchievementStats?.();

    const getEarnedBadgeViewModels = (achievements, badges) => {
      return getStats()?.getEarnedBadgeViewModels?.(achievements, badges) || [];
    };

    const getBadgeCount = (achievements, badges) => {
      return getStats()?.getBadgeCount?.(achievements, badges)
        || getEarnedBadgeViewModels(achievements, badges).length;
    };

    const getCurrentUserBadgeCount = () => {
      return getBadgeCount(
        ApiService.getAchievements?.() || [],
        ApiService.getBadges?.() || []
      );
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
      return buildBadgeListHtml(getEarnedBadgeViewModels(achievements, badges), options);
    };

    return {
      getEarnedBadgeViewModels,
      getBadgeCount,
      getCurrentUserBadgeCount,
      buildBadgeListHtml,
      buildEarnedBadgeListHtml,
    };
  },

});

App._registerAchievementPart('badges', App._buildAchievementBadges());
