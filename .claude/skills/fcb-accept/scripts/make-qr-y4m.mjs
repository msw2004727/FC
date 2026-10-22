// 產生「畫面裡一直有某個 QR 碼」的 y4m 影片，給 Chromium 假相機用：
//   --use-fake-device-for-media-stream --use-file-for-fake-video-capture=<out.y4m>
// 用法：node make-qr-y4m.mjs <QR 內容> <out.y4m>
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(path.join(process.env.FCB_DIR || 'D:/Users/msw74/Documents/github/FC-B', 'package.json'));
const QRCode = require('qrcode');

const [text, out] = process.argv.slice(2);
if (!text || !out) { console.error('用法：node make-qr-y4m.mjs <text> <out.y4m>'); process.exit(2); }

const W = 640, H = 480, FRAMES = 10;
const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
const n = qr.modules.size;
const quiet = 4;
const scale = Math.floor(Math.min(W, H) * 0.8 / (n + quiet * 2));
const size = scale * (n + quiet * 2);
const ox = Math.floor((W - size) / 2), oy = Math.floor((H - size) / 2);

const y = Buffer.alloc(W * H, 200); // 淺灰背景
for (let py = 0; py < size; py += 1) {
  for (let px = 0; px < size; px += 1) {
    const mx = Math.floor(px / scale) - quiet, my = Math.floor(py / scale) - quiet;
    const dark = mx >= 0 && my >= 0 && mx < n && my < n && qr.modules.get(mx, my);
    y[(oy + py) * W + ox + px] = dark ? 16 : 235;
  }
}
const uv = Buffer.alloc((W / 2) * (H / 2), 128);
const header = Buffer.from(`YUV4MPEG2 W${W} H${H} F15:1 Ip A1:1 C420jpeg\n`);
const parts = [header];
for (let i = 0; i < FRAMES; i += 1) parts.push(Buffer.from('FRAME\n'), y, uv, uv);
fs.writeFileSync(out, Buffer.concat(parts));
console.log(`wrote ${out} (${n}x${n} modules, scale ${scale})`);
