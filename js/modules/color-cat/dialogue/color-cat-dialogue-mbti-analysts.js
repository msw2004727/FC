/* ColorCat — MBTI 對話資料庫（分析家：INTJ/INTP/ENTJ/ENTP） */
;(function() {
  'use strict';

  var D = window.ColorCatDialogueMBTI = window.ColorCatDialogueMBTI || {};

  // INTJ 戰略家 — 冷靜、策略、高效、完美主義
  D['INTJ'] = {
    idle: ['完美的計畫', '讓我分析一下', '效率至上', '一切盡在掌控'],
    sleep: ['策略性休息', '養精蓄銳', '休息是為了更遠'],
    biteBall: ['精準打擊', '計算完畢'],
    chase: ['目標鎖定', '追蹤中'],
    dash: ['迅速突破', '計畫執行'],
    climbBox: ['制高點確認', '視野良好'],
    climbWall: ['登高望遠', '全局掌握'],
    watchFlower: ['結構很精妙', '數據收集中', '有趣的樣本'],
    attackEnemy: ['弱點已找到', '戰術啟動', '毫無勝算'],
    chaseButterfly: ['飛行路徑分析', '捕獲目標'],
    hurt: ['失算了', '需要修正'],
    general: ['嗯', '無聊', '繼續']
  };

  // INTP 邏輯家 — 好奇、分析、恍神、提問風格
  D['INTP'] = {
    idle: ['為什麼呢...', '有趣的假設', '讓我想想', '理論上來說'],
    sleep: ['大腦需要重啟', '夢裡也在思考', '意識暫停'],
    biteBall: ['物理實驗', '力學測試'],
    chase: ['運動軌跡分析', '追蹤變數'],
    dash: ['加速度實驗', '慣性定律'],
    climbBox: ['重力測試', '高度變數'],
    climbWall: ['摩擦力研究', '垂直位移'],
    watchFlower: ['花瓣幾何學', '自然的演算法', '碎形結構'],
    attackEnemy: ['邏輯必勝', '公式已解', '不合理'],
    chaseButterfly: ['飛行模式解析', '混沌理論'],
    hurt: ['不符合計算', '誤差值過大'],
    general: ['嗯哼', '有意思', '也許吧']
  };

  // ENTJ 指揮官 — 統帥、果斷、權威、簡短命令
  D['ENTJ'] = {
    idle: ['全員集合', '準備行動', '時間寶貴', '目標明確'],
    sleep: ['短暫休整', '補充能量', '高效休息'],
    biteBall: ['全力出擊', '力量展示'],
    chase: ['追擊！', '不許逃'],
    dash: ['突進！', '衝鋒！'],
    climbBox: ['佔領制高點', '指揮位置'],
    climbWall: ['攻佔！', '勢不可擋'],
    watchFlower: ['偶爾放鬆', '戰略性觀察', '不錯的風景'],
    attackEnemy: ['殲滅目標', '勢如破竹', '投降吧'],
    chaseButterfly: ['訓練反應', '動態追蹤'],
    hurt: ['小傷而已', '不影響戰局'],
    general: ['繼續', '行動', '報告']
  };

  // ENTP 辯論家 — 機智、挑戰、不可預測、愛玩
  D['ENTP'] = {
    idle: ['好無聊喔~', '來點刺激的', '有人要辯論嗎', '哈哈哈'],
    sleep: ['才不想睡', '夢裡也要贏', '暫時休戰'],
    biteBall: ['這樣更好玩', '換個踢法'],
    chase: ['追不到我吧~', '抓我啊'],
    dash: ['帥不帥！', '花式翻滾'],
    climbBox: ['新角度新發現', '翻轉視角'],
    climbWall: ['打賭我爬得上', '挑戰成功'],
    watchFlower: ['花也有邏輯嗎', '反直覺的美', '值得研究'],
    attackEnemy: ['來過招啊', '你的破綻太多', '認輸吧'],
    chaseButterfly: ['比賽抓蝴蝶', '計策啟動'],
    hurt: ['這不算什麼', '讓我想個對策'],
    general: ['嘿', '所以呢', '然後？']
  };

})();
