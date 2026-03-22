/**
 * ColorCat MBTI 人格模組
 * 定義 16 種 MBTI 人格類型及其行為權重乘數
 */
(function () {
  'use strict';

  // ========== 16 種 MBTI 類型定義與權重乘數 ==========
  // 權重說明：1.0 = 無變化，>1.0 = 增強，<1.0 = 減弱
  //
  // 設計原則：
  //   E 外向：活動量高（dash、chase、biteBall 較高），sleep 低，talkCd 低（更常說話）
  //   I 內向：sleep 高，watchFlower 高，dash 低，talkCd 高（較少說話）
  //   S 感覺：務實型（biteBall、climbBox 較高），chaseButterfly 低
  //   N 直覺：chaseButterfly、watchFlower 較高
  //   T 思考：attackEnemy 較高，watchFlower 較低
  //   F 情感：watchFlower 較高，attackEnemy 較低
  //   J 判斷：climbBox 較高（有結構），biteBall 較高
  //   P 感知：chase、dash、chaseButterfly 較高

  var TYPES = {
    // ---- 分析家群組 (NT) ----
    INTJ: {
      name: '戰略家',
      weights: {
        biteBall: 1.0, chase: 0.7, dash: 0.8,
        climbBox: 1.3, climbWall: 1.2, sleep: 1.0,
        watchFlower: 0.8, chaseButterfly: 0.7,
        attackEnemy: 1.3, talkCdMultiplier: 1.4
      }
    },
    INTP: {
      name: '邏輯家',
      weights: {
        biteBall: 0.8, chase: 1.2, dash: 0.7,
        climbBox: 0.9, climbWall: 1.4, sleep: 1.1,
        watchFlower: 1.0, chaseButterfly: 1.2,
        attackEnemy: 0.9, talkCdMultiplier: 1.5
      }
    },
    ENTJ: {
      name: '指揮官',
      weights: {
        biteBall: 1.2, chase: 1.0, dash: 1.3,
        climbBox: 1.1, climbWall: 1.0, sleep: 0.6,
        watchFlower: 0.6, chaseButterfly: 0.7,
        attackEnemy: 1.5, talkCdMultiplier: 0.7
      }
    },
    ENTP: {
      name: '辯論家',
      weights: {
        biteBall: 1.1, chase: 1.4, dash: 1.3,
        climbBox: 0.8, climbWall: 1.1, sleep: 0.7,
        watchFlower: 0.8, chaseButterfly: 1.3,
        attackEnemy: 1.1, talkCdMultiplier: 0.6
      }
    },

    // ---- 外交官群組 (NF) ----
    INFJ: {
      name: '提倡者',
      weights: {
        biteBall: 0.7, chase: 0.8, dash: 0.6,
        climbBox: 0.9, climbWall: 1.0, sleep: 1.3,
        watchFlower: 1.5, chaseButterfly: 1.2,
        attackEnemy: 0.7, talkCdMultiplier: 1.3
      }
    },
    INFP: {
      name: '調解者',
      weights: {
        biteBall: 0.6, chase: 0.9, dash: 0.5,
        climbBox: 0.8, climbWall: 0.9, sleep: 1.4,
        watchFlower: 1.6, chaseButterfly: 1.4,
        attackEnemy: 0.5, talkCdMultiplier: 1.4
      }
    },
    ENFJ: {
      name: '主人公',
      weights: {
        biteBall: 1.0, chase: 1.1, dash: 1.0,
        climbBox: 1.0, climbWall: 0.9, sleep: 0.8,
        watchFlower: 1.2, chaseButterfly: 1.0,
        attackEnemy: 1.0, talkCdMultiplier: 0.6
      }
    },
    ENFP: {
      name: '活動家',
      weights: {
        biteBall: 1.2, chase: 1.5, dash: 1.4,
        climbBox: 0.7, climbWall: 0.8, sleep: 0.6,
        watchFlower: 1.3, chaseButterfly: 1.5,
        attackEnemy: 0.8, talkCdMultiplier: 0.5
      }
    },

    // ---- 哨兵群組 (SJ) ----
    ISTJ: {
      name: '物流師',
      weights: {
        biteBall: 1.1, chase: 0.8, dash: 0.9,
        climbBox: 1.4, climbWall: 1.0, sleep: 1.0,
        watchFlower: 0.7, chaseButterfly: 0.6,
        attackEnemy: 1.2, talkCdMultiplier: 1.5
      }
    },
    ISFJ: {
      name: '守衛者',
      weights: {
        biteBall: 0.9, chase: 0.7, dash: 0.7,
        climbBox: 1.2, climbWall: 0.8, sleep: 1.3,
        watchFlower: 1.3, chaseButterfly: 0.8,
        attackEnemy: 0.8, talkCdMultiplier: 1.3
      }
    },
    ESTJ: {
      name: '總經理',
      weights: {
        biteBall: 1.2, chase: 1.0, dash: 1.2,
        climbBox: 1.3, climbWall: 1.0, sleep: 0.7,
        watchFlower: 0.5, chaseButterfly: 0.5,
        attackEnemy: 1.4, talkCdMultiplier: 0.7
      }
    },
    ESFJ: {
      name: '執政官',
      weights: {
        biteBall: 1.0, chase: 1.0, dash: 0.9,
        climbBox: 1.1, climbWall: 0.8, sleep: 0.9,
        watchFlower: 1.1, chaseButterfly: 0.9,
        attackEnemy: 0.9, talkCdMultiplier: 0.6
      }
    },

    // ---- 探險家群組 (SP) ----
    ISTP: {
      name: '鑑賞家',
      weights: {
        biteBall: 1.3, chase: 1.1, dash: 1.2,
        climbBox: 1.1, climbWall: 1.5, sleep: 0.8,
        watchFlower: 0.9, chaseButterfly: 0.8,
        attackEnemy: 1.2, talkCdMultiplier: 1.4
      }
    },
    ISFP: {
      name: '探險家',
      weights: {
        biteBall: 0.8, chase: 1.0, dash: 0.7,
        climbBox: 0.7, climbWall: 1.0, sleep: 1.2,
        watchFlower: 1.5, chaseButterfly: 1.3,
        attackEnemy: 0.6, talkCdMultiplier: 1.3
      }
    },
    ESTP: {
      name: '企業家',
      weights: {
        biteBall: 1.4, chase: 1.3, dash: 1.5,
        climbBox: 1.0, climbWall: 1.2, sleep: 0.5,
        watchFlower: 0.4, chaseButterfly: 0.7,
        attackEnemy: 1.4, talkCdMultiplier: 0.7
      }
    },
    ESFP: {
      name: '表演者',
      weights: {
        biteBall: 1.3, chase: 1.4, dash: 1.4,
        climbBox: 0.9, climbWall: 0.8, sleep: 0.6,
        watchFlower: 1.2, chaseButterfly: 1.2,
        attackEnemy: 0.9, talkCdMultiplier: 0.5
      }
    }
  };

  // 預先建立類型代碼陣列，供隨機抽選使用
  var TYPE_KEYS = [];
  for (var key in TYPES) {
    if (TYPES.hasOwnProperty(key)) {
      TYPE_KEYS.push(key);
    }
  }

  /**
   * 取得指定 MBTI 類型的行為權重乘數
   * @param {string} mbtiType - MBTI 類型代碼（例如 'INTJ'）
   * @returns {object|null} 權重乘數物件，若類型不存在則回傳 null
   */
  function getWeights(mbtiType) {
    var entry = TYPES[mbtiType];
    if (!entry) {
      return null;
    }
    // 回傳淺拷貝，避免外部修改影響原始資料
    var result = {};
    var w = entry.weights;
    for (var k in w) {
      if (w.hasOwnProperty(k)) {
        result[k] = w[k];
      }
    }
    return result;
  }

  /**
   * 隨機指派一種 MBTI 類型
   * @returns {string} 隨機選出的 MBTI 類型代碼（例如 'ENFP'）
   */
  function randomType() {
    var index = Math.floor(Math.random() * TYPE_KEYS.length);
    return TYPE_KEYS[index];
  }

  // ========== 公開 API ==========
  window.ColorCatMBTI = {
    TYPES: TYPES,
    getWeights: getWeights,
    randomType: randomType
  };
})();
