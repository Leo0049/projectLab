'use strict';

/**
 * 產生 5–8 號電影的直式海報與橫式主視覺。
 *
 *     node tools/generate-posters.js
 *
 * 為什麼是用瀏覽器產圖：開發這個專案的環境沒有任何影像處理套件
 * （沒有 Pillow、沒有 ImageMagick、沒有 sharp），但有 Chromium。
 * 漸層、高斯模糊、混合模式、字距、底片顆粒（feTurbulence）
 * 全都是瀏覽器本來就會的事，用 HTML/SVG 排版再截圖，
 * 尺寸與字級都能精準控制，也不必為了四張圖多裝一套相依套件。
 *
 * 輸出會直接覆蓋 FakeTheater/pic/ 底下對應的檔案。
 * 每部片的亂數都由固定種子推導，同一份程式跑幾次結果都一樣。
 *
 * 需要 devDependencies 裡的 playwright。若要指定既有的 Chromium，
 * 設環境變數 CHROMIUM_PATH（與 tests/e2e.js 相同）。
 */

const path = require('path');
const { chromium } = require('playwright');

const OUT = path.join(__dirname, '..', 'FakeTheater', 'pic');

const POSTER = { width: 800, height: 1200 };
const BANNER = { width: 1600, height: 900 };

/* 共用的質感層：底片顆粒 + 暗角，讓純 CSS 的畫面不會太「乾淨」而失真 */
const GRAIN = `
<svg class="grain" xmlns="http://www.w3.org/2000/svg">
  <filter id="g" x="-60%" y="-60%" width="220%" height="220%"><feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="4"/></filter>
  <rect width="100%" height="100%" filter="url(#g)"/>
</svg>`;

const BASE_CSS = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 100%; height: 100%; overflow: hidden; background: #000; }
  .stage { position: relative; width: 100%; height: 100%; overflow: hidden; }
  .art, .grain, .vignette, .type { position: absolute; inset: 0; }
  .grain { opacity: .1; mix-blend-mode: overlay; pointer-events: none; }
  .vignette { pointer-events: none;
    background: radial-gradient(ellipse at 50% 42%, transparent 30%, rgba(0,0,0,.55) 78%, rgba(0,0,0,.88) 100%); }
  .scrim { position: absolute; inset: auto 0 0 0; height: 58%; pointer-events: none;
    background: linear-gradient(180deg,
      transparent 0%, rgba(0,0,0,.30) 30%, rgba(0,0,0,.66) 58%,
      rgba(0,0,0,.86) 80%, rgba(0,0,0,.93) 100%); }
  .type { display: flex; flex-direction: column; justify-content: flex-end;
          padding: 0 68px 62px; text-align: center; }
  .tagline { font: 400 19px/1.7 'Liberation Sans', sans-serif; letter-spacing: .34em;
             text-transform: uppercase; color: rgba(255,255,255,.62); margin-bottom: 30px; }
  h1 { font: 700 62px/1.06 'Liberation Sans', sans-serif; letter-spacing: .14em;
       text-transform: uppercase; color: #fff; }
  h1.small { font-size: 50px; }
  .zh { font: 400 27px/1 'WenQuanYi Zen Hei', sans-serif; letter-spacing: .5em;
        text-indent: .5em; color: rgba(255,255,255,.82); margin-top: 22px; }
  .rule { width: 74px; height: 1px; background: rgba(255,255,255,.35); margin: 34px auto 26px; }
  .billing { font: 400 11px/1.85 'Liberation Sans', sans-serif; letter-spacing: .1em;
             text-transform: uppercase; color: rgba(255,255,255,.38); }
  .billing b { font-weight: 700; color: rgba(255,255,255,.5); }
`;

/* 隨機但可重現：同一顆種子每次跑出同一張圖 */
function rng(seed) {
    let s = seed;
    return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
}

const BILLING = (extra) => `
  FAKETHEATER PICTURES <b>PRESENTS</b> &nbsp;·&nbsp; ${extra}<br>
  MUSIC BY A. LINDQVIST &nbsp;·&nbsp; EDITED BY R. OKONKWO &nbsp;·&nbsp; PRODUCTION DESIGN BY M. SATO<br>
  DIRECTOR OF PHOTOGRAPHY H. NAKAMURA &nbsp;·&nbsp; PRODUCED BY C. DELACROIX<br>
  <b>THIS IS A FICTIONAL FILM &nbsp;·&nbsp; NO SUCH TITLE EXISTS</b>
`;

/* ------------------------------------------------------------------ *
 * 5. BLADE OF ASHES — 一道燒紅的刀痕
 * ------------------------------------------------------------------ */
function bladeArt(w, h, seed) {
    const r = rng(seed);
    const embers = Array.from({ length: 130 }, () => {
        const x = r() * 100, y = 12 + r() * 88, s = 1 + r() * 3.4, o = .12 + r() * .68;
        return `<circle cx="${x}%" cy="${y}%" r="${s}" fill="#ff8a3d" opacity="${o.toFixed(2)}"/>`;
    }).join('');

    return `
    <div class="art" style="background:
        radial-gradient(ellipse 55% 62% at 50% 46%, #2a0906 0%, #140403 45%, #070202 100%);">
      <svg width="100%" height="100%" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
        <defs>
          <linearGradient id="blade" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stop-color="#3d0b06" stop-opacity="0"/>
            <stop offset="18%"  stop-color="#b81f10"/>
            <stop offset="46%"  stop-color="#ff5b28"/>
            <stop offset="54%"  stop-color="#ffe9c4"/>
            <stop offset="62%"  stop-color="#ff5b28"/>
            <stop offset="86%"  stop-color="#8d1509"/>
            <stop offset="100%" stop-color="#2a0705" stop-opacity="0"/>
          </linearGradient>
          <filter id="soft" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="${w * 0.028}"/></filter>
          <filter id="tight" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="${w * 0.004}"/></filter>
        </defs>

        <!-- 煙 -->
        <g filter="url(#soft)" opacity=".5">
          <ellipse cx="${w * .5}" cy="${h * .52}" rx="${w * .34}" ry="${h * .3}" fill="#5c1408"/>
          <ellipse cx="${w * .34}" cy="${h * .38}" rx="${w * .18}" ry="${h * .16}" fill="#2b0805"/>
          <ellipse cx="${w * .68}" cy="${h * .6}"  rx="${w * .2}"  ry="${h * .18}" fill="#2b0805"/>
        </g>

        <!-- 刀痕：外層光暈 + 內層銳利 -->
        <g transform="translate(${w * .5} ${h * .48}) rotate(9)">
          <rect x="${-w * .05}" y="${-h * .42}" width="${w * .1}" height="${h * .84}"
                fill="url(#blade)" filter="url(#soft)" opacity=".85"/>
          <rect x="${-w * .011}" y="${-h * .4}" width="${w * .022}" height="${h * .8}"
                fill="url(#blade)" filter="url(#tight)"/>
          <rect x="${-w * .0022}" y="${-h * .36}" width="${w * .0044}" height="${h * .72}"
                fill="#fff6e4" opacity=".92"/>
        </g>

        ${embers}
      </svg>
    </div>`;
}

/* ------------------------------------------------------------------ *
 * 6. ABOVE THE CLOUDS — 雲海與日出
 * ------------------------------------------------------------------ */
function cloudsArt(w, h, seed) {
    const r = rng(seed);
    const stars = Array.from({ length: 70 }, () => {
        const x = r() * 100, y = r() * 34, s = .6 + r() * 1.5, o = .2 + r() * .6;
        return `<circle cx="${x}%" cy="${y}%" r="${s}" fill="#fff" opacity="${o.toFixed(2)}"/>`;
    }).join('');

    // 三層山稜線，越後面越淡
    const ridge = (baseY, amp, fill, op) => {
        const pts = [];
        for (let i = 0; i <= 14; i++) {
            const x = (i / 14) * w;
            const y = baseY + Math.sin(i * 1.3 + seed) * amp - Math.abs(7 - i) * amp * .18;
            pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
        }
        return `<polygon points="0,${h} ${pts.join(' ')} ${w},${h}" fill="${fill}" opacity="${op}"/>`;
    };

    const clouds = Array.from({ length: 9 }, (_, i) => {
        const y = h * (.52 + r() * .22), x = r() * w;
        const rx = w * (.16 + r() * .26), ry = h * (.014 + r() * .022);
        return `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}"
                    fill="${i % 2 ? '#ffd9c2' : '#fff'}" opacity="${(.1 + r() * .22).toFixed(2)}"/>`;
    }).join('');

    return `
    <div class="art" style="background: linear-gradient(180deg,
        #10122e 0%, #241a44 22%, #5a2f57 42%, #a8535a 58%, #e08a5c 71%, #f5c07a 82%, #fbe0b0 100%);">
      <svg width="100%" height="100%" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
        <defs>
          <filter id="cglow" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="${w * .05}"/></filter>
          <filter id="cblur" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="${w * .018}"/></filter>
        </defs>
        ${stars}
        <circle cx="${w * .5}" cy="${h * .6}" r="${w * .17}" fill="#ffd79a" opacity=".55" filter="url(#cglow)"/>
        <circle cx="${w * .5}" cy="${h * .6}" r="${w * .078}" fill="#fff3d4"/>
        <g filter="url(#cblur)">${clouds}</g>
        ${ridge(h * .7, h * .04, '#7a4a63', .75)}
        ${ridge(h * .78, h * .05, '#432c48', .9)}
        ${ridge(h * .86, h * .035, '#1d1430', 1)}
        <circle cx="${w * .63}" cy="${h * .845}" r="${w * .006}" fill="#ffd98a"/>
      </svg>
    </div>`;
}

/* ------------------------------------------------------------------ *
 * 7. CORRIDOR SEVEN — 單點透視的走廊
 * ------------------------------------------------------------------ */
function corridorArt(w, h, seed) {
    const cx = w * .5, cy = h * .47;
    const frames = Array.from({ length: 16 }, (_, i) => {
        const t = i / 15;
        const k = Math.pow(1 - t, 2.1);
        const fw = w * .96 * k, fh = h * .72 * k;
        const op = (.13 + t * .8).toFixed(2);
        const hue = 168 + t * 26;
        return `<rect x="${cx - fw / 2}" y="${cy - fh / 2}" width="${fw}" height="${fh}"
                    fill="none" stroke="hsl(${hue} 78% ${28 + t * 46}%)"
                    stroke-width="${(1 + (1 - t) * 2.4).toFixed(2)}" opacity="${op}"/>`;
    }).join('');

    // 地板的反射條紋
    const floor = Array.from({ length: 16 }, (_, i) => {
        const t = i / 15, k = Math.pow(1 - t, 2.1);
        const fw = w * .96 * k, fh = h * .72 * k;
        return `<line x1="${cx - fw / 2}" y1="${cy + fh / 2}" x2="${cx - w * .96 / 2}" y2="${h}"
                    stroke="hsl(178 70% 40%)" stroke-width=".8" opacity="${(.06 + t * .16).toFixed(2)}"/>
                <line x1="${cx + fw / 2}" y1="${cy + fh / 2}" x2="${cx + w * .96 / 2}" y2="${h}"
                    stroke="hsl(178 70% 40%)" stroke-width=".8" opacity="${(.06 + t * .16).toFixed(2)}"/>`;
    }).join('');

    return `
    <div class="art" style="background: radial-gradient(circle at 50% 47%, #06232a 0%, #041318 42%, #010708 100%);">
      <svg width="100%" height="100%" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
        <defs>
          <filter id="vglow" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="${w * .045}"/></filter>
          <filter id="fglow" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="${w * .006}"/></filter>
        </defs>
        ${floor}
        ${frames}
        <ellipse cx="${cx}" cy="${cy}" rx="${w * .1}" ry="${h * .06}"
                 fill="#8ff4e6" opacity=".42" filter="url(#vglow)"/>
        <rect x="${cx - w * .028}" y="${cy - h * .028}" width="${w * .056}" height="${h * .056}"
              fill="#d8fffa" opacity=".9" filter="url(#fglow)"/>
        <!-- 走廊盡頭的人影 -->
        <g fill="#02181c" opacity=".92">
          <ellipse cx="${cx}" cy="${cy - h * .0135}" rx="${w * .0072}" ry="${w * .0088}"/>
          <path d="M ${cx - w * .0128} ${cy + h * .026}
                   Q ${cx} ${cy - h * .008} ${cx + w * .0128} ${cy + h * .026} Z"/>
        </g>
      </svg>
    </div>`;
}

/* ------------------------------------------------------------------ *
 * 8. SILENT FREQUENCY — 同心波紋，中間歸於無聲
 * ------------------------------------------------------------------ */
function frequencyArt(w, h, seed) {
    const cx = w * .5, cy = h * .46;
    const rings = Array.from({ length: 26 }, (_, i) => {
        const rad = (i + 1) * (w * .036);
        const op = (.5 - i * .017).toFixed(3);
        return `<circle cx="${cx}" cy="${cy}" r="${rad}" fill="none"
                    stroke="#3fd8ff" stroke-width="${(1.6 - i * .04).toFixed(2)}" opacity="${op}"/>`;
    }).join('');

    // 一條橫向波形，正中央被壓平成一直線
    const r = rng(seed);
    let d = '';
    for (let x = 0; x <= w; x += 4) {
        const t = x / w;
        const silence = Math.max(0, 1 - Math.pow(Math.abs(t - .5) / .17, 2));
        const amp = h * .085 * (1 - silence) * (.35 + .65 * Math.sin(t * Math.PI));
        const y = cy + Math.sin(t * 46) * amp * (.5 + r() * .5);
        d += `${x === 0 ? 'M' : 'L'} ${x} ${y.toFixed(1)} `;
    }

    const scan = Array.from({ length: Math.floor(h / 5) }, (_, i) =>
        `<rect x="0" y="${i * 5}" width="${w}" height="1.4" fill="#000" opacity=".2"/>`).join('');

    return `
    <div class="art" style="background: radial-gradient(circle at 50% 46%, #0b2f4d 0%, #05182b 46%, #01070f 100%);">
      <svg width="100%" height="100%" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
        <defs>
          <filter id="wglow" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="${w * .01}"/></filter>
          <filter id="cglow2" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="${w * .06}"/></filter>
        </defs>
        <circle cx="${cx}" cy="${cy}" r="${w * .2}" fill="#1d7fb8" opacity=".38" filter="url(#cglow2)"/>
        ${rings}
        <path d="${d}" fill="none" stroke="#9ceaff" stroke-width="4" opacity=".5" filter="url(#wglow)"/>
        <path d="${d}" fill="none" stroke="#eafcff" stroke-width="1.6"/>
        <circle cx="${cx}" cy="${cy}" r="${w * .0075}" fill="#fff"/>
        ${scan}
      </svg>
    </div>`;
}

/* ------------------------------------------------------------------ */

const FILMS = [
    {
        id: 5, art: bladeArt, titleClass: '',
        title: 'Blade of Ashes', zh: '燼刃',
        tagline: 'Every debt is paid in fire',
        billing: 'A FILM BY V. ARDENNE'
    },
    {
        id: 6, art: cloudsArt, titleClass: '',
        title: 'Above the Clouds', zh: '雲之上',
        tagline: 'Some places only children can find',
        billing: 'AN ANIMATED FEATURE BY STUDIO KITE'
    },
    {
        id: 7, art: corridorArt, titleClass: '',
        title: 'Corridor Seven', zh: '第七通道',
        tagline: 'The way out is the way in',
        billing: 'A FILM BY N. HALVORSEN'
    },
    {
        id: 8, art: frequencyArt, titleClass: 'small',
        title: 'Silent Frequency', zh: '無聲頻率',
        tagline: 'Listen to what was never said',
        billing: 'A FILM BY I. MORELLI'
    }
];

function posterHtml(film) {
    const { width: w, height: h } = POSTER;
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${BASE_CSS}</style></head>
<body><div class="stage">
  ${film.art(w, h, film.id * 7 + 3)}
  ${GRAIN}
  <div class="vignette"></div>
  <div class="scrim"></div>
  <div class="type">
    <div class="tagline">${film.tagline}</div>
    <h1 class="${film.titleClass}">${film.title}</h1>
    <div class="zh">${film.zh}</div>
    <div class="rule"></div>
    <div class="billing">${BILLING(film.billing)}</div>
  </div>
</div></body></html>`;
}

/** 橫式主視覺不放文字——首頁輪播會在上面疊自己的標題與按鈕 */
function bannerHtml(film) {
    const { width: w, height: h } = BANNER;
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${BASE_CSS}
  .vignette { background:
      linear-gradient(90deg, rgba(0,0,0,.72) 0%, rgba(0,0,0,.32) 42%, transparent 70%),
      radial-gradient(ellipse at 58% 46%, transparent 34%, rgba(0,0,0,.55) 88%); }
</style></head>
<body><div class="stage">
  ${film.art(w, h, film.id * 7 + 3)}
  ${GRAIN}
  <div class="vignette"></div>
</div></body></html>`;
}

(async () => {
    const browser = await chromium.launch(
        process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}
    );

    for (const film of FILMS) {
        for (const [kind, html, size, file] of [
            ['海報', posterHtml(film), POSTER, `${film.id}.png`],
            ['主視覺', bannerHtml(film), BANNER, `${film.id}-1.png`]
        ]) {
            const page = await browser.newPage({ viewport: size, deviceScaleFactor: 1 });
            await page.setContent(html, { waitUntil: 'load' });
            await page.waitForTimeout(250);
            await page.screenshot({ path: path.join(OUT, file) });
            await page.close();
            console.log(`  ✓ ${film.title} ${kind} → pic/${file} (${size.width}×${size.height})`);
        }
    }

    await browser.close();
})();
