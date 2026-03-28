/* ================================================
   SportHub — Education: QR Scan Check-in
   ================================================
   掃碼簽到（掃到自動歸組、多組時提示選擇）
   複用 scan-camera.js 的 Html5Qrcode 相機初始化
   ================================================ */

Object.assign(App, {

  _eduScanTeamId: null,
  _eduScanActive: false,

  /**
   * 顯示掃碼簽到頁面
   */
  async showEduCheckinScan(teamId) {
    this._eduScanTeamId = teamId;
    await this.showPage('page-edu-checkin');

    const container = document.getElementById('edu-checkin-container');
    if (!container) return;

    container.innerHTML = '<div class="edu-scan-section">' +
      '<div style="text-align:center;margin-bottom:.5rem">' +
        '<h3 style="margin:0">掃碼簽到</h3>' +
        '<p style="font-size:.78rem;color:var(--text-muted);margin:.2rem 0">掃描學員 QR Code 進行簽到</p>' +
      '</div>' +
      '<div id="edu-scan-reader" style="width:100%;max-width:400px;margin:0 auto"></div>' +
      '<div id="edu-scan-result" style="margin-top:.5rem"></div>' +
      '<div style="margin-top:.5rem;text-align:center">' +
        '<button class="outline-btn" onclick="App._stopEduScan();App.showEduCheckin(\'' + teamId + '\')">切換到批次簽到</button>' +
      '</div>' +
    '</div>';

    this._startEduScan(teamId);
  },

  /**
   * 啟動掃碼器
   */
  async _startEduScan(teamId) {
    this._eduScanActive = true;
    const readerEl = document.getElementById('edu-scan-reader');
    if (!readerEl) return;

    // 使用 Html5Qrcode（與既有掃碼功能共用 SDK）
    if (typeof Html5Qrcode === 'undefined') {
      readerEl.innerHTML = '<div style="text-align:center;color:var(--danger);padding:1rem">掃碼功能未載入，請確認網路連線</div>';
      return;
    }

    try {
      const scanner = new Html5Qrcode('edu-scan-reader');
      this._eduScanner = scanner;

      await scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decodedText) => this._onEduScanSuccess(teamId, decodedText),
        () => {} // ignore errors
      );
    } catch (err) {
      console.error('[edu-checkin-scan] start failed:', err);
      readerEl.innerHTML = '<div style="text-align:center;color:var(--danger);padding:1rem">無法啟動相機：' + escapeHTML(String(err)) + '</div>';
    }
  },

  _stopEduScan() {
    this._eduScanActive = false;
    if (this._eduScanner) {
      try { this._eduScanner.stop(); } catch (_) {}
      this._eduScanner = null;
    }
  },

  /**
   * 掃碼成功
   */
  async _onEduScanSuccess(teamId, decodedText) {
    if (!this._eduScanActive) return;

    // 暫停掃描避免重複
    this._eduScanActive = false;

    const resultEl = document.getElementById('edu-scan-result');
    if (!resultEl) return;

    resultEl.innerHTML = '<div style="text-align:center;padding:.5rem;color:var(--text-muted)">處理中...</div>';

    // 查找學員（透過 uid 或 studentId）
    const scannedUid = decodedText.trim();
    const students = await this._loadEduStudents(teamId);
    const matched = students.filter(s =>
      s.enrollStatus === 'active' &&
      (s.selfUid === scannedUid || s.parentUid === scannedUid || s.id === scannedUid)
    );

    if (!matched.length) {
      resultEl.innerHTML = '<div class="edu-scan-fail">找不到對應的學員：' + escapeHTML(scannedUid) + '</div>';
      setTimeout(() => { this._eduScanActive = true; }, 2000);
      return;
    }

    // 多學員情況（家長可能對應多個孩子）
    const student = matched.length === 1 ? matched[0] : null;

    if (!student) {
      // 多個孩子，讓教練選擇
      resultEl.innerHTML = '<div class="edu-scan-multi">' +
        '<div style="font-weight:600;margin-bottom:.3rem">此帳號對應多位學員，請選擇：</div>' +
        matched.map(s => '<button class="outline-btn" style="margin:.2rem" data-team="' + escapeHTML(teamId) + '" data-student="' + escapeHTML(s.id) + '" data-name="' + escapeHTML(s.name) + '" onclick="App._eduScanCheckinStudent(this.dataset.team,this.dataset.student,this.dataset.name)">' + escapeHTML(s.name) + '</button>').join('') +
      '</div>';
      return;
    }

    await this._eduScanCheckinStudent(teamId, student.id, student.name);
  },

  async _eduScanCheckinStudent(teamId, studentId, studentName) {
    const resultEl = document.getElementById('edu-scan-result');
    const students = this.getEduStudents(teamId);
    const student = students.find(s => s.id === studentId);

    // 判斷分組
    let groupId = '';
    if (student && student.groupIds && student.groupIds.length === 1) {
      groupId = student.groupIds[0];
    } else if (student && student.groupIds && student.groupIds.length > 1) {
      // 多分組，使用第一個
      groupId = student.groupIds[0];
    }

    const date = this._todayStr();
    const time = this._nowTimeStr();

    try {
      const record = {
        id: this._generateEduId('ea'),
        studentId,
        studentName: studentName || '',
        parentUid: student?.parentUid || null,
        selfUid: student?.selfUid || null,
        groupId,
        coursePlanId: null,
        date,
        time,
        sessionNumber: null,
      };

      // 前端直接寫入 Firestore（比照活動簽到）
      const docRef = firebase.firestore().collection('eduAttendance').doc();
      await docRef.set({
        id: docRef.id, teamId, groupId: groupId || '', coursePlanId: null,
        studentId, studentName: studentName || '',
        parentUid: student?.parentUid || null, selfUid: student?.selfUid || null,
        date, time, sessionNumber: null, status: 'active',
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });

      if (resultEl) {
        resultEl.innerHTML = '<div class="edu-scan-success">' +
          '<div style="font-size:1.5rem">✓</div>' +
          '<div style="font-weight:600">' + escapeHTML(studentName) + '</div>' +
          '<div style="font-size:.78rem;color:var(--text-muted)">簽到成功 ' + date + ' ' + time + '</div>' +
        '</div>';
      }

      // 觸發通知
      if (typeof this._notifyEduCheckin === 'function') {
        this._notifyEduCheckin(teamId, groupId, [record]);
      }

      // 2 秒後恢復掃碼
      setTimeout(() => { this._eduScanActive = true; }, 2000);
    } catch (err) {
      console.error('[_eduScanCheckinStudent]', err);
      if (resultEl) {
        resultEl.innerHTML = '<div class="edu-scan-fail">簽到失敗：' + escapeHTML(err.message || '') + '</div>';
      }
      setTimeout(() => { this._eduScanActive = true; }, 2000);
    }
  },

});
