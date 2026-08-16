'use strict';

/**
 * 把 1–4 號海報統一成 800×1200（2:3）。
 *
 *     node tools/reframe-posters.js
 *
 * 原始素材一張是正方形、一張比 2:3 更瘦，卡片用 object-fit: cover 裁切，
 * 結果就是標題被切掉（NEO-SHADOW 只看得到 EO-SHADOW）。
 *
 * 作法是串流平台常見的那一種：完整的海報置中不裁切，
 * 四周用同一張圖放大模糊後墊底，畫面填滿又不損失任何內容。
 *
 * 這是一次性的正規化，而且**不是冪等的**——邊緣的內陰影每跑一次就疊一層，
 * 重複執行會讓四周越來越黑。因此已經是 800×1200 的檔案一律跳過，
 * 這樣重跑才安全，也符合它的用途：把還沒正規化的素材補正。
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const DIR = path.join(__dirname, '..', 'FakeTheater', 'pic');
const W = 800, H = 1200;

const html = (dataUri) => `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  * { margin: 0; padding: 0; }
  html, body { width: 100%; height: 100%; overflow: hidden; background: #000; }
  .stage { position: relative; width: 100%; height: 100%; overflow: hidden; }
  .fill, .main { position: absolute; inset: 0; width: 100%; height: 100%; }
  /* 墊底：放大 + 模糊 + 壓暗，只是為了填滿邊緣，不該搶走注意力 */
  .fill { object-fit: cover; filter: blur(34px) saturate(1.25) brightness(.5); transform: scale(1.25); }
  .main { object-fit: contain; }
  /* 讓中央的海報與模糊底之間有一點分界，不會糊成一片 */
  .edge { position: absolute; inset: 0; pointer-events: none;
          box-shadow: inset 0 0 90px 30px rgba(0,0,0,.45); }
</style></head><body>
  <div class="stage">
    <img class="fill" src="${dataUri}">
    <img class="main" src="${dataUri}">
    <div class="edge"></div>
  </div>
</body></html>`;

/**
 * 從檔頭讀出尺寸，不必為此裝影像套件。
 * PNG 的寬高是 IHDR 區塊的前兩個 32 位元大端整數，固定落在第 16–23 位元組。
 * @param {Buffer} buf
 * @returns {{width: number, height: number}|null} 不是 PNG 就回 null
 */
function pngSize(buf) {
    const PNG_MAGIC = '89504e470d0a1a0a';
    if (buf.length < 24 || buf.subarray(0, 8).toString('hex') !== PNG_MAGIC) return null;
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

(async () => {
    const browser = await chromium.launch(
        process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}
    );

    for (const id of [1, 2, 3, 4]) {
        const file = path.join(DIR, `${id}.png`);
        // 原始檔副檔名是 .png，內容其實有 JPEG 也有 PNG，用位元組判斷
        const buf = fs.readFileSync(file);

        const size = pngSize(buf);
        if (size && size.width === W && size.height === H) {
            console.log(`  – pic/${id}.png 已是 ${W}×${H}，跳過`);
            continue;
        }

        const mime = buf[0] === 0xff && buf[1] === 0xd8 ? 'image/jpeg' : 'image/png';
        const dataUri = `data:${mime};base64,${buf.toString('base64')}`;

        const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
        await page.setContent(html(dataUri), { waitUntil: 'load' });
        await page.evaluate(() => Promise.all(
            [...document.images].filter(i => !i.complete)
                .map(i => new Promise(r => { i.onload = i.onerror = r; }))));
        await page.waitForTimeout(200);
        await page.screenshot({ path: file });
        await page.close();
        console.log(`  ✓ pic/${id}.png → ${W}×${H}`);
    }

    await browser.close();
})();
