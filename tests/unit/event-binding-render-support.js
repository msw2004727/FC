const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { parse } = require('@babel/parser');
const ROOT = path.join(__dirname, '../..');
const VALUES = ["O'Brien", "back\\'quote", 'literal &amp; value', 'line\nbreak', "');window.__x=1;('"];
function load(file, api = {}, app = {}, globals = {}) {
  const context = vm.createContext({ App: app, ApiService: api, document, window, console,
    setTimeout, clearTimeout, localStorage, performance, I18N: { t: key => key }, ...globals });
  for (const name of ['js/config.js', 'js/modules/' + file]) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, name), 'utf8'), context, { filename: name });
  }
  return { app, context };
}
function mount(html) { document.body.innerHTML = html; }
function activate(app, selector, calls, type = 'click') {
  const element = document.querySelector(selector);
  expect(element).not.toBeNull();
  const source = element.getAttribute('on' + type);
  expect(typeof source).toBe('string');
  const names = [];
  function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (['CallExpression', 'OptionalCallExpression'].includes(node.type)
      && ['MemberExpression', 'OptionalMemberExpression'].includes(node.callee.type)
      && node.callee.object.name === 'App') names.push(node.callee.property.name);
    Object.values(node).forEach(value => Array.isArray(value) ? value.forEach(walk) : value?.type && walk(value));
  }
  walk(parse(source, { allowReturnOutsideFunction: true }));
  expect(names).toEqual(calls.map(([name]) => name));
  const mocks = calls.map(([name]) => { app[name] = jest.fn(); return app[name]; });
  const execute = new Function('App', 'window', 'event', 'document', source);
  const count = document.querySelectorAll('*').length;
  delete window.__x;
  element['on' + type] = function(event) { return execute.call(this, app, window, event, document); };
  for (let i = 0; i < 2; i++) {
    mocks.forEach(mock => mock.mockClear());
    if (type === 'click') element.click();
    else element.dispatchEvent(new Event(type, { bubbles: false, cancelable: true }));
    calls.forEach(([, expected], index) => {
      expect(mocks[index]).toHaveBeenCalledTimes(1);
      expect(mocks[index]).toHaveBeenCalledWith(...(typeof expected === 'function' ? expected(element) : expected));
    });
    expect(window.__x).toBeUndefined();
    expect(document.querySelectorAll('*').length).toBe(count);
  }
}
module.exports = { VALUES, load, mount, activate };
