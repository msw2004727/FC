/* ================================================
   ColorCat — 共用常數與工具
   ================================================ */
;(function() {

window.ColorCatConfig = {
  SCENE_H: 127,
  GROUND_Y: 107,        // SCENE_H - 20
  CHAR_GROUND_Y: 127,   // groundY + 20，角色腳底位置
  SPRITE_SIZE: 32,
  SPRITE_SCALE: 1.8,
  SPRITE_DRAW: 32 * 1.8, // 57.6

  // ── 角色皮膚 ──
  SKINS: {
    whiteCat:   { folder: 'whiteCat',   prefix: 'Outlined_', name: '小白 ♀', gender: 'female', species: 'cat' },
    blackCat:   { folder: 'blackCat',   prefix: 'Outlined_', name: '小黑 ♂', gender: 'male',   species: 'cat',   altColour: true },
    blueRabbit: { folder: 'BlueRabbit', prefix: 'Outlined_', name: '藍兔 ♂', gender: 'male',   species: 'bunny' },
    pinkRabbit: { folder: 'PinkRabbit', prefix: 'Outlined_', name: '粉兔 ♀', gender: 'female', species: 'bunny', altColour: true },
  },

  // ── 兔子動作對應（與貓咪不同的 num/suffix/frames） ──
  BUNNY_ACTION_MAP: {
    idle:        { num: '1', suffix: 'Bunny_Idle-Sheet.png',        frames: 8 },
    fall:        { num: '4', suffix: 'Bunny_Fall-Sheet.png',        frames: 4 },
    death:       { num: '11', suffix: 'Bunny_Death-Sheet.png',    frames: 12 },
    walk:        { num: '2', suffix: 'Bunny_Run-Sheet.png',         frames: 8 },
    run:         { num: '2', suffix: 'Bunny_Run-Sheet.png',         frames: 8 },
    jump:        { num: '3', suffix: 'Bunny_Jump-Sheet.png',        frames: 4 },
    roll:        { num: '5', suffix: 'Bunny_Dash-Sheet.png',        frames: 4 },       // 無 Roll，用 Dash 替代
    attack:      { num: '7', suffix: 'Bunny_Attack_1-Sheet.png',    frames: 8, fw: 64 },
    jump_attack: { num: '3', suffix: 'Bunny_Jump-Sheet.png',        frames: 4 },       // 無 Jump Attack，用 Jump 替代
    ledge_land:  { num: '3', suffix: 'Bunny_Jump-Sheet.png',        frames: 4 },       // 無 Ledge，用 Jump 替代
    ledge_idle:  { num: '1', suffix: 'Bunny_Idle-Sheet.png',        frames: 8 },       // 無 Ledge，用 Idle 替代
    climb:       { num: '1', suffix: 'Bunny_Idle-Sheet.png',        frames: 8 },       // 無 Climb，用 Idle 替代
    wall_slide:  { num: '6', suffix: 'Bunny_Wall_Slide-Sheet.png', frames: 4 },
  },

  // ── 動作定義 ──
  // type: loop=循環, move=邊移動邊播, once=播一次回idle
  ACTION_DEFS: {
    // ── 啟用中 ──
    idle:        { num: '1',  suffix: 'Cat_Idle-Sheet.png',        frames: 8,  speed: 0.15, type: 'loop', label: '待機 Idle' },
    fall:        { num: '4',  suffix: 'Cat_Fall-Sheet.png',        frames: 4,  speed: 0.12, type: 'loop', label: '下落 Fall' },
    death:       { num: '18', suffix: 'Cat_Death-Sheet.png',      frames: 9,  speed: 0.12, type: 'once', label: '倒地 Death' },
    walk:        { num: '2',  suffix: 'Cat_Run-Sheet.png',         frames: 10, speed: 0.15, type: 'move', label: '散步 Walk',   moveSpeed: 1.5 },
    run:         { num: '2',  suffix: 'Cat_Run-Sheet.png',         frames: 10, speed: 0.30, type: 'move', label: '跑步 Run',    moveSpeed: 3 },
    jump:        { num: '3',  suffix: 'Cat_Jump-Sheet.png',        frames: 4,  speed: 0.15, type: 'once', label: '跳躍 Jump',   jumpVy: -5 },
    roll:        { num: '10', suffix: 'Cat_Roll-Sheet.png',        frames: 8,  speed: 0.25, type: 'move', label: '翻滾 Roll',   moveSpeed: 5 },
    attack:      { num: '15', suffix: 'Cat_Attack-Sheet.png',      frames: 6,  speed: 0.22, type: 'move', label: '攻擊 Attack', moveSpeed: 2, fw: 64 },
    jump_attack: { num: '16', suffix: 'Cat_Jump_Attack-Sheet.png', frames: 6,  speed: 0.22, type: 'once', label: '跳躍攻擊',    jumpVy: -3,  fw: 64 },
    ledge_land:  { num: '7',  suffix: 'Cat_Ledge_Grab_Land-Sheet.png',  frames: 4,  speed: 0.2,  type: 'once', label: '攀緣著地' },
    ledge_idle:  { num: '8',  suffix: 'Cat_Ledge_Grab_Idle-Sheet.png',  frames: 8,  speed: 0.15, type: 'loop', label: '攀緣待機' },
    climb:       { num: '9',  suffix: 'Cat_Climb_Ladder-Sheet.png',     frames: 8,  speed: 0.2,  type: 'loop', label: '爬梯子 Climb' },
    wall_slide:  { num: '5',  suffix: 'Cat_Wall_Slide-Sheet.png',        frames: 4,  speed: 0.15, type: 'loop', label: '滑牆 Wall Slide' },
  },

  // ── 備用動作（未來選擇性開放，取消註解移入 ACTION_DEFS 即可） ──
  // dash:             { num: '6',  suffix: 'Cat_Dash-Sheet.png',               frames: 4,  speed: 0.3,  type: 'move', label: '衝刺 Dash',        moveSpeed: 8 },
  // long_roll:        { num: '11', suffix: 'Cat_Long_Roll-Sheet.png',          frames: 12, speed: 0.25, type: 'move', label: '長翻滾',           moveSpeed: 5 },
  // spin:             { num: '12', suffix: 'Cat_Spin-Sheet.png',               frames: 4,  speed: 0.3,  type: 'once', label: '旋轉 Spin' },
  // double_jump:      { num: '13', suffix: 'Cat_Double_Jump-Sheet.png',        frames: 8,  speed: 0.2,  type: 'once', label: '二段跳',           jumpVy: -4 },
  // long_double_jump: { num: '14', suffix: 'Cat_Long_Double_Jump-Sheet.png',   frames: 12, speed: 0.2,  type: 'once', label: '長二段跳',         jumpVy: -4 },
  // take_damage:      { num: '17', suffix: 'Cat_Take_Damage-Sheet.png',        frames: 4,  speed: 0.15, type: 'once', label: '受傷 Damage' },
  // push:             { num: '19', suffix: 'Cat_Push-Sheet.png',               frames: 8,  speed: 0.2,  type: 'move', label: '推 Push',          moveSpeed: 1.5 },
  // pull:             { num: '20', suffix: 'Cat_Pull-Sheet.png',               frames: 8,  speed: 0.2,  type: 'move', label: '拉 Pull',          moveSpeed: -1.5 },
  // ranged_attack:    { num: '21', suffix: 'Cat_Ranged_Attack-Sheet.png',      frames: 6,  speed: 0.2,  type: 'once', label: '遠程攻擊' },
  // jump_ranged:      { num: '22', suffix: 'Cat_Jump_Ranged_Attack-Sheet.png', frames: 6,  speed: 0.2,  type: 'once', label: '跳躍遠攻',        jumpVy: -3 },
  // attack_2:         { num: '23', suffix: 'Cat_Attack_2_Hits-Sheet.png',      frames: 10, speed: 0.25, type: 'move', label: '連擊 Combo',       moveSpeed: 2, fw: 64 },
  // special_attack:   { num: '24', suffix: 'Cat_Special_Attack-Sheet.png',     frames: 8,  speed: 0.2,  type: 'once', label: '必殺技 Special',   fw: 64 },

  // 養成數值已移至 color-cat-stats.js (ColorCatStats)
};

// ── 工具函式 ──

// 判斷深淺主題
ColorCatConfig.isThemeDark = function() {
  return document.documentElement.getAttribute('data-theme') === 'dark';
};

// 組合精靈圖檔案路徑
ColorCatConfig.getSpriteFilePath = function(skinKey, actionDef, actionKey) {
  var skin = ColorCatConfig.SKINS[skinKey];
  if (!skin) return '';
  var num = actionDef.num;
  var suffix = actionDef.suffix;
  // 兔子：用 BUNNY_ACTION_MAP 覆蓋 num/suffix
  if (skin.species === 'bunny' && actionKey && ColorCatConfig.BUNNY_ACTION_MAP[actionKey]) {
    var bmap = ColorCatConfig.BUNNY_ACTION_MAP[actionKey];
    num = bmap.num; suffix = bmap.suffix;
  }
  var alt = skin.altColour ? 'Alternative_Colour_' : '';
  var fileName = skin.prefix + num + '_' + alt + suffix;
  return 'img/sprites/' + skin.folder + '/' + fileName;
};

})();
