/* ================================================
   SportHub — Education: Parent-Child Binding
   ================================================
   家長帳號綁定孩子，查看所有孩子的行事曆
   ================================================ */

Object.assign(App, {

  /**
   * 當學員被審核通過時，自動綁定到家長的 eduChildren
   */
  async _bindEduChildToParent(teamId, student) {
    if (!student || !student.parentUid) return;

    const curUser = ApiService.getCurrentUser();
    if (!curUser || curUser.uid !== student.parentUid) return;

    const children = ApiService.getEduChildren();
    // 避免重複綁定
    const exists = children.find(c => c.id === student.id && c.teamId === teamId);
    if (exists) return;

    const team = ApiService.getTeam(teamId);
    ApiService.addEduChild({
      id: student.id,
      name: student.name,
      teamId,
      teamName: team ? team.name : '',
    });
  },

  /**
   * 解除綁定
   */
  removeEduChildBinding(childId) {
    ApiService.removeEduChild(childId);
    if (typeof this.showToast === 'function') {
      this.showToast('已解除綁定');
    }
    // 重新渲染
    if (typeof this._renderEduChildrenSection === 'function') {
      this._renderEduChildrenSection();
    }
  },

  /**
   * 渲染「我的孩子」區塊（用於 Profile 頁或教育詳情頁）
   */
  _renderEduChildrenSection(containerId) {
    const container = document.getElementById(containerId || 'edu-children-section');
    if (!container) return;

    const children = ApiService.getEduChildren();
    if (!children.length) {
      container.innerHTML = '';
      return;
    }

    let html = '<div style="margin-top:.8rem">' +
      '<h4 style="margin:0 0 .4rem;font-size:.9rem">我的孩子</h4>';

    html += children.map(child => {
      return '<div class="edu-student-card">' +
        '<div class="edu-student-header">' +
          '<span class="edu-student-name">' + escapeHTML(child.name) + '</span>' +
          (child.teamName ? '<span class="edu-group-tag">' + escapeHTML(child.teamName) + '</span>' : '') +
        '</div>' +
        '<div class="edu-student-actions">' +
          '<button class="outline-btn small" data-team="' + escapeHTML(child.teamId) + '" data-student="' + escapeHTML(child.id) + '" onclick="App.showEduCalendar(this.dataset.team,this.dataset.student)">出席紀錄</button>' +
          '<button class="outline-btn small danger" data-child="' + escapeHTML(child.id) + '" onclick="App.removeEduChildBinding(this.dataset.child)">解除綁定</button>' +
        '</div>' +
      '</div>';
    }).join('');

    html += '</div>';
    container.innerHTML = html;
  },

  /**
   * 學員審核通過後同步綁定
   * 從 edu-student-join.js 的 approveEduStudent 呼叫
   */
  async syncEduChildBinding(teamId, studentId) {
    const students = this.getEduStudents(teamId);
    const student = students.find(s => s.id === studentId);
    if (!student) return;

    // 若有 parentUid，嘗試綁定
    if (student.parentUid) {
      const curUser = ApiService.getCurrentUser();
      if (curUser && curUser.uid === student.parentUid) {
        await this._bindEduChildToParent(teamId, student);
      }
    }
  },

});
