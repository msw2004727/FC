/* ColorCat — 傷害數值飄字系統（往上飄 + 淡出）
   依賴：color-cat-config.js */
;(function() {

var _nums = [];

// 生成傷害數值
function spawn(x, y, dmg, color) {
  _nums.push({
    x: x + (Math.random() - 0.5) * 10,
    y: y,
    dmg: dmg,
    color: color || '#FF3333',
    life: 40,
    maxLife: 40,
    vy: -1.2,
    scale: 1,
  });
}

// 每幀更新
function update() {
  for (var i = _nums.length - 1; i >= 0; i--) {
    var n = _nums[i];
    n.y += n.vy;
    n.vy *= 0.97;
    n.life--;
    if (n.life <= 0) _nums.splice(i, 1);
  }
}

// 繪製所有飄字
function draw(ctx) {
  for (var i = 0; i < _nums.length; i++) {
    var n = _nums[i];
    var alpha = Math.min(1, n.life / (n.maxLife * 0.3));
    // 出現時放大效果
    var age = n.maxLife - n.life;
    var scale = age < 5 ? 0.6 + age * 0.08 : 1;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = 'bold ' + Math.round(10 * scale) + 'px "Noto Sans TC", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // 黑色描邊
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.lineWidth = 2.5;
    ctx.strokeText(n.dmg, n.x, n.y);

    // 數值文字
    ctx.fillStyle = n.color;
    ctx.fillText(n.dmg, n.x, n.y);
    ctx.restore();
  }
}

function clear() { _nums.length = 0; }

window.ColorCatDamageNumber = {
  spawn: spawn,
  update: update,
  draw: draw,
  clear: clear,
};

})();
