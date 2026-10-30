/** @jest-environment jsdom */
const fs = require('fs');
const path = require('path');
const { parse } = require('@babel/parser');

// T-084c 結束時移除此範圍限定，改掃全部檔案。
const COMPLETED_FILES = [
  "js/config.js",
  "js/modules/event/event-comments.js",
  "js/modules/event/event-detail-signup.js",
  "js/modules/event/event-detail.js",
  "js/modules/event/event-host-list.js",
  "js/modules/event/event-manage-attendance.js",
  "js/modules/event/event-manage.js",
  "js/modules/event/event-team-split.js",
  "js/modules/favorites.js",
  "js/modules/leaderboard.js",
  "js/modules/message/message-admin-list.js",
  "js/modules/message/message-render.js",
  "js/modules/profile/profile-card.js",
  "js/modules/profile/profile-core.js",
  "js/modules/profile/profile-data-history.js",
  "js/modules/profile/profile-data-render.js",
  "js/modules/role.js",
  "js/modules/team/team-detail-render.js",
  "js/modules/team/team-detail-v2-actions.js",
  "js/modules/team/team-detail-v2-panels.js",
  "js/modules/team/team-detail.js",
  "js/modules/team/team-list-render.js"
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
    if (node.type === 'TemplateLiteral') return node.quasis.flatMap((part, i) => [
      part.value.cooked ?? part.value.raw, ...(node.expressions[i] ? [node.expressions[i]] : []),
    ]);
    return [node];
  }
  function inspect(node) {
    const values = [];
    const html = pieces(node).map(part => {
      if (typeof part === 'string') return part;
      values.push(part);
      return '\0' + (values.length - 1) + '\0';
    }).join('');
    const attributes = /\bon\w+\s*=\s*(["'])/gi;
    let match;
    while ((match = attributes.exec(html))) {
      const start = attributes.lastIndex;
      const end = html.indexOf(match[1], start);
      const value = html.slice(start, end < 0 ? html.length : end);
      const positions = expressionPositions(value);
      for (const token of value.matchAll(/\0(\d+)\0/g)) {
        const expression = values[Number(token[1])];
        found.set(expression.start, {
          node: expression,
          position: positions.get(Number(token[1])),
          expression: source.slice(expression.start, expression.end).trim(),
          line: expression.loc.start.line,
        });
      }
      attributes.lastIndex = end < 0 ? html.length : end + 1;
    }
  }
  function walk(node, parent) {
    if (!node || typeof node !== 'object') return;
    if ((joined(node) || node.type === 'TemplateLiteral' || node.type === 'StringLiteral') && !joined(parent || {})) inspect(node);
    for (const [key, value] of Object.entries(node)) {
      if (key === 'loc' || key === 'extra' || key === 'comments' || key.endsWith('Comments')) continue;
      if (Array.isArray(value)) value.forEach(child => walk(child, node));
      else if (value && typeof value.type === 'string') walk(value, node);
    }
  }
  walk(tree);
  return [...found.values()];
}


describe('事件繫結強化：靜態守門', () => {
  test('本包檔案使用統一的資料形式', () => {
    expect(ALLOWLIST).toEqual([]);
    const files = listScripts(path.join(ROOT, 'js'))
      .map(file => path.relative(ROOT, file).split(path.sep).join('/'))
      .filter(file => COMPLETED_FILES.includes(file));
    expect(files.sort()).toEqual([...COMPLETED_FILES].sort());
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

  test('事件繫結強化：字元參照與既有引號位置一致', () => {
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

});
