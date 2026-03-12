/* ================================================
   SportHub Achievement View Helpers
   Renders the public achievement page while the
   legacy App.renderAchievements facade stays stable.
   ================================================ */

Object.assign(App, {

  _buildAchievementView() {
    const renderAchievements = () => {
      const container = document.getElementById('achievement-grid');
      if (!container) return;

      const evaluator = App._getAchievementEvaluator?.();
      const stats = App._getAchievementStats?.();
      const shared = App._getAchievementShared?.();
      const currentUser = ApiService.getCurrentUser?.() || null;
      const allAchievements = evaluator?.getEvaluatedAchievements?.({
        targetUser: currentUser,
        targetUid: currentUser?.uid || currentUser?._docId,
      }) || (ApiService.getAchievements?.() || []);
      const badges = ApiService.getBadges?.() || [];
      const activeAchievements = stats?.getActiveAchievements?.(allAchievements)
        || allAchievements.filter(achievement => achievement?.status !== 'archived');
      const sorted = App._sortByCat?.(activeAchievements) || activeAchievements;
      const pending = stats?.getPendingAchievements?.(sorted)
        || sorted.filter(achievement => (achievement?.current || 0) < (App._getAchThreshold?.(achievement) || 1));
      const completed = stats?.getCompletedAchievements?.(sorted)
        || sorted.filter(achievement => (achievement?.current || 0) >= (App._getAchThreshold?.(achievement) || 1));

      const earnedBadges = stats?.getEarnedBadgeViewModels?.(sorted, badges)
        || completed.map(achievement => {
          const badge = badges.find(item => item.id === achievement.badgeId);
          if (!badge) return null;
          const color = App._catColors?.[achievement.category] || '#b87333';
          return { badge, color, achievement, achName: achievement.name };
        }).filter(Boolean);

      const renderCard = (achievement) => {
        const threshold = App._getAchThreshold?.(achievement) || 1;
        const done = stats?.isCompleted?.(achievement) ?? ((achievement?.current || 0) >= threshold);
        const pct = threshold > 0 ? Math.min(100, Math.round(((achievement?.current || 0) / threshold) * 100)) : 0;
        const badge = badges.find(item => item.id === achievement.badgeId);
        const badgeImg = badge?.image
          ? `<img src="${escapeHTML(badge.image)}" alt="${escapeHTML(badge.name)}" loading="lazy">`
          : `<span style="font-size:1.2rem;color:var(--text-muted)">🏅</span>`;
        const desc = App._generateConditionDesc?.(achievement.condition, achievement.desc) || '未設定成就條件';
        const catColor = shared?.getCategoryColor?.(achievement.category) || App._catColors?.[achievement.category] || '#b87333';
        const catLabel = shared?.getCategoryLabel?.(achievement.category) || App._catLabels?.[achievement.category] || '銅';

        return `
      <div class="ach-card ${done ? 'ach-card-done' : ''}" style="border-color:${catColor}">
        <div class="ach-card-badge ${done ? '' : 'ach-badge-gray'}">
          ${badgeImg}
          ${done ? '<div class="ach-card-done-overlay">已完成</div>' : ''}
        </div>
        <div class="ach-card-body">
          <div class="ach-card-top">
            <span class="ach-cat-chip ach-cat-${achievement.category}">${catLabel}</span>
            <span class="ach-card-name">${escapeHTML(achievement.name)}</span>
          </div>
          <div class="ach-card-desc">${escapeHTML(desc)}</div>
          ${done
            ? `<div class="ach-card-completed-date">${achievement.completedAt ? escapeHTML(achievement.completedAt) : ''}</div>`
            : `<div class="ach-card-progress">
                <div class="ach-bar-mini"><div class="ach-bar-fill" style="width:${pct}%"></div></div>
                <span class="ach-card-num">${achievement.current}/${threshold}</span>
              </div>`
          }
        </div>
      </div>`;
      };

      let html = '';
      if (earnedBadges.length) {
        html += '<div class="ach-section-title">已獲得徽章</div>';
        html += '<div class="ach-badge-showcase">' + earnedBadges.map(({ badge }) => `
          <div class="ach-showcase-item">
            <div class="ach-showcase-img">${badge.image ? `<img src="${escapeHTML(badge.image)}" loading="lazy">` : '<span>🏅</span>'}</div>
            <span class="ach-showcase-name">${escapeHTML(badge.name)}</span>
          </div>
        `).join('') + '</div>';
        html += '<div class="ach-divider"></div>';
      }

      if (pending.length) {
        html += '<div class="ach-section-title">進行中</div>';
        html += '<div class="ach-card-grid">' + pending.map(renderCard).join('') + '</div>';
      }

      if (pending.length && completed.length) {
        html += '<div class="ach-divider"></div>';
      }

      if (completed.length) {
        html += '<div class="ach-section-title">已完成</div>';
        html += '<div class="ach-card-grid">' + completed.map(renderCard).join('') + '</div>';
      }

      if (!pending.length && !completed.length) {
        html = '<div style="text-align:center;padding:2rem;color:var(--text-muted);font-size:.85rem">尚無成就</div>';
      }

      container.innerHTML = html;
    };

    return {
      renderAchievements,
    };
  },

});

App._registerAchievementPart('view', App._buildAchievementView());
