const fs = require('fs');
const path = require('path');
const vm = require('vm');

// 只取 config.js 內的兩個函式，避免整份啟動腳本在 node 測試環境依賴 window。
const source = fs.readFileSync(path.join(__dirname, '../../js/config.js'), 'utf8');

function sliceFunction(name) {
  const start = source.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('config.js 找不到 ' + name);
  const rest = source.slice(start);
  const end = rest.search(/\n\}\r?\n/);
  if (end < 0) throw new Error('config.js 的 ' + name + ' 結尾無法定位');
  return rest.slice(0, end + 2);
}

const context = vm.createContext({});
vm.runInContext(sliceFunction('escapeHTML') + '\n' + sliceFunction('escapeJsAttr'), context);
module.exports = { escapeJsAttr: context.escapeJsAttr };
