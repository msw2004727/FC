/* ================================================
   SportHub — Education: Club Detail Withdraw Flow
   ================================================
   教育型俱樂部退學 / 取消申請流程
   - 取消申請確認
   - 退學確認（文字輸入驗證）
   - 執行退學
   ================================================ */

Object.assign(App, {

  // ══════════════════════════════════
  //  退學確認（含文字輸入驗證）
  // ══════════════════════════════════

  async _confirmEduCancelApply(teamId, studentId, btnEl) {
    const studentName = btnEl && btnEl.dataset ? btnEl.dataset.name : '';
    if (!(await this.appConfirm('確定要取消「' + studentName + '」的申請嗎？'))) return;
    await this._executeEduWithdraw(teamId, studentId, studentName);
  },

  _confirmEduWithdraw(teamId, studentId, btnEl) {
    const studentName = btnEl && btnEl.dataset ? btnEl.dataset.name : '';
    // 建立毛玻璃彈窗
    const overlay = document.createElement('div');
    overlay.className = 'app-confirm-overlay open';
    overlay.style.cssText = 'backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);background:rgba(0,0,0,.35)';

    overlay.innerHTML = '<div class="app-confirm-box" style="border-radius:16px;box-shadow:0 8px 32px rgba(0,0,0,.15);max-width:320px;width:90%">'
      + '<div class="app-confirm-msg" style="text-align:center">確定要將「' + escapeHTML(studentName) + '」退學嗎？<br><span style="font-size:.75rem;color:var(--text-muted)">此操作無法自行撤回</span></div>'
      + '<div style="margin:.6rem 0"><input type="text" id="edu-withdraw-input" class="ce-input" placeholder="請輸入「我確定退學」" style="width:100%;text-align:center;font-size:.85rem"></div>'
      + '<div class="app-confirm-btns">'
      + '<button class="app-confirm-cancel" id="edu-withdraw-cancel">取消</button>'
      + '<button class="app-confirm-ok" id="edu-withdraw-ok" disabled style="opacity:.5">確定</button>'
      + '</div></div>';

    document.body.appendChild(overlay);
    document.body.classList.add('modal-open');

    const input = document.getElementById('edu-withdraw-input');
    const okBtn = document.getElementById('edu-withdraw-ok');
    const cancelBtn = document.getElementById('edu-withdraw-cancel');

    // 輸入匹配時啟用確定按鈕
    input.addEventListener('input', () => {
      const match = input.value.trim() === '我確定退學';
      okBtn.disabled = !match;
      okBtn.style.opacity = match ? '1' : '.5';
    });

    // 阻止背景穿透
    overlay.addEventListener('touchmove', (e) => {
      if (!e.target.closest('.app-confirm-box')) { e.preventDefault(); e.stopPropagation(); }
    }, { passive: false });

    const cleanup = () => {
      overlay.remove();
      document.body.classList.remove('modal-open');
    };

    cancelBtn.addEventListener('click', cleanup, { once: true });
    okBtn.addEventListener('click', async () => {
      if (input.value.trim() !== '我確定退學') return;
      cleanup();
      await this._executeEduWithdraw(teamId, studentId, studentName);
    }, { once: true });

    // 自動 focus
    setTimeout(() => input.focus(), 100);
  },

  async _executeEduWithdraw(teamId, studentId, studentName) {
    try {
      await FirebaseService.updateEduStudent(teamId, studentId, {
        enrollStatus: 'inactive',
      });
      const cached = this._eduStudentsCache[teamId];
      if (cached) {
        const s = cached.find(s => s.id === studentId);
        if (s) s.enrollStatus = 'inactive';
      }
      this._updateGroupMemberCounts(teamId);
      this.showToast('「' + studentName + '」已退學');
      this._renderEduMemberSection(teamId);
      this.renderEduGroupList(teamId);
    } catch (err) {
      console.error('[_executeEduWithdraw]', err);
      this.showToast('操作失敗：' + (err.message || '請稍後再試'));
    }
  },

});
