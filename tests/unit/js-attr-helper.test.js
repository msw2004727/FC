/** @jest-environment jsdom */
const { escapeJsAttr } = require('../helpers/event-binding');
const context = { escapeJsAttr };

describe('事件繫結強化：共用值處理', () => {
  test.each([
    ["O'Brien"], ["\\'"], ['a"b'], ['a\nb'], ['a\rb'],
    ['a\u2028b'], ['a\u2029b'], ['</script>'], ['plain'], [null], [undefined],
    ["');window.__x=1;('"], ['&amp;'],
  ])('保留資料並只呼叫一次：%p', (value) => {
    const encoded = context.escapeJsAttr(value);
    document.body.innerHTML = '<span onclick="f(\'' + encoded + '\')"></span>';
    const element = document.querySelector('span');
    const f = jest.fn();
    const state = {};
    new Function('f', 'window', element.getAttribute('onclick'))(f, state);
    expect(f).toHaveBeenCalledTimes(1);
    expect(f).toHaveBeenCalledWith(value == null ? '' : value);
    expect(state).toEqual({});
    if (value === 'plain') expect(encoded).toBe(value);
  });
});
