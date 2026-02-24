/* ================================================
   SportHub — Event: Detail View & Reviews
   依賴：event-list.js, config.js, api-service.js
   報名/取消邏輯已搬至 event-detail-signup.js
   ================================================ */

Object.assign(App, {

  // ══════════════════════════════════
  //  Show Event Detail
  // ══════════════════════════════════

  showEventDetail(id) {
    if (this._requireLogin()) return;
    const e = ApiService.getEvent(id);
    if (!e) return;
    this._currentDetailEventId = id;
    const detailImg = document.getElementById('detail-img-placeholder');
    if (detailImg) {
      if (e.image) {
        detailImg.innerHTML = `<img src="${e.image}" alt="${escapeHTML(e.title)}" loading="lazy" style="width:100%;height:100%;object-fit:cover;display:block;border-radius:var(--radius)">`;
        detailImg.style.border = 'none';
      } else {
        detailImg.textContent = '活動圖片 800 × 300';
        detailImg.style.border = '';
      }
    }
    document.getElementById('detail-title').innerHTML = escapeHTML(e.title) + ' ' + this._favHeartHtml(this.isEventFavorited(id), 'Event', id);

    const countdown = this._calcCountdown(e);
    const mapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(e.location)}`;
    const locationHtml = `<a href="${mapUrl}" target="_blank" rel="noopener" style="color:var(--primary);text-decoration:none">${escapeHTML(e.location)} 📍</a>`;

    const isEnded = e.status === 'ended' || e.status === 'cancelled';
    const isUpcoming = e.status === 'upcoming';
    const isMainFull = e.current >= e.max;
    // 防幽靈 UI 層：正式版 registrations 快取為空時視為「載入中」，不顯示報名按鈕
    const regsLoading = !ModeManager.isDemo() && FirebaseService._cache.registrations.length === 0 && !FirebaseService._initialized;
    const isSignedUp = regsLoading ? false : this._isUserSignedUp(e);
    const isOnWaitlist = isSignedUp && this._isUserOnWaitlist(e);
    let signupBtn = '';
    if (regsLoading) {
      signupBtn = `<button style="background:#64748b;color:#fff;padding:.55rem 1.2rem;border-radius:var(--radius);border:none;font-size:.85rem;cursor:not-allowed;opacity:.7" disabled>載入中…</button>`;
    } else if (isUpcoming) {
      signupBtn = `<button style="background:#64748b;color:#fff;padding:.55rem 1.2rem;border-radius:var(--radius);border:none;font-size:.85rem;cursor:not-allowed" disabled>報名尚未開放</button>`;
    } else if (isEnded) {
      signupBtn = `<button style="background:#333;color:#999;padding:.55rem 1.2rem;border-radius:var(--radius);border:none;font-size:.85rem;cursor:not-allowed" disabled>已結束</button>`;
    } else if (isOnWaitlist) {
      signupBtn = `<button style="background:#7c3aed;color:#fff;padding:.55rem 1.2rem;border-radius:var(--radius);border:none;font-size:.85rem;cursor:pointer" onclick="App.handleCancelSignup('${e.id}')">取消候補</button>`;
    } else if (isSignedUp) {
      signupBtn = `<button style="background:#dc2626;color:#fff;padding:.55rem 1.2rem;border-radius:var(--radius);border:none;font-size:.85rem;cursor:pointer" onclick="App.handleCancelSignup('${e.id}')">取消報名</button>`;
    } else if (isMainFull) {
      signupBtn = `<button style="background:#7c3aed;color:#fff;padding:.55rem 1.2rem;border-radius:var(--radius);border:none;font-size:.85rem;cursor:pointer" onclick="App.handleSignup('${e.id}')">報名候補</button>`;
    } else {
      signupBtn = `<button class="primary-btn" onclick="App.handleSignup('${e.id}')">立即報名</button>`;
    }

    const teamTag = e.teamOnly ? `<div class="detail-row"><span class="detail-label">限定</span><span style="color:#e11d48;font-weight:600">${escapeHTML(e.creatorTeamName || '球隊')} 專屬活動</span></div>` : '';

    const canScan = this._canManageEvent(e);
    const scanBtn = canScan
      ? `<button class="outline-btn" onclick="App.goToScanForEvent('${e.id}')">現場簽到</button>`
      : '';

    // 開放報名時間顯示
    let regOpenHtml = '';
    if (e.regOpenTime) {
      const regDate = new Date(e.regOpenTime);
      const regStr = `${regDate.getFullYear()}/${String(regDate.getMonth()+1).padStart(2,'0')}/${String(regDate.getDate()).padStart(2,'0')} ${String(regDate.getHours()).padStart(2,'0')}:${String(regDate.getMinutes()).padStart(2,'0')}`;
      if (isUpcoming) {
        const diff = regDate - new Date();
        const totalMin = Math.max(0, Math.floor(diff / 60000));
        const days = Math.floor(totalMin / 1440);
        const hours = Math.floor((totalMin % 1440) / 60);
        const countdownTxt = days > 0 ? `${days}日${hours}時後開放` : hours > 0 ? `${hours}時${totalMin % 60}分後開放` : `${totalMin}分後開放`;
        regOpenHtml = `<div class="detail-row"><span class="detail-label">開放報名</span><span style="color:var(--info);font-weight:600">${regStr}（${countdownTxt}）</span></div>`;
      } else {
        regOpenHtml = `<div class="detail-row"><span class="detail-label">開放報名</span>${regStr}（已開放）</div>`;
      }
    }

    document.getElementById('detail-body').innerHTML = `
      <div class="detail-row"><span class="detail-label">地點</span>${locationHtml}</div>
      <div class="detail-row"><span class="detail-label">時間</span>${escapeHTML(e.date)}</div>
      ${regOpenHtml}
      <div class="detail-row"><span class="detail-label">費用</span>${e.fee > 0 ? '$'+e.fee : '免費'}</div>
      <div class="detail-row"><span class="detail-label">人數</span>已報 ${e.current}/${e.max}${(e.waitlist || 0) > 0 ? '　候補 ' + e.waitlist : ''}</div>
      <div class="detail-row"><span class="detail-label">年齡</span>${e.minAge > 0 ? e.minAge + ' 歲以上' : '無限制'}</div>
      <div class="detail-row"><span class="detail-label">主辦</span><span class="participant-list" style="display:inline-flex;gap:.3rem;flex-wrap:wrap">${this._userTag(e.creator)}</span></div>
      ${(e.delegates && e.delegates.length) ? `<div class="detail-row"><span class="detail-label">委託</span><span class="participant-list" style="display:inline-flex;gap:.3rem;flex-wrap:wrap">${e.delegates.map(d => this._userTag(d.name)).join('')}</span></div>` : ''}
      ${e.contact ? `<div class="detail-row"><span class="detail-label">聯繫</span>${escapeHTML(e.contact)}</div>` : ''}
      ${teamTag}
      <div class="detail-row"><span class="detail-label">倒數</span><span style="color:${isEnded ? 'var(--text-muted)' : 'var(--primary)' };font-weight:600">${countdown}</span></div>
      ${this._renderHeatPrediction(e)}
      ${e.notes ? `
      <div class="detail-section">
        <div class="detail-section-title">注意事項</div>
        <p style="font-size:.85rem;color:var(--text-secondary);line-height:1.7;white-space:pre-wrap">${escapeHTML(e.notes)}</p>
      </div>` : ''}
      <div style="display:flex;gap:.5rem;margin:1rem 0;flex-wrap:wrap">
        ${signupBtn}
        <button class="outline-btn" onclick="App.contactEventOrganizer('${escapeHTML(e.creator)}')">聯繫主辦人</button>
        <button class="outline-btn" onclick="App.shareEvent('${e.id}')">分享活動</button>
        ${scanBtn}
      </div>
      <div class="detail-section">
        <div class="detail-section-title">報名名單 (${e.current})</div>
        <div id="detail-attendance-table"></div>
      </div>
      <div class="detail-section" id="detail-unreg-section" style="display:none">
        <div class="detail-section-title">未報名單 (<span id="detail-unreg-count">0</span>)</div>
        <div id="detail-unreg-table"></div>
      </div>
      ${this._buildGroupedWaitlist(e)}
      ${this._renderReviews(e)}
    `;
    this.showPage('page-activity-detail');
    this._renderAttendanceTable(id, 'detail-attendance-table');
    this._renderUnregTable(id, 'detail-unreg-table');
  },

  // ── 候補名單：按 userId 分組 + 混合資料支援 + 孤立同行者顯示 ──
  _buildGroupedWaitlist(e) {
    const allRegs = ApiService.getRegistrationsByEvent(e.id);
    const waitlistedRegs = allRegs.filter(r => r.status === 'waitlisted');
    const addedNames = new Set();
    let items = [];

    if (waitlistedRegs.length > 0) {
      const groups = new Map();
      waitlistedRegs.forEach(r => {
        if (!groups.has(r.userId)) groups.set(r.userId, []);
        groups.get(r.userId).push(r);
      });
      groups.forEach((regs, userId) => {
        const selfReg = regs.find(r => r.participantType === 'self');
        const companions = regs.filter(r => r.participantType === 'companion');
        const mainName = selfReg ? selfReg.userName : regs[0].userName;

        // 檢查孤立同行者：同行者在候補但報名人已正取
        const companionItems = companions.map(c => {
          const cName = c.companionName || c.userName;
          let orphanInfo = null;
          if (c.participantType === 'companion') {
            const selfConfirmed = allRegs.find(
              r => r.userId === userId && r.participantType === 'self' && r.status === 'confirmed'
            );
            if (selfConfirmed) {
              orphanInfo = selfConfirmed.userName;
            }
          }
          return { name: cName, orphanInfo };
        });

        // 如果沒有 selfReg（全是 companion），也檢查 self 是否已正取
        let selfOrphanInfo = null;
        if (!selfReg) {
          const selfConfirmed = allRegs.find(
            r => r.userId === userId && r.participantType === 'self' && r.status === 'confirmed'
          );
          if (selfConfirmed) selfOrphanInfo = selfConfirmed.userName;
        }

        items.push({ name: mainName, companions: companionItems, selfOrphanInfo });
        addedNames.add(mainName);
        companionItems.forEach(c => addedNames.add(c.name));
      });
    }
    // 混合資料：補上只在 e.waitlistNames 但沒有 registration 的舊成員
    (e.waitlistNames || []).forEach(p => {
      if (!addedNames.has(p)) {
        items.push({ name: p, companions: [], selfOrphanInfo: null });
        addedNames.add(p);
      }
    });

    if (items.length === 0) return '';
    const totalCount = items.reduce((sum, it) => sum + 1 + it.companions.length, 0);
    const COLLAPSE_LIMIT = 10;
    const needCollapse = items.length > COLLAPSE_LIMIT;
    const gridId = 'wl-grid-' + e.id;

    const renderItem = (item, idx) => {
      let h = `<div style="padding:.35rem 0">
        <div style="display:flex;align-items:center;gap:.3rem">
          <span class="wl-pos">${idx + 1}</span>
          ${this._userTag(item.name)}
        </div>`;
      if (item.selfOrphanInfo) {
        h += `<div style="padding:.1rem 0 0 1.8rem;font-size:.72rem;color:var(--text-muted)">↳ 報名人：${escapeHTML(item.selfOrphanInfo)}（<span style="color:var(--success)">已正取</span>）</div>`;
      }
      item.companions.forEach(c => {
        const cName = typeof c === 'string' ? c : c.name;
        const orphan = typeof c === 'object' ? c.orphanInfo : null;
        h += `<div style="padding:.15rem 0 0 1.8rem;font-size:.78rem;color:var(--text-secondary)">↳ ${escapeHTML(cName)}</div>`;
        if (orphan) {
          h += `<div style="padding:.1rem 0 0 2.4rem;font-size:.72rem;color:var(--text-muted)">↳ 報名人：${escapeHTML(orphan)}（<span style="color:var(--success)">已正取</span>）</div>`;
        }
      });
      h += '</div>';
      return h;
    };

    let gridItems = '';
    items.forEach((item, idx) => {
      const hidden = needCollapse && idx >= COLLAPSE_LIMIT ? ' style="display:none"' : '';
      gridItems += `<div class="wl-grid-item"${hidden}>${renderItem(item, idx)}</div>`;
    });

    const expandBtn = needCollapse
      ? `<div id="${gridId}-expand" style="text-align:center;margin-top:.4rem">
          <button class="outline-btn" style="font-size:.75rem;padding:.25rem .8rem" onclick="App._expandWaitlistGrid('${gridId}',${items.length})">展開全部候補 (${items.length})</button>
        </div>`
      : '';

    return `<div class="detail-section">
      <div class="detail-section-title">候補名單 (${totalCount})</div>
      <div id="${gridId}" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:0 .8rem">
        ${gridItems}
      </div>
      ${expandBtn}
    </div>`;
  },

  _expandWaitlistGrid(gridId, total) {
    const grid = document.getElementById(gridId);
    if (!grid) return;
    grid.querySelectorAll('.wl-grid-item').forEach(el => el.style.display = '');
    const btn = document.getElementById(gridId + '-expand');
    if (btn) btn.remove();
  },

  // ══════════════════════════════════
  //  Event Reviews
  // ══════════════════════════════════

  _reviewRating: 0,

  _renderStars(rating, interactive) {
    let html = '';
    for (let i = 1; i <= 5; i++) {
      const filled = i <= rating;
      if (interactive) {
        html += `<span class="review-star${filled ? ' active' : ''}" onclick="App._setReviewRating(${i})" style="cursor:pointer;font-size:1.3rem;color:${filled ? '#f59e0b' : 'var(--border)'};transition:color .15s">★</span>`;
      } else {
        html += `<span style="color:${filled ? '#f59e0b' : 'var(--border)'};font-size:.85rem">★</span>`;
      }
    }
    return html;
  },

  _setReviewRating(n) {
    this._reviewRating = n;
    const container = document.getElementById('review-stars-input');
    if (container) container.innerHTML = this._renderStars(n, true);
  },

  _renderReviews(e) {
    const reviews = e.reviews || [];
    const isEnded = e.status === 'ended';
    const user = ApiService.getCurrentUser?.();
    const uid = user?.uid || '';
    const name = user?.displayName || user?.name || '';
    const isParticipant = (e.participants || []).some(p => p === name || p === uid);
    const hasReviewed = reviews.some(r => r.uid === uid);

    // Calculate average
    let avgHtml = '';
    if (reviews.length > 0) {
      const avg = reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length;
      avgHtml = `<div style="display:flex;align-items:center;gap:.4rem;margin-bottom:.5rem">
        <span style="font-size:1.3rem;font-weight:800;color:#f59e0b">${avg.toFixed(1)}</span>
        ${this._renderStars(Math.round(avg), false)}
        <span style="font-size:.75rem;color:var(--text-muted)">(${reviews.length} 則評價)</span>
      </div>`;
    }

    // Review list
    const listHtml = reviews.map(r => `
      <div style="padding:.5rem 0;border-bottom:1px solid var(--border)">
        <div style="display:flex;align-items:center;gap:.4rem;margin-bottom:.2rem">
          ${this._userTag(r.name)}
          <span style="margin-left:auto">${this._renderStars(r.rating, false)}</span>
        </div>
        ${r.text ? `<div style="font-size:.82rem;color:var(--text-secondary);line-height:1.5;margin-top:.2rem">${escapeHTML(r.text)}</div>` : ''}
        <div style="font-size:.68rem;color:var(--text-muted);margin-top:.15rem">${escapeHTML(r.time)}</div>
      </div>
    `).join('');

    // Review form (only for ended events, participants who haven't reviewed)
    let formHtml = '';
    if (isEnded && isParticipant && !hasReviewed) {
      this._reviewRating = 0;
      formHtml = `
        <div style="border:1px solid var(--border);border-radius:var(--radius);padding:.6rem;margin-top:.5rem;background:var(--bg-elevated)">
          <div style="font-size:.82rem;font-weight:600;margin-bottom:.3rem">撰寫評價</div>
          <div id="review-stars-input" style="margin-bottom:.3rem">${this._renderStars(0, true)}</div>
          <textarea id="review-text" rows="2" maxlength="50" placeholder="分享您的心得（最多 50 字）" style="width:100%;font-size:.82rem;padding:.3rem .5rem;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg-card);color:var(--text-primary);resize:none;box-sizing:border-box"></textarea>
          <button class="primary-btn small" style="margin-top:.3rem" onclick="App.submitReview('${e.id}')">送出評價</button>
        </div>`;
    }

    return `
      <div class="detail-section">
        <div class="detail-section-title">活動評價</div>
        ${avgHtml}
        ${listHtml || '<div style="font-size:.82rem;color:var(--text-muted)">尚無評價</div>'}
        ${formHtml}
      </div>`;
  },

  submitReview(eventId) {
    const e = ApiService.getEvent(eventId);
    if (!e) return;
    if (this._reviewRating < 1) { this.showToast('請選擇星數'); return; }
    const text = (document.getElementById('review-text')?.value || '').trim();
    if (text.length > 50) { this.showToast('評語不可超過 50 字'); return; }
    const user = ApiService.getCurrentUser?.();
    const uid = user?.uid || '';
    const name = user?.displayName || user?.name || '';
    if (!e.reviews) e.reviews = [];
    if (e.reviews.some(r => r.uid === uid)) { this.showToast('您已評價過此活動'); return; }
    const now = new Date();
    const timeStr = `${now.getFullYear()}/${String(now.getMonth()+1).padStart(2,'0')}/${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    e.reviews.push({ uid, name, rating: this._reviewRating, text, time: timeStr });
    this._reviewRating = 0;
    this._grantAutoExp(uid, 'submit_review', e.title);
    this.showToast('評價已送出！');
    this.showEventDetail(eventId);
  },

});
