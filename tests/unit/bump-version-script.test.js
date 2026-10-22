/**
 * tests/unit/bump-version-script.test.js
 *
 * 驗證 scripts/bump-version.js：
 *   - bumpIndexHtml 只更新 var V 與「非 type="application/json"」區塊內的 ?v=
 *   - JSON 資料區塊（如 boot-banners-data 等）逐字保留
 *   - ?v=20260707 等非 app 格式不被誤改
 *   - incrementVersion 同日遞增後綴
 *   - require 檔案時不得改到任何檔案（由 main 只在 CLI 執行保證）
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const { bumpIndexHtml, incrementVersion } = require('../../scripts/bump-version.js');

describe('scripts/bump-version.js', () => {
  describe('bumpIndexHtml', () => {
    it('更新 var V 與非 JSON 區塊的 ?v=，跳過 type="application/json" 資料區塊', () => {
      const json1 = '<script id="boot-public-lists-data" type="application/json" data-ts="1">{"image":"https://x/LOGO/a.png?v=0.20260923d","b":"?v=0.20261020"}</script>';
      const json2 = `<script type='application/json' id="boot-home-summary-data">{"img":"?v=0.20260908"}</script>`;

      const html = [
        '<!DOCTYPE html>',
        '<html>',
        '<head>',
        "  <script>var V='0.20261022';</script>",
        '  <link rel="stylesheet" href="css/a.css?v=0.20261022">',
        '  <script src="js/a.js?v=0.20261022a"></script>',
        '  ' + json1,
        '  ' + json2,
        '  <a href="?v=20260707">link</a>',
        '</head>',
        '</html>',
      ].join('\n');

      const { html: out, count } = bumpIndexHtml(html, '0.20261023');

      // var V 被更新
      expect(out).toContain("var V='0.20261023'");
      // css / js 的 ?v= 被更新
      expect(out).toContain('css/a.css?v=0.20261023');
      expect(out).toContain('js/a.js?v=0.20261023');
      // JSON 資料區塊逐字保留
      expect(out).toContain(json1);
      expect(out).toContain(json2);
      // 非 app 版號格式不變
      expect(out).toContain('?v=20260707');
      // count 只計算被替換的 ?v=（css + js = 2）
      expect(count).toBe(2);
    });

    it('一般 <script>（無 type 或 type="module"）內的 ?v= 仍會被替換', () => {
      const html = [
        `<script>var x='js/a.js?v=0.20261022';</script>`,
        '<script type="module" src="js/b.js?v=0.20261022"></script>',
      ].join('\n');

      const { html: out, count } = bumpIndexHtml(html, '0.20261023');
      expect(out).toContain('js/a.js?v=0.20261023');
      expect(out).toContain('js/b.js?v=0.20261023');
      expect(count).toBe(2);
    });

    it('真實 index.html：JSON 資料區塊逐字不變，區塊外舊 ?v= 皆被更新', () => {
      const realHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
      const newVer = '0.20991231';
      const jsonRe = /<script\b[^>]*\btype=["']application\/json["'][^>]*>[\s\S]*?<\/script>/gi;

      const origBlocks = realHtml.match(jsonRe) || [];
      expect(origBlocks.length).toBeGreaterThan(0);

      const { html: out, count } = bumpIndexHtml(realHtml, newVer);
      expect(count).toBeGreaterThan(0);

      const newBlocks = out.match(jsonRe) || [];
      expect(newBlocks.length).toBe(origBlocks.length);
      for (let i = 0; i < origBlocks.length; i++) {
        expect(newBlocks[i]).toBe(origBlocks[i]);
      }

      // 區塊外不再有舊 ?v=0.\d{8}[a-z]*（除了新版號）
      const stripped = out.replace(jsonRe, '');
      const leftover = stripped.match(/\?v=0\.\d{8}[a-z]*/g) || [];
      for (const hit of leftover) {
        expect(hit).toBe('?v=' + newVer);
      }
    });
  });

  describe('incrementVersion', () => {
    it('同日 0.YYYYMMDD → 0.YYYYMMDDa', () => {
      // 台北 2026-10-22 12:00
      jest.useFakeTimers().setSystemTime(new Date('2026-10-22T12:00:00+08:00'));
      try {
        expect(incrementVersion('0.20261022')).toBe('0.20261022a');
      } finally {
        jest.useRealTimers();
      }
    });
  });
});
