/* ================================================
   SportHub — Event: Detail View, Reviews, Signup
   依賴：event-list.js, config.js, api-service.js
   ================================================ */

Object.assign(App, {

  // ══════════════════════════════════
  //  Show Event Detail
  // ══════════════════════════════════

  showEventDetail(id) {
    if (this._requireLogin()) return;
    const e = ApiService.getEvent(id);
    if (!e) return;
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
    const isSignedUp = this._isUserSignedUp(e);
    const isOnWaitlist = isSignedUp && this._isUserOnWaitlist(e);
    let signupBtn = '';
    if (isUpcoming) {
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
        <button class="outline-btn" onclick="App.showUserProfile('${escapeHTML(e.creator)}')">聯繫主辦人</button>
        <button class="outline-btn" onclick="App.shareEvent('${e.id}')">分享活動</button>
      </div>
      <div class="detail-section">
        <div class="detail-section-title">報名名單 (${e.current})</div>
        <div class="participant-list">${this._buildGroupedParticipants(e)}</div>
      </div>
      ${this._buildGroupedWaitlist(e)}
      ${this._renderReviews(e)}
    `;
    this.showPage('page-activity-detail');
  },

  // ── 報名名單：按 userId 分組（有 registrations 時）──
  _buildGroupedParticipants(e) {
    const confirmedRegs = ApiService.getRegistrationsByEvent(e.id).filter(r => r.status === 'confirmed');
    if (confirmedRegs.length === 0) {
      // fallback: 舊資料，扁平顯示
      return (e.participants || []).map(p => this._userTag(p)).join('');
    }
    const groups = new Map();
    confirmedRegs.forEach(r => {
      if (!groups.has(r.userId)) groups.set(r.userId, []);
      groups.get(r.userId).push(r);
    });
    let html = '';
    groups.forEach(regs => {
      const selfReg = regs.find(r => r.participantType === 'self');
      const companions = regs.filter(r => r.participantType === 'companion');
      const mainName = selfReg ? selfReg.userName : regs[0].userName;
      html += `<div style="display:flex;align-items:center;gap:.3rem;flex-wrap:wrap">${this._userTag(mainName)}`;
      companions.forEach(c => {
        const cName = c.companionName || c.userName;
        html += `<span style="font-size:.72rem;color:var(--text-muted)">↳</span><span class="user-capsule uc-user" style="opacity:.8;font-size:.78rem">${escapeHTML(cName)}</span>`;
      });
      html += '</div>';
    });
    return html;
  },

  // ── 候補名單：按 userId 分組（有 registrations 時）──
  _buildGroupedWaitlist(e) {
    const allRegs = ApiService.getRegistrationsByEvent(e.id);
    const waitlistedRegs = allRegs.filter(r => r.status === 'waitlisted');
    if (waitlistedRegs.length > 0) {
      const groups = new Map();
      waitlistedRegs.forEach(r => {
        if (!groups.has(r.userId)) groups.set(r.userId, []);
        groups.get(r.userId).push(r);
      });
      let html = '<div class="detail-section"><div class="detail-section-title">候補名單 (' + waitlistedRegs.length + ')</div><div class="participant-list">';
      let idx = 0;
      groups.forEach(regs => {
        const selfReg = regs.find(r => r.participantType === 'self');
        const companions = regs.filter(r => r.participantType === 'companion');
        const mainName = selfReg ? selfReg.userName : regs[0].userName;
        idx++;
        html += `<span class="wl-pos">${idx}</span>${this._userTag(mainName)}`;
        companions.forEach(c => {
          html += `<span style="font-size:.72rem;color:var(--text-muted)">↳</span><span class="user-capsule uc-user" style="opacity:.8;font-size:.78rem">${escapeHTML(c.companionName || c.userName)}</span>`;
        });
      });
      html += '</div></div>';
      return html;
    }
    // fallback: 舊資料
    if ((e.waitlistNames || []).length > 0) {
      return `<div class="detail-section">
        <div class="detail-section-title">候補名單 (${e.waitlist})</div>
        <div class="participant-list">${e.waitlistNames.map((p, i) => `<span class="wl-pos">${i + 1}</span>${this._userTag(p)}`).join('')}</div>
      </div>`;
    }
    return '';
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

  // ══════════════════════════════════
  //  Signup & Cancel
  // ══════════════════════════════════

  /** 恢復報名時移除該活動的取消紀錄（恢復報名則不列為取消） */
  _removeCancelRecordOnResignup(eventId, uid) {
    const source = ApiService._src('activityRecords');
    for (let i = source.length - 1; i >= 0; i--) {
      if (source[i].eventId === eventId && source[i].uid === uid && source[i].status === 'cancelled') {
        if (!ModeManager.isDemo() && source[i]._docId) {
          db.collection('activityRecords').doc(source[i]._docId).delete()
            .catch(err => console.error('[removeCancelRecord]', err));
        }
        source.splice(i, 1);
      }
    }
  },

  handleSignup(id) {
    const e = ApiService.getEvent(id);
    if (!e) return;
    if (e.status === 'upcoming') { this.showToast('報名尚未開放，請稍後再試'); return; }
    const user = ApiService.getCurrentUser();
    const userName = user?.displayName || user?.name || '用戶';
    const userId = user?.uid || 'unknown';

    // 恢復報名 → 移除之前的取消紀錄
    this._removeCancelRecordOnResignup(id, userId);

    if (ApiService._demoMode) {
      // 檢查是否已報名
      if (this._isUserSignedUp(e)) {
        this.showToast('您已報名此活動');
        return;
      }
      const isWaitlist = e.current >= e.max;
      if (isWaitlist) {
        if (!e.waitlistNames) e.waitlistNames = [];
        if (!e.waitlistNames.includes(userName)) e.waitlistNames.push(userName);
        e.waitlist = (e.waitlist || 0) + 1;
        // 安全移除：確保不在正取名單
        const pi = (e.participants || []).indexOf(userName);
        if (pi >= 0) { e.participants.splice(pi, 1); e.current = Math.max(0, e.current - 1); }
      } else {
        if (!e.participants) e.participants = [];
        if (!e.participants.includes(userName)) e.participants.push(userName);
        e.current++;
        // 安全移除：確保不在候補名單
        const wi = (e.waitlistNames || []).indexOf(userName);
        if (wi >= 0) { e.waitlistNames.splice(wi, 1); e.waitlist = Math.max(0, (e.waitlist || 0) - 1); }
      }
      // 正取滿即標記為 full
      if (e.current >= e.max) e.status = 'full';
      // 寫入報名紀錄
      const dateParts = e.date.split(' ')[0].split('/');
      const dateStr = `${dateParts[1]}/${dateParts[2]}`;
      ApiService.addActivityRecord({
        eventId: e.id,
        name: e.title,
        date: dateStr,
        status: isWaitlist ? 'waitlisted' : 'registered',
        uid: userId,
      });
      this.showToast(isWaitlist ? '已加入候補名單' : '報名成功！');
      if (!isWaitlist) this._grantAutoExp(userId, 'register_activity', e.title);
      // Trigger 2：報名成功通知
      this._sendNotifFromTemplate('signup_success', {
        eventName: e.title, date: e.date, location: e.location,
        status: isWaitlist ? '候補' : '正取',
      }, userId, 'activity', '活動');
      this.showEventDetail(id);
      return;
    }

    FirebaseService.registerForEvent(id, userId, userName)
      .then(result => {
        const dateParts = e.date.split(' ')[0].split('/');
        const dateStr = `${dateParts[1]}/${dateParts[2]}`;
        ApiService.addActivityRecord({
          eventId: e.id,
          name: e.title,
          date: dateStr,
          status: result.status === 'waitlisted' ? 'waitlisted' : 'registered',
          uid: userId,
        });
        // 同步寫入 Firestore activityRecords
        db.collection('activityRecords').add({
          eventId: e.id, name: e.title, date: dateStr,
          status: result.status === 'waitlisted' ? 'waitlisted' : 'registered',
          uid: userId,
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        }).catch(err => console.error('[activityRecord]', err));
        // Trigger 2：報名成功通知
        this._sendNotifFromTemplate('signup_success', {
          eventName: e.title, date: e.date, location: e.location,
          status: result.status === 'waitlisted' ? '候補' : '正取',
        }, userId, 'activity', '活動');
        this.showToast(result.status === 'waitlisted' ? '已加入候補名單' : '報名成功！');
        this.showEventDetail(id);
      })
      .catch(err => {
        console.error('[handleSignup]', err);
        this.showToast(err.message || '報名失敗，請稍後再試');
      });
  },

  async handleCancelSignup(id) {
    const e0 = ApiService.getEvent(id);
    const isWaitlist = e0 && this._isUserOnWaitlist(e0);
    const confirmMsg = isWaitlist ? '確定要取消候補？' : '確定要取消報名？';
    if (!await this.appConfirm(confirmMsg)) return;
    const user = ApiService.getCurrentUser();
    const userName = user?.displayName || user?.name || '用戶';
    const userId = user?.uid || 'unknown';

    if (ApiService._demoMode) {
      const e = ApiService.getEvent(id);
      if (e) {
        const pi = (e.participants || []).indexOf(userName);
        if (pi !== -1) {
          e.participants.splice(pi, 1);
          e.current = Math.max(0, e.current - 1);
          if (e.waitlistNames && e.waitlistNames.length > 0) {
            const promoted = e.waitlistNames.shift();
            e.waitlist = Math.max(0, e.waitlist - 1);
            // 確保遞補者不會重複出現在正取名單
            if (!e.participants.includes(promoted)) {
              e.participants.push(promoted);
              e.current++;
            }
            // Trigger 3：候補遞補通知
            const adminUsers = ApiService.getAdminUsers();
            const promotedUser = adminUsers.find(u => u.name === promoted);
            if (promotedUser) {
              this._sendNotifFromTemplate('waitlist_promoted', {
                eventName: e.title, date: e.date, location: e.location,
              }, promotedUser.uid, 'activity', '活動');
            }
          }
          e.status = e.current >= e.max ? 'full' : 'open';
        } else {
          const wi = (e.waitlistNames || []).indexOf(userName);
          if (wi !== -1) {
            e.waitlistNames.splice(wi, 1);
            e.waitlist = Math.max(0, e.waitlist - 1);
          }
        }
        // 更新報名紀錄：移除 registered/waitlisted 紀錄，確保只留一筆取消紀錄
        const records = ApiService.getActivityRecords();
        const hasCancelRecord = records.some(r => r.eventId === id && r.uid === userId && r.status === 'cancelled');
        // 移除現有的非取消紀錄
        for (let i = records.length - 1; i >= 0; i--) {
          if (records[i].eventId === id && records[i].uid === userId && records[i].status !== 'cancelled') {
            records.splice(i, 1);
          }
        }
        // 若尚無取消紀錄，新增一筆
        if (!hasCancelRecord) {
          const dateParts = e.date.split(' ')[0].split('/');
          const dateStr = `${dateParts[1]}/${dateParts[2]}`;
          ApiService.addActivityRecord({ eventId: id, name: e.title, date: dateStr, status: 'cancelled', uid: userId });
        }
      }
      this.showToast(isWaitlist ? '已取消候補' : '已取消報名');
      if (!isWaitlist) this._grantAutoExp(userId, 'cancel_registration', e.title);
      this.showEventDetail(id);
      return;
    }

    // 正式版：從 registrations 快取找到該筆報名紀錄，呼叫 cancelRegistration
    const reg = FirebaseService._cache.registrations.find(
      r => r.eventId === id && r.userId === userId && r.status !== 'cancelled'
    );
    if (reg) {
      FirebaseService.cancelRegistration(reg.id)
        .then((cancelledReg) => {
          // Trigger 3：候補遞補通知（Firebase 模式）
          if (cancelledReg && cancelledReg._promotedUserId) {
            const ev = ApiService.getEvent(id);
            if (ev) {
              this._sendNotifFromTemplate('waitlist_promoted', {
                eventName: ev.title, date: ev.date, location: ev.location,
              }, cancelledReg._promotedUserId, 'activity', '活動');
            }
          }
          // 更新 activityRecords：移除 registered/waitlisted，確保只留一筆取消紀錄
          const records = ApiService.getActivityRecords();
          const hasCancelRec = records.some(r => r.eventId === id && r.uid === userId && r.status === 'cancelled');
          for (let i = records.length - 1; i >= 0; i--) {
            if (records[i].eventId === id && records[i].uid === userId && records[i].status !== 'cancelled') {
              if (records[i]._docId) {
                db.collection('activityRecords').doc(records[i]._docId).update({ status: 'cancelled' })
                  .catch(err => console.error('[activityRecord cancel]', err));
              }
              if (hasCancelRec) {
                // 已有取消紀錄，直接移除此筆
                if (records[i]._docId) {
                  db.collection('activityRecords').doc(records[i]._docId).delete().catch(err => console.error('[activityRecord dedup]', err));
                }
                records.splice(i, 1);
              } else {
                records[i].status = 'cancelled';
              }
            }
          }
          if (!hasCancelRec && !records.some(r => r.eventId === id && r.uid === userId && r.status === 'cancelled')) {
            const ev = ApiService.getEvent(id);
            if (ev) {
              const dp = ev.date.split(' ')[0].split('/');
              ApiService.addActivityRecord({ eventId: id, name: ev.title, date: `${dp[1]}/${dp[2]}`, status: 'cancelled', uid: userId });
            }
          }
          this.showToast(isWaitlist ? '已取消候補' : '已取消報名');
          this.showEventDetail(id);
        })
        .catch(err => { console.error('[cancelSignup]', err); this.showToast('取消失敗：' + (err.message || '')); });
    } else {
      // 如果 registrations 沒找到，嘗試直接從 event participants 移除
      const e = ApiService.getEvent(id);
      if (e) {
        const pi = (e.participants || []).indexOf(userName);
        if (pi !== -1) {
          e.participants.splice(pi, 1);
          e.current = Math.max(0, e.current - 1);
          if (e._docId) {
            db.collection('events').doc(e._docId).update({
              current: e.current, participants: e.participants,
            }).catch(err => console.error('[cancelSignup fallback]', err));
          }
        }
      }
      this.showToast(isWaitlist ? '已取消候補' : '已取消報名');
      this.showEventDetail(id);
    }
  },

});
