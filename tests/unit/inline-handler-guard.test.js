/** @jest-environment jsdom */
const fs = require('fs');
const path = require('path');
const { parse } = require('@babel/parser');

// 事件繫結強化：COMPLETED_FILES 只作存在性斷言（交接索引）；實際守門掃描全部 js/**/*.js。
const COMPLETED_FILES = [
  "js/api-service.js",
  "js/config.js",
  "js/core/navigation.js",
  "js/core/theme.js",
  "js/modules/achievement/achievement.js",
  "js/modules/achievement/admin.js",
  "js/modules/achievement/badges.js",
  "js/modules/achievement/stats.js",
  "js/modules/achievement/titles.js",
  "js/modules/achievement/view.js",
  "js/modules/ad-manage/ad-manage-banner.js",
  "js/modules/ad-manage/ad-manage-core.js",
  "js/modules/ad-manage/ad-manage-float.js",
  "js/modules/ad-manage/ad-manage-popup-sponsor.js",
  "js/modules/ad-manage/banner.js",
  "js/modules/ad-manage/popup-ad.js",
  "js/modules/admin-log-tabs.js",
  "js/modules/admin-seo/seo-dashboard.js",
  "js/modules/announcement.js",
  "js/modules/audit-log.js",
  "js/modules/auto-exp/index.js",
  "js/modules/color-cat/color-cat-naming.js",
  "js/modules/dashboard/dashboard-ci-usage.js",
  "js/modules/dashboard/dashboard-drilldown-attend.js",
  "js/modules/dashboard/dashboard-drilldown-core.js",
  "js/modules/dashboard/dashboard-drilldown-ended.js",
  "js/modules/dashboard/dashboard-drilldown-events.js",
  "js/modules/dashboard/dashboard-drilldown-open.js",
  "js/modules/dashboard/dashboard-drilldown-records.js",
  "js/modules/dashboard/dashboard-drilldown-teams.js",
  "js/modules/dashboard/dashboard-drilldown-tourns.js",
  "js/modules/dashboard/dashboard-drilldown-users.js",
  "js/modules/dashboard/dashboard-info-modal.js",
  "js/modules/dashboard/dashboard-participant-share.js",
  "js/modules/dashboard/dashboard-usage.js",
  "js/modules/dashboard/dashboard.js",
  "js/modules/dashboard/personal-dashboard.js",
  "js/modules/data-sync.js",
  "js/modules/education/edu-calendar-core.js",
  "js/modules/education/edu-calendar-monthly.js",
  "js/modules/education/edu-calendar-stamp.js",
  "js/modules/education/edu-checkin-scan.js",
  "js/modules/education/edu-checkin.js",
  "js/modules/education/edu-course-enrollment-render.js",
  "js/modules/education/edu-course-enrollment.js",
  "js/modules/education/edu-course-lesson-share.js",
  "js/modules/education/edu-course-lessons-render.js",
  "js/modules/education/edu-course-lessons.js",
  "js/modules/education/edu-course-plan-attendance.js",
  "js/modules/education/edu-course-plan-form-v2.js",
  "js/modules/education/edu-course-plan-render.js",
  "js/modules/education/edu-course-plan.js",
  "js/modules/education/edu-course-session-form.js",
  "js/modules/education/edu-course-session.js",
  "js/modules/education/edu-detail-render.js",
  "js/modules/education/edu-group-list.js",
  "js/modules/education/edu-parent-binding.js",
  "js/modules/education/edu-student-form.js",
  "js/modules/education/edu-student-list.js",
  "js/modules/error-log-insights.js",
  "js/modules/error-log.js",
  "js/modules/event/event-comments.js",
  "js/modules/event/event-create-delegates.js",
  "js/modules/event/event-create-external.js",
  "js/modules/event/event-create-input-history.js",
  "js/modules/event/event-create-multidate.js",
  "js/modules/event/event-create-options.js",
  "js/modules/event/event-create-sport-picker.js",
  "js/modules/event/event-create-team-picker.js",
  "js/modules/event/event-create-template.js",
  "js/modules/event/event-create.js",
  "js/modules/event/event-detail-companion.js",
  "js/modules/event/event-detail-signup.js",
  "js/modules/event/event-detail.js",
  "js/modules/event/event-host-list.js",
  "js/modules/event/event-list-calendar-build.js",
  "js/modules/event/event-list-calendar.js",
  "js/modules/event/event-list-timeline.js",
  "js/modules/event/event-list.js",
  "js/modules/event/event-manage-attendance.js",
  "js/modules/event/event-manage-waitlist.js",
  "js/modules/event/event-manage.js",
  "js/modules/event/event-map.js",
  "js/modules/event/event-share-builders.js",
  "js/modules/event/event-team-split.js",
  "js/modules/favorites.js",
  "js/modules/game-log-viewer.js",
  "js/modules/game-manage.js",
  "js/modules/home-dashboard.js",
  "js/modules/home-next-activity.js",
  "js/modules/image-cropper.js",
  "js/modules/leaderboard.js",
  "js/modules/message/message-admin-compose.js",
  "js/modules/message/message-admin-list.js",
  "js/modules/message/message-notify.js",
  "js/modules/message/message-render.js",
  "js/modules/message/notif-settings.js",
  "js/modules/message/pm-audit.js",
  "js/modules/message/pm-dialog.js",
  "js/modules/message/pm-listener.js",
  "js/modules/news.js",
  "js/modules/profile/profile-card.js",
  "js/modules/profile/profile-core.js",
  "js/modules/profile/profile-data-history.js",
  "js/modules/profile/profile-data-render.js",
  "js/modules/profile/profile-data-stats.js",
  "js/modules/profile/profile-share.js",
  "js/modules/role.js",
  "js/modules/scan/scan-family.js",
  "js/modules/scan/scan-ui.js",
  "js/modules/shop.js",
  "js/modules/shot-game/shot-lab-controls.js",
  "js/modules/site-theme.js",
  "js/modules/team/team-contact-links.js",
  "js/modules/team/team-detail-invite.js",
  "js/modules/team/team-detail-render.js",
  "js/modules/team/team-detail-v2-actions.js",
  "js/modules/team/team-detail-v2-lists.js",
  "js/modules/team/team-detail-v2-panels.js",
  "js/modules/team/team-detail-v2-render.js",
  "js/modules/team/team-detail.js",
  "js/modules/team/team-form-init.js",
  "js/modules/team/team-form-search.js",
  "js/modules/team/team-list-render.js",
  "js/modules/team/team-list.js",
  "js/modules/team/team-share-builders.js",
  "js/modules/tournament/tournament-competition.js",
  "js/modules/tournament/tournament-core.js",
  "js/modules/tournament/tournament-detail-competition.js",
  "js/modules/tournament/tournament-detail.js",
  "js/modules/tournament/tournament-friendly-apply-state.js",
  "js/modules/tournament/tournament-friendly-detail-view.js",
  "js/modules/tournament/tournament-friendly-detail.js",
  "js/modules/tournament/tournament-friendly-notify.js",
  "js/modules/tournament/tournament-friendly-roster.js",
  "js/modules/tournament/tournament-friendly-state.js",
  "js/modules/tournament/tournament-friendly-withdraw.js",
  "js/modules/tournament/tournament-helpers.js",
  "js/modules/tournament/tournament-manage-edit.js",
  "js/modules/tournament/tournament-manage-form.js",
  "js/modules/tournament/tournament-manage-host-selection.js",
  "js/modules/tournament/tournament-manage-host.js",
  "js/modules/tournament/tournament-manage-people.js",
  "js/modules/tournament/tournament-manage.js",
  "js/modules/tournament/tournament-match-data.js",
  "js/modules/tournament/tournament-match-record.js",
  "js/modules/tournament/tournament-render.js",
  "js/modules/tournament/tournament-schedule-manage.js",
  "js/modules/tournament/tournament-share-builders.js",
  "js/modules/tournament/tournament-share.js",
  "js/modules/user-admin/permission-audit/permission-audit-render.js",
  "js/modules/user-admin/user-admin-corrections.js",
  "js/modules/user-admin/user-admin-event-blocklist.js",
  "js/modules/user-admin/user-admin-exp.js",
  "js/modules/user-admin/user-admin-list.js",
  "js/modules/user-admin/user-admin-roles.js",
  "js/modules/user-admin/user-admin-uid-health.js",
  "js/modules/user-admin/user-admin-user-grants.js"
];
const ALLOWLIST = [];
const ROOT = path.join(__dirname, '../..');

function listScripts(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? listScripts(file) : file.endsWith('.js') ? [file] : [];
  });
}


function expressionPositions(value) {
  const decoder = document.createElement('textarea');
  const slots = [];
  decoder.innerHTML = value.replace(/\0(\d+)\0/g, (_, index) => {
    slots.push({ index: Number(index), name: '__T084_SLOT_' + index + '__' });
    return slots[slots.length - 1].name;
  });
  const handler = decoder.value;
  const positions = new Map();
  let tokens;
  try {
    tokens = parse(handler, { allowReturnOutsideFunction: true, tokens: true }).tokens;
  } catch (_) {
    return positions;
  }
  for (const slot of slots) {
    const marker = handler.indexOf(slot.name);
    const token = tokens.find(item => item.start <= marker && item.end >= marker + slot.name.length);
    if (token?.type.label === 'string') positions.set(slot.index, 'string');
    else if (token?.type.label === 'name' && token.start === marker && token.end === marker + slot.name.length) positions.set(slot.index, 'outside');
  }
  return positions;
}

function isCall(node, name) {
  return node?.type === 'CallExpression' && !node.optional
    && node.callee.type === 'Identifier' && node.callee.name === name
    && node.arguments.length === 1 && node.arguments[0].type !== 'SpreadElement';
}

function accepted({ node, position }) {
  if (isCall(node, 'escapeJsAttr')) return position === 'string';
  if (position !== 'outside') return false;
  if (isCall(node, 'Number') || isCall(node, 'Boolean')) return true;
  if (!isCall(node, 'escapeHTML')) return false;
  const inner = node.arguments[0];
  return inner.type === 'CallExpression' && !inner.optional
    && inner.arguments.length === 1 && inner.arguments[0].type !== 'SpreadElement'
    && inner.callee.type === 'MemberExpression' && !inner.callee.computed && !inner.callee.optional
    && inner.callee.object.type === 'Identifier' && inner.callee.object.name === 'JSON'
    && inner.callee.property.type === 'Identifier' && inner.callee.property.name === 'stringify';
}

function collectExpressions(source) {
  const found = new Map();
  const tree = parse(source, { sourceType: 'unambiguous' });
  const joined = node => node.type === 'BinaryExpression' && node.operator === '+';
  function pieces(node) {
    if (joined(node) && node.extra?.parenthesized) return [node];
    if (joined(node)) return [...pieces(node.left), ...pieces(node.right)];
    if (node.type === 'StringLiteral') return [node.value];
    if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression'
      && node.callee.property.name === 'join' && node.arguments.length === 1
      && node.arguments[0].type === 'StringLiteral' && node.arguments[0].value === ''
      && node.callee.object.type === 'ArrayExpression') {
      return node.callee.object.elements.flatMap(item => item ? pieces(item) : []);
    }
    if (node.type === 'TemplateLiteral') return node.quasis.flatMap((part, i) => [
      part.value.cooked ?? part.value.raw, ...(node.expressions[i] ? [node.expressions[i]] : []),
    ]);
    return [node];
  }
  function inspectParts(parts, directEvent = false) {
    const values = [];
    const html = parts.map(part => {
      if (typeof part === 'string') return part;
      values.push(part);
      return '\0' + (values.length - 1) + '\0';
    }).join('');
    function record(value, unquoted = false) {
      const positions = directEvent || unquoted ? new Map() : expressionPositions(value);
      for (const token of value.matchAll(/\0(\d+)\0/g)) {
        const expression = values[Number(token[1])];
        found.set(expression.start, {
          node: expression,
          position: positions.get(Number(token[1])),
          expression: source.slice(expression.start, expression.end).trim(),
          line: expression.loc.start.line,
        });
      }
    }
    if (directEvent) { record(html); return; }
    const attributes = /\bon\w+\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
    for (const match of html.matchAll(attributes)) record(match[1] ?? match[2] ?? match[3], match[3] !== undefined);
  }
  function inspect(node) { inspectParts(pieces(node)); }
  function inspectStatements(statements) {
    const chunks = new Map();
    const arrays = new Set();
    for (const statement of statements) {
      if (statement.type === 'VariableDeclaration') {
        for (const entry of statement.declarations) {
          if (entry.id.type !== 'Identifier' || !entry.init) continue;
          if (entry.init.type === 'ArrayExpression') {
            arrays.add(entry.id.name);
            chunks.set(entry.id.name, entry.init.elements.flatMap(item => item ? pieces(item) : []));
          } else chunks.set(entry.id.name, pieces(entry.init));
        }
      }
      const node = statement.type === 'ExpressionStatement' ? statement.expression : null;
      if (node?.type === 'AssignmentExpression') {
        const key = source.slice(node.left.start, node.left.end);
        if (node.operator === '=') chunks.set(key, pieces(node.right));
        else if (node.operator === '+=') chunks.set(key, [...(chunks.get(key) || []), ...pieces(node.right)]);
      }
      if (node?.type === 'CallExpression' && node.callee.type === 'MemberExpression'
        && node.callee.object.type === 'Identifier' && node.callee.property.name === 'push'
        && arrays.has(node.callee.object.name)) {
        const key = node.callee.object.name;
        chunks.set(key, [...chunks.get(key), ...node.arguments.flatMap(pieces)]);
      }
    }
    for (const parts of chunks.values()) inspectParts(parts);
  }
  function walk(node, parent) {
    if (!node || typeof node !== 'object') return;
    if ((node.type === 'CallExpression' || node.type === 'OptionalCallExpression')
      && (node.callee.type === 'MemberExpression' || node.callee.type === 'OptionalMemberExpression')
      && (node.callee.property.name === 'setAttribute' || node.callee.property.value === 'setAttribute')
      && node.arguments[0]?.type === 'StringLiteral' && /^on\w+$/i.test(node.arguments[0].value)
      && node.arguments[1]) inspectParts(pieces(node.arguments[1]), true);
    if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression'
      && node.callee.property.name === 'join' && node.callee.object.type === 'ArrayExpression') inspect(node);
    if ((joined(node) || node.type === 'TemplateLiteral' || node.type === 'StringLiteral') && !joined(parent || {})) inspect(node);
    for (const [key, value] of Object.entries(node)) {
      if (key === 'loc' || key === 'extra' || key === 'comments' || key.endsWith('Comments')) continue;
      if (Array.isArray(value)) value.forEach(child => walk(child, node));
      else if (value && typeof value.type === 'string') walk(value, node);
    }
    if (node.type === 'Program' || node.type === 'BlockStatement') inspectStatements(node.body);
  }
  walk(tree);
  return [...found.values()];
}


describe('事件繫結強化：靜態守門', () => {
  test('全 js 檔案使用統一的資料形式', () => {
    expect(ALLOWLIST).toEqual([]);
    const files = listScripts(path.join(ROOT, 'js'))
      .map(file => path.relative(ROOT, file).split(path.sep).join('/'));
    expect(files).toEqual(expect.arrayContaining(COMPLETED_FILES));
    const findings = files.flatMap(file => collectExpressions(fs.readFileSync(path.join(ROOT, file), 'utf8'))
      .filter(item => !accepted(item))
      .map(({ line, expression }) => ({ file, line, expression })));
    expect(findings).toEqual([]);
  });
  test('能辨識同一屬性內的每個資料欄位', () => {
    const source = 'const html = ' + String.fromCharCode(96) + '<button onchange="f(\x27' + String.fromCharCode(36) + '{escapeJsAttr(value)}\x27, ' + String.fromCharCode(36) + '{Number(index)}, ' + String.fromCharCode(36) + '{escapeHTML(JSON.stringify({ label: "a" }))}, ' + String.fromCharCode(36) + '{Boolean(active)})">' + String.fromCharCode(96);
    expect(collectExpressions(source).map(item => item.expression)).toEqual([
      'escapeJsAttr(value)', 'Number(index)', 'escapeHTML(JSON.stringify({ label: "a" }))', 'Boolean(active)',
    ]);
  });
  test('辨識串接、多屬性、跨行與單引號內容', () => {
    const source = String.raw`const html = '<button title="' + label + '" onfocus="f(' + Number(index) + ')" onclick="g(\'' + raw + '\',' + Boolean(active) + ')" onchange=\'h(' +
      escapeHTML(JSON.stringify(payload)) + ')\'>' + text;`;
    expect(collectExpressions(source).map(item => item.expression)).toEqual([
      'Number(index)', 'raw', 'Boolean(active)', 'escapeHTML(JSON.stringify(payload))',
    ]);
    expect(collectExpressions(source).filter(item => !accepted(item)).map(item => item.expression)).toEqual(['raw']);
  });
  test('辨識巢狀模板與條件分支', () => {
    const tick = '`';
    const source = 'const html = ' + tick + '<div ' + String.fromCharCode(36) + '{ok ? ' + tick + 'onclick="f(\x27' + String.fromCharCode(36) + '{escapeJsAttr(value)}\x27)"' + tick + ' : ' + tick + 'onclick="f(\x27' + String.fromCharCode(36) + '{raw}\x27)"' + tick + '}>' + tick;
    expect(collectExpressions(source).map(item => item.expression)).toEqual(['escapeJsAttr(value)', 'raw']);
  });
  test('不接受預先組好的整段內容或未處理的運算元', () => {
    const source = String.raw`const html = '<button onclick="' + action + '" onchange="f(' + (left + right) + ')" onblur="f(' + String(value) + ')">';`;
    expect(collectExpressions(source).filter(item => !accepted(item)).map(item => item.expression)).toEqual(['action', 'left + right', 'String(value)']);
  });
  test.each([
    ['escapeJsAttr(x) + y', true],
    ['Number(a).foo', false],
    ['Boolean(a) || b', false],
    ['escapeHTML(JSON.stringify(x)) + y', false],
    ['escapeHTML(JSON.stringify(x) + y)', false],
    ['Number(a) + Boolean(b)', false],
    ['escapeJsAttr(x)', false],
    ['Number(a)', true],
    ['Boolean(a)', true],
    ['escapeHTML(JSON.stringify(x))', true],
  ])('事件繫結強化：拒絕不完整形式或位置 %s（引號內 %p）', (expression, quoted) => {
    const tick = String.fromCharCode(96);
    const slot = String.fromCharCode(36) + '{' + expression + '}';
    const argument = quoted ? "'" + slot + "'" : slot;
    const source = 'const html = ' + tick + '<button onclick="f(' + argument + ')">' + tick + ';';
    const findings = collectExpressions(source).filter(item => !accepted(item));
    expect(findings.map(item => item.expression)).toEqual([expression]);
  });

  test('事件繫結強化：四種完整形式與對應位置均接受', () => {
    const tick = String.fromCharCode(96);
    const slot = expression => String.fromCharCode(36) + '{' + expression + '}';
    const source = 'const html = ' + tick + '<button onclick="f(\x27' + slot('escapeJsAttr(value)') + '\x27, ' + slot('Number(index)') + ', ' + slot('Boolean(active)') + ', ' + slot('escapeHTML(JSON.stringify(payload))') + ')">' + tick + ';';
    const expressions = collectExpressions(source);
    expect(expressions).toHaveLength(4);
    expect(expressions.filter(item => !accepted(item))).toEqual([]);
  });

  test('事件繫結強化：屬性內引號位置判定', () => {
    const tick = String.fromCharCode(96);
    const slot = expression => String.fromCharCode(36) + '{' + expression + '}';
    const source = 'const html = ' + tick + '<button onclick="f(&quot;' + slot('escapeJsAttr(value)') + '&quot;, &#39;' + slot('Number(index)') + '&#39;)">' + tick + ';';
    const expressions = collectExpressions(source);
    expect(expressions.map(item => item.position)).toEqual(['string', 'string']);
    expect(expressions.filter(item => !accepted(item)).map(item => item.expression)).toEqual(['Number(index)']);
  });

  test('事件繫結強化：串接中的完整動態運算式仍須合規', () => {
    const source = String.raw`const html = '<button onclick="f(\'' + (escapeJsAttr(x) + y) + '\')" onfocus="f(' + Number(a).foo + ')" onblur="f(' + (Boolean(a) || b) + ')">';`;
    expect(collectExpressions(source).filter(item => !accepted(item)).map(item => item.expression)).toEqual([
      'escapeJsAttr(x) + y', 'Number(a).foo', 'Boolean(a) || b',
    ]);
  });

  test.each([
    String.raw`let html = '<button onclick="f(\''; html += raw; html += '\')">';`,
    String.raw`const html = ['<button onclick="f(\'', raw, '\')">'].join('');`,
    String.raw`const parts = ['<button onclick="f(\'']; parts.push(raw); parts.push('\')">'); const html = parts.join('');`,
    String.raw`button.setAttribute('onclick', "f('" + raw + "')");`,
    String.raw`button.setAttribute?.('onclick', "f('" + escapeJsAttr(raw) + "')");`,
    String.raw`const html = '<button onclick=f(' + Number(raw) + ')>';`,
  ])('事件繫結強化：組裝形式須可確認 %s', source => {
    expect(collectExpressions(source).filter(item => !accepted(item))).toHaveLength(1);
  });
  test('事件繫結強化：完整組裝與固定設定', () => {
    const source = String.raw`let html = '<button onclick="f(\''; html += escapeJsAttr(raw); html += '\')">';
      const joined = ['<button onclick="g(\'', escapeJsAttr(id), '\')">'].join('');
      button.setAttribute('onclick', 'App.goBack()');`;
    const expressions = collectExpressions(source);
    expect(expressions).toHaveLength(2);
    expect(expressions.filter(item => !accepted(item))).toEqual([]);
  });

});
