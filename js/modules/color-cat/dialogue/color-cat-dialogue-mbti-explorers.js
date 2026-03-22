/* ColorCat — MBTI 對話資料庫（探險家：ISTP/ISFP/ESTP/ESFP） */
;(function() {
  'use strict';

  var D = window.ColorCatDialogueMBTI = window.ColorCatDialogueMBTI || {};

  // ISTP 鑑賞家 — 務實、觀察力強、沉默寡言、工具導向
  D['ISTP'] = {
    idle: ['觀察中', '研究構造', '手癢了', '無所事事'],
    sleep: ['充電', '省電模式', '暫停'],
    biteBall: ['角度完美', '力道拿捏'],
    chase: ['效率路線', '最短距離'],
    dash: ['實戰演練', '體能測試'],
    climbBox: ['結構分析', '承重測試'],
    climbWall: ['技巧攀爬', '找到著力點'],
    watchFlower: ['觀察構造', '花瓣材質', '自然工藝'],
    attackEnemy: ['精準出擊', '一擊必殺', '弱點打擊'],
    chaseButterfly: ['觀察飛行', '速度測量'],
    hurt: ['不影響', '小事'],
    general: ['嗯', '知道了', '隨便']
  };

  // ISFP 探險家 — 藝術、敏感、溫柔、熱愛自然
  D['ISFP'] = {
    idle: ['好安靜...', '感受微風', '今天好美', '靜靜的...'],
    sleep: ['做個彩色的夢', '晚安世界', '星空好美'],
    biteBall: ['溫柔地踢~', '慢慢來'],
    chase: ['自在地跑', '隨風而行'],
    dash: ['自由的感覺', '隨心所欲'],
    climbBox: ['欣賞風景', '不一樣的角度'],
    climbWall: ['觸摸天空', '更靠近雲'],
    watchFlower: ['好美...', '想畫下來', '花的顏色好溫柔'],
    attackEnemy: ['請別破壞美好', '為了和平', '不得已的'],
    chaseButterfly: ['好自由...', '翩翩起舞'],
    hurt: ['唔...', '會好的'],
    general: ['嗯...', '好', '隨意']
  };

  // ESTP 企業家 — 大膽、直接、精力充沛、沒耐性
  D['ESTP'] = {
    idle: ['好無聊！', '找點事做', '誰來挑戰', '閒不住啊'],
    sleep: ['不想睡', '浪費時間', '就躺一下'],
    biteBall: ['看這球！', '暴力美學'],
    chase: ['衝啊！', '追上了！'],
    dash: ['帥翻了！', '極限操作'],
    climbBox: ['一步登頂', '小意思'],
    climbWall: ['徒手攀岩', '刺激！'],
    watchFlower: ['偶爾看看', '還行吧', '快走快走'],
    attackEnemy: ['來啊！', '放馬過來', '秒殺！'],
    chaseButterfly: ['比速度！', '抓到了'],
    hurt: ['就這？', '不痛不癢'],
    general: ['嘿', '走', '快']
  };

  // ESFP 表演者 — 自發、愛玩、超級活潑、社交型
  D['ESFP'] = {
    idle: ['今天也好棒♪', '唱歌跳舞~', '好開心好開心', '有人要玩嗎'],
    sleep: ['跳舞跳累了', '明天繼續玩', '晚安~♪'],
    biteBall: ['看我表演！', '花式踢球♪'],
    chase: ['跑跑跳跳♪', '追我呀~'],
    dash: ['轉圈圈~', '旋轉！'],
    climbBox: ['登場！', '站在舞台上'],
    climbWall: ['表演攀岩！', '精彩吧'],
    watchFlower: ['花花好美♪', '想戴花環', '拍美照~'],
    attackEnemy: ['看我的表演！', '華麗一擊', '閃亮登場'],
    chaseButterfly: ['蝴蝶舞♪', '一起跳舞吧'],
    hurt: ['哎呀~', '沒事啦~♪'],
    general: ['耶~', '啦啦~', '嘻♪']
  };

})();
