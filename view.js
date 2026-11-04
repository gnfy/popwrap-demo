/* 啵啵纸 · 画面层（Phaser 4）
 * 泡泡纸、爆破特效和声音都在这里；规则、模式、菜单、广告在 index.html。
 * 画布铺满整个窗口、叠在网页上面但不接收点击（pointer-events:none）。泡泡纸画在 #sheet 这个占位元素所在的位置，
 * 点击由 #sheet 收到后用 BW_VIEW.cellAt() 换算成格子。
 * 所有图都是启动时用 Canvas 2D 现画的：幻彩泡泡逐像素上色，再用矢量画粗描边和高光，不需要图片素材。
 */
(function () {
  'use strict';
  const E = window.BW;
  const DPR = Math.min(window.devicePixelRatio || 1, 2.5);
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const F_NUM = '"Baloo 2","Arial Rounded MT Bold","Trebuchet MS",ui-rounded,system-ui,sans-serif';
  const F_UI = '-apple-system,BlinkMacSystemFont,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",system-ui,sans-serif';
  // 配色：深靛蓝夜色底，霓虹粉、青、黄点缀；图形都带一圈深色粗描边
  const PAL = { ink: '#170f3a', inkN: 0x170f3a, pink: '#ff5fb8', pinkN: 0xff5fb8, cyan: '#4ff0ff', cyanN: 0x4ff0ff, yellow: '#ffd84a', yellowN: 0xffd84a, lime: '#8cff5a', violetN: 0xb388ff };

  // ---------- 声音：先用合成音顶着，以后换真实录音 ----------
  const sound = (() => {
    let ac = null, out = null, noise = null, enabled = true, muted = false;
    function init() {
      if (!enabled) return;
      try {
        if (ac) { if (ac.state === 'suspended' && !muted) ac.resume(); return; }
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        ac = new AC();
        // 几十个泡泡一起响也不破音
        const comp = ac.createDynamicsCompressor();
        comp.threshold.value = -16; comp.knee.value = 10; comp.ratio.value = 6; comp.attack.value = 0.002; comp.release.value = 0.12;
        out = ac.createGain(); out.gain.value = 0.85; out.connect(comp); comp.connect(ac.destination);
        const len = Math.floor(ac.sampleRate * 0.3);
        noise = ac.createBuffer(1, len, ac.sampleRate);
        const ch = noise.getChannelData(0);
        for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
      } catch (e) {}
    }
    const ok = () => enabled && !muted && ac && ac.state === 'running';
    const env = (g, t, a, peak, d) => { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); };
    function nz(t, dur, type, freq, Q, peak, a, rate) {
      const s = ac.createBufferSource(); s.buffer = noise; s.playbackRate.value = rate || 1;
      const f = ac.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = Q;
      const g = ac.createGain(); env(g, t, a, peak, dur);
      s.connect(f); f.connect(g); g.connect(out); s.start(t, Math.random() * 0.15); s.stop(t + a + dur + 0.03);
    }
    function osc(t, type, f0, f1, dur, peak, a) {
      a = a || 0.003;
      const o = ac.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, t);
      if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + a + dur);
      const g = ac.createGain(); env(g, t, a, peak, dur);
      o.connect(g); g.connect(out); o.start(t); o.stop(t + a + dur + 0.03);
    }
    const wrap = (fn) => (...args) => { if (ok()) try { fn(...args); } catch (e) {} };
    return {
      init,
      setEnabled(on) { enabled = !!on; if (on) init(); else if (ac) try { ac.suspend(); } catch (e) {} },
      // 放广告时整体静音
      setMuted(on) { muted = !!on; if (!ac) return; try { if (on) ac.suspend(); else if (enabled) ac.resume(); } catch (e) {} },
      // 一颗泡泡：塑料膜裂开的"咔" + 漏气的"嘶" + 一点闷闷的腔体声。size 越大越低沉
      pop: wrap((size = 1, pitch = 1, vol = 1, delay = 0) => {
        const t = ac.currentTime + delay, p = pitch * (0.9 + Math.random() * 0.2);
        nz(t, 0.012, 'highpass', 2800 * p, 0.7, 0.9 * vol, 0.0008, 1);
        nz(t + 0.002, 0.05 + 0.035 * size, 'bandpass', (1500 / size) * p, 1.1, 0.55 * vol, 0.002, 0.9 + Math.random() * 0.2);
        osc(t, 'sine', (300 * p) / size, 70, 0.07 + 0.04 * size, 0.42 * vol);
      }),
      // 连锁每一波一个音，按五声音阶往上走，越长越高
      note: wrap((step, vol = 0.12, delay = 0) => {
        const SC = [0, 2, 4, 7, 9], semi = Math.min(SC[step % 5] + 12 * Math.floor(step / 5), 31);
        const f = 523.25 * Math.pow(2, semi / 12), t = ac.currentTime + delay;
        osc(t, 'triangle', f, 0, 0.2, vol, 0.004); osc(t, 'sine', f * 2, 0, 0.1, vol * 0.3, 0.004);
      }),
      squeak: wrap(() => { const t = ac.currentTime; nz(t, 0.1, 'bandpass', 950, 7, 0.14, 0.025, 0.6); osc(t, 'sine', 640, 980, 0.1, 0.035, 0.03); }),
      ding: wrap((k = 0) => { const t = ac.currentTime, f = 1046.5 * Math.pow(1.26, k); osc(t, 'triangle', f, 0, 0.32, 0.15); osc(t + 0.05, 'sine', f * 1.5, 0, 0.25, 0.07); }),
      boom: wrap((power = 1) => { const t = ac.currentTime; osc(t, 'sine', 120, 36, 0.45 * power, 0.6); nz(t, 0.32 * power, 'lowpass', 520, 0.7, 0.35, 0.004, 0.5); }),
      thud: wrap(() => osc(ac.currentTime, 'sine', 180, 60, 0.14, 0.3)),
      fanfare: wrap(() => [0, 4, 7, 12].forEach((s, i) => osc(ac.currentTime + i * 0.09, 'triangle', 523.25 * Math.pow(2, s / 12), 0, 0.35, 0.13, 0.005))),
    };
  })();

  // ---------- art ----------
  const TEX = 256;
  const canvas = (w, h, draw) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h)); draw(c.getContext('2d', { willReadFrequently: true }), c.width, c.height); return c; };
  const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  const srand = (seed) => { let s = seed >>> 0 || 1; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); };
  // 三档气：越足越大、颜色越饱和；3 档还会发光，一眼看出"快爆了"
  const LVR = { 1: 0.29, 2: 0.33, 3: 0.37 };     // 泡泡半径占贴图的比例
  const LVH = { 1: 0.35, 2: 0.65, 3: 1 };        // 鼓的程度：决定反光扫过时有多亮
  const LVSAT = { 1: 0.8, 2: 0.9, 3: 1 };
  // 幻彩：左下青绿，中间发白，右上淡紫到粉
  const IRI = {
    normal: [[0, [104, 232, 236]], [0.3, [176, 255, 224]], [0.52, [250, 252, 255]], [0.72, [212, 184, 255]], [1, [255, 166, 226]]],
    gold: [[0, [255, 190, 60]], [0.32, [255, 228, 130]], [0.54, [255, 252, 228]], [0.74, [255, 212, 120]], [1, [255, 150, 90]]],
    big: [[0, [60, 214, 160]], [0.32, [150, 255, 196]], [0.54, [238, 255, 246]], [0.74, [150, 236, 255]], [1, [110, 190, 255]]],
  };
  const KIND_PAL = { [E.NORMAL]: 'normal', [E.DOUBLE]: 'normal', [E.GOLD]: 'gold', [E.BIG]: 'big' };
  const GLOW_TINT = { [E.NORMAL]: 0xff7ad9, [E.DOUBLE]: 0xc58bff, [E.GOLD]: 0xffc23a, [E.BIG]: 0x4dffb0 };

  function roundRect(g, x, y, w, h, r) {
    g.beginPath(); g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }
  function starPath(g, x, y, r1, r2, n = 5) {
    g.beginPath();
    for (let k = 0; k < n * 2; k++) { const a = -Math.PI / 2 + (k * Math.PI) / n, r = k % 2 ? r2 : r1; g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); }
    g.closePath();
  }
  function sparkle(g, x, y, r, a) {
    g.fillStyle = `rgba(255,255,255,${a})`; g.beginPath();
    for (let k = 0; k < 8; k++) { const ang = (k * Math.PI) / 4, rr = k % 2 ? r * 0.2 : r; g.lineTo(x + Math.cos(ang) * rr, y + Math.sin(ang) * rr); }
    g.closePath(); g.fill();
  }
  function coin(g, x, y, r) {
    const cg = g.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.1, x, y, r);
    cg.addColorStop(0, '#fff6c4'); cg.addColorStop(0.55, '#ffcf3a'); cg.addColorStop(1, '#e08a10');
    g.fillStyle = cg; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    g.lineWidth = r * 0.16; g.strokeStyle = PAL.ink; g.stroke();
    g.lineWidth = r * 0.08; g.strokeStyle = 'rgba(255,248,200,0.85)'; g.beginPath(); g.arc(x, y, r * 0.7, 0, 7); g.stroke();
    starPath(g, x, y, r * 0.42, r * 0.18); g.fillStyle = 'rgba(200,110,0,0.75)'; g.fill();
  }
  const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const lerpStops = (st, t) => {
    t = Math.min(1, Math.max(0, t));
    for (let k = 1; k < st.length; k++) if (t <= st[k][0]) { const [t0, c0] = st[k - 1], [t1, c1] = st[k], f = (t - t0) / (t1 - t0); return c0.map((v, i) => v + (c1[i] - v) * f); }
    return st[st.length - 1][1];
  };
  // 把一层颜色 (c, a) 盖到像素 i 上
  function over(d, i, c, a) {
    if (a <= 0) return;
    a = Math.min(1, a);
    const ea = d[i + 3] / 255, oa = a + ea * (1 - a);
    for (let k = 0; k < 3; k++) d[i + k] = (c[k] * a + d[i + k] * ea * (1 - a)) / oa;
    d[i + 3] = oa * 255;
  }

  // 卡通幻彩泡泡：先逐像素填幻彩（中间发白、边上一圈偏紫的暗边），再用矢量画粗描边、白色月牙高光和小圆点
  function toonBubble(g, cx, cy, R, o = {}) {
    const stops = IRI[o.pal || 'normal'], sat = o.sat ?? 1, wob = o.wob || 0, ph = o.ph || 0, alpha = o.alpha ?? 0.97;
    const rad = (a) => 1 + wob * Math.sin(a * 5 + ph) + wob * 0.6 * Math.sin(a * 3 - ph * 2);
    const S = Math.ceil(R * 1.2), x0 = Math.max(0, Math.floor(cx - S)), y0 = Math.max(0, Math.floor(cy - S));
    const W = Math.min(g.canvas.width - x0, 2 * S), Hh = Math.min(g.canvas.height - y0, 2 * S);
    const img = g.getImageData(x0, y0, W, Hh), d = img.data;
    for (let py = 0; py < Hh; py++) for (let px = 0; px < W; px++) {
      const u = (x0 + px + 0.5 - cx) / R, v = (y0 + py + 0.5 - cy) / R, dd = Math.hypot(u, v) / rad(Math.atan2(v, u));
      if (dd > 1.02) continue;
      let c = lerpStops(stops, 0.5 + 0.36 * (u - v));
      const gray = (c[0] + c[1] + c[2]) / 3;
      c = c.map((x) => gray + (x - gray) * sat);
      const w = Math.pow(Math.max(0, 1 - dd), 1.3) * (0.5 + 0.2 * (1 - sat));
      c = c.map((x) => x + (255 - x) * w);
      const rim = smooth(0.7, 0.98, dd) * 0.3;
      c = c.map((x, k) => (x + ([118, 92, 214][k] - x) * rim) * (o.dim ?? 1));
      over(d, (py * W + px) * 4, c, (1 - smooth(0.975, 1, dd)) * alpha);
    }
    g.putImageData(img, x0, y0);
    if (o.inside) o.inside(g);
    g.beginPath();
    for (let k = 0; k <= 72; k++) { const a = (k / 72) * Math.PI * 2, r = R * rad(a); k ? g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r) : g.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); }
    g.closePath();
    g.lineJoin = 'round'; g.lineWidth = R * (o.line ?? 0.09); g.strokeStyle = PAL.ink; g.stroke();
    g.lineCap = 'round';
    // 描边内侧左上一道亮线、右下一道反光
    g.lineWidth = R * 0.045; g.strokeStyle = 'rgba(255,255,255,0.55)';
    g.beginPath(); g.arc(cx, cy, R * 0.86, Math.PI * 0.95, Math.PI * 1.55); g.stroke();
    g.lineWidth = R * 0.06; g.strokeStyle = 'rgba(225,255,255,0.6)';
    g.beginPath(); g.arc(cx, cy, R * 0.72, Math.PI * 0.08, Math.PI * 0.36); g.stroke();
    // 月牙高光 + 小圆点
    const hl = 0.55 + 0.45 * sat;
    g.lineWidth = R * 0.17; g.strokeStyle = `rgba(255,255,255,${0.95 * hl})`;
    g.beginPath(); g.arc(cx, cy, R * 0.64, Math.PI * 1.06, Math.PI * 1.42); g.stroke();
    g.fillStyle = `rgba(255,255,255,${0.95 * hl})`;
    g.beginPath(); g.arc(cx + Math.cos(Math.PI * 1.56) * R * 0.64, cy + Math.sin(Math.PI * 1.56) * R * 0.64, R * 0.075, 0, 7); g.fill();
    // 气不足：边上起几道褶
    if (o.creases) {
      const r = srand(o.seed || 5);
      for (let j = 0; j < 3; j++) {
        const a = (j / 3) * Math.PI * 2 + 0.3 + r() * 0.9, len = R * (0.2 + r() * 0.1), x1 = cx + Math.cos(a) * R * 0.97, y1 = cy + Math.sin(a) * R * 0.97;
        const x2 = x1 - Math.cos(a) * len, y2 = y1 - Math.sin(a) * len, bx = (x1 + x2) / 2 - Math.sin(a) * R * 0.08, by = (y1 + y2) / 2 + Math.cos(a) * R * 0.08;
        g.lineWidth = R * 0.045; g.strokeStyle = 'rgba(23,15,58,0.35)'; g.beginPath(); g.moveTo(x1, y1); g.quadraticCurveTo(bx, by, x2, y2); g.stroke();
      }
    }
  }
  function bubbleArt(g, k, lv) {
    const C = TEX / 2, R = TEX * LVR[lv], pal = KIND_PAL[k], sat = LVSAT[lv], seed = 3 + k * 5 + lv;
    const o = { pal, sat, wob: lv === 1 ? 0.03 : 0, ph: k + lv, creases: lv === 1, seed, dim: lv === 1 ? 0.96 : 1, alpha: lv === 1 ? 0.94 : 0.97 };
    if (k === E.DOUBLE) {
      toonBubble(g, C, C, R * 1.14, { pal, sat: sat * 0.6, alpha: 0.42, line: 0.05 });
      toonBubble(g, C, C, R * 0.84, o);
      return;
    }
    if (k === E.GOLD) o.inside = (cg) => coin(cg, C + R * 0.02, C + R * 0.08, R * 0.46);
    toonBubble(g, C, C, R, o);
    if (k === E.GOLD) sparkle(g, C + R * 0.5, C - R * 0.5, R * 0.22, 0.95);
    // 大气泡一圈 8 个点：爆开时 8 个方向都会鼓
    if (k === E.BIG) for (let j = 0; j < 8; j++) {
      const a = (j * Math.PI) / 4, x = C + Math.cos(a) * R * 1.2, y = C + Math.sin(a) * R * 1.2;
      g.fillStyle = '#5dffb6'; g.beginPath(); g.arc(x, y, R * 0.075, 0, 7); g.fill();
      g.lineWidth = R * 0.04; g.strokeStyle = PAL.ink; g.stroke();
    }
  }
  // 反光扫过、鼠标悬停时叠上去的那层：只有月牙和小圆点
  function glintArt(g) {
    const C = TEX / 2, R = TEX * LVR[3];
    g.lineCap = 'round'; g.lineWidth = R * 0.2; g.strokeStyle = 'rgba(255,255,255,0.9)';
    g.beginPath(); g.arc(C, C, R * 0.64, Math.PI * 1.04, Math.PI * 1.44); g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.9)';
    g.beginPath(); g.arc(C + Math.cos(Math.PI * 1.56) * R * 0.64, C + Math.sin(Math.PI * 1.56) * R * 0.64, R * 0.1, 0, 7); g.fill();
  }
  // 捏破以后：瘪下去的一小片，颜色灰暗、细描边、几道褶和一个小破口
  function crumpleArt(g, seed, kind) {
    const r = srand(seed), C = TEX / 2, R = TEX * 0.28, ph = [r() * 6.28, r() * 6.28, r() * 6.28];
    const rad = (a) => R * (1 + 0.08 * Math.sin(3 * a + ph[0]) + 0.05 * Math.sin(5 * a + ph[1]) + 0.04 * Math.sin(8 * a + ph[2]));
    g.beginPath();
    for (let k = 0; k <= 72; k++) { const a = (k / 72) * Math.PI * 2; k ? g.lineTo(C + Math.cos(a) * rad(a), C + Math.sin(a) * rad(a)) : g.moveTo(C + rad(0), C); }
    g.closePath();
    g.fillStyle = kind === 'lost' ? 'rgba(255,96,140,0.32)' : kind === 'got' ? 'rgba(255,206,90,0.3)' : 'rgba(150,136,235,0.26)'; g.fill();
    g.lineJoin = 'round'; g.lineWidth = TEX * 0.018; g.strokeStyle = 'rgba(23,15,58,0.6)'; g.stroke();
    g.lineCap = 'round';
    for (let j = 0; j < 4; j++) {
      const a = r() * Math.PI * 2, b = a + Math.PI * (0.55 + r() * 0.7);
      const x1 = C + Math.cos(a) * R * 0.85, y1 = C + Math.sin(a) * R * 0.85, x2 = C + Math.cos(b) * R * 0.6, y2 = C + Math.sin(b) * R * 0.6;
      const mx = (x1 + x2) / 2 + (r() - 0.5) * R * 0.4, my = (y1 + y2) / 2 + (r() - 0.5) * R * 0.4;
      g.lineWidth = TEX * 0.012; g.strokeStyle = 'rgba(23,15,58,0.45)'; g.beginPath(); g.moveTo(x1, y1); g.quadraticCurveTo(mx, my, x2, y2); g.stroke();
      g.lineWidth = TEX * 0.007; g.strokeStyle = 'rgba(255,255,255,0.35)'; g.beginPath(); g.moveTo(x1 - 2, y1 - 2); g.quadraticCurveTo(mx - 2, my - 2, x2 - 2, y2 - 2); g.stroke();
    }
    const ta = r() * Math.PI, tl = R * 0.32, ux = Math.cos(ta), uy = Math.sin(ta);
    g.beginPath();
    for (let k = 0; k <= 5; k++) { const t = -tl + (2 * tl * k) / 5, j = (k % 2 ? 1 : -1) * R * 0.07; const x = C + ux * t - uy * j, y = C + uy * t + ux * j; k ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.lineWidth = TEX * 0.016; g.strokeStyle = 'rgba(23,15,58,0.7)'; g.stroke();
    if (kind === 'got') coin(g, C + R * 0.1, C - R * 0.05, R * 0.4);
  }
  // 胶带格：黄黑警示胶带，表示这格不透气
  function tapeArt(g) {
    const C = TEX / 2, L = TEX * 0.47, h = TEX * 0.12;
    g.translate(C, C); g.rotate(-0.3);
    roundRect(g, -L, -h, 2 * L, 2 * h, h * 0.4); g.fillStyle = PAL.yellow; g.fill();
    g.save(); g.clip();
    g.fillStyle = PAL.ink;
    for (let x = -L - 3 * h; x < L + 3 * h; x += h * 1.7) { g.beginPath(); g.moveTo(x, -h); g.lineTo(x + h * 0.85, -h); g.lineTo(x - h * 0.55, h); g.lineTo(x - h * 1.4, h); g.closePath(); g.fill(); }
    g.fillStyle = 'rgba(255,255,255,0.3)'; g.fillRect(-L, -h, 2 * L, h * 0.55);
    g.restore();
    roundRect(g, -L, -h, 2 * L, 2 * h, h * 0.4); g.lineWidth = TEX * 0.022; g.strokeStyle = PAL.ink; g.stroke();
  }
  // 提示用的虚线圈、打气时可以选的点线圈
  function ringArt(g, dash, color, width) {
    const C = TEX / 2;
    g.setLineDash(dash); g.lineCap = 'round';
    g.lineWidth = width + 8; g.strokeStyle = PAL.ink; g.beginPath(); g.arc(C, C, TEX * 0.43, 0, 7); g.stroke();
    g.lineWidth = width; g.strokeStyle = color; g.stroke();
  }
  // 网页背景上淡淡的电路纹（横平竖直的线、端点小圆圈），做成 CSS 的背景图
  function circuitArt(g, w, h) {
    const r = srand(77), step = 32, at = (fn) => { for (const dx of [0, -w, w]) for (const dy of [0, -h, h]) fn(dx, dy); };
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (let k = 0; k < 24; k++) {
      let x = Math.round((r() * w) / step) * step, y = Math.round((r() * h) / step) * step;
      const pts = [[x, y]];
      for (let s = 0, n = 2 + ((r() * 3) | 0); s < n; s++) {
        const len = step * (1 + ((r() * 3) | 0)) * (r() < 0.5 ? -1 : 1);
        if (s % 2) x += len; else y += len;
        pts.push([x, y]);
      }
      const a = 0.06 + r() * 0.08;
      at((dx, dy) => {
        g.strokeStyle = `rgba(150,170,255,${a})`; g.lineWidth = 2;
        g.beginPath(); pts.forEach(([px, py], i) => (i ? g.lineTo(px + dx, py + dy) : g.moveTo(px + dx, py + dy))); g.stroke();
        const [ex, ey] = pts[pts.length - 1];
        g.beginPath(); g.arc(ex + dx, ey + dy, 5, 0, 7); g.stroke();
        g.fillStyle = `rgba(150,170,255,${a * 1.4})`; g.beginPath(); g.arc(pts[0][0] + dx, pts[0][1] + dy, 3, 0, 7); g.fill();
      });
    }
  }
  // 泡泡纸的托盘：深色面板，粗黑描边，里面一圈青色霓虹线，外面一圈青色光
  function trayArt(bw, bh, P, s, d, cell, pad) {
    return canvas(bw + 2 * P, bh + 2 * P, (g) => {
      const x = P, y = P, rad = Math.min(26 * s, cell * 0.38), rr = (i = 0) => roundRect(g, x + i, y + i, bw - 2 * i, bh - 2 * i, Math.max(4, rad - i));
      g.save(); g.shadowColor = 'rgba(79,240,255,0.55)'; g.shadowBlur = 24 * s; rr(); g.fillStyle = '#1a1450'; g.fill(); g.restore();
      const fg = g.createLinearGradient(x, y, x, y + bh); fg.addColorStop(0, '#2a1f74'); fg.addColorStop(1, '#170f48');
      rr(); g.fillStyle = fg; g.fill();
      g.save(); rr(); g.clip();
      const lg = g.createLinearGradient(x, y, x + bw, y + bh);
      lg.addColorStop(0.18, 'rgba(255,255,255,0)'); lg.addColorStop(0.3, 'rgba(255,255,255,0.07)'); lg.addColorStop(0.42, 'rgba(255,255,255,0)');
      g.fillStyle = lg; g.fillRect(x, y, bw, bh);
      // 每个泡泡底下一个凹下去的座
      for (let r = 0; r < d.rows; r++) for (let c = 0; c < d.cols; c++) {
        const cx = x + pad + (c + 0.5) * cell, cy = y + pad + (r + 0.5) * cell, R = cell * 0.42;
        g.fillStyle = 'rgba(6,4,24,0.42)'; g.beginPath(); g.arc(cx, cy, R, 0, 7); g.fill();
        g.lineWidth = Math.max(1, cell * 0.025); g.strokeStyle = 'rgba(170,150,255,0.25)'; g.stroke();
      }
      g.restore();
      g.lineWidth = 4 * s; g.strokeStyle = PAL.ink; rr(); g.stroke();
      g.lineWidth = 2 * s; g.strokeStyle = 'rgba(79,240,255,0.8)'; rr(5 * s); g.stroke();
    });
  }
  const radial = (size, stops) => canvas(size, size, (g) => { const h = size / 2, r = g.createRadialGradient(h, h, 0, h, h, h); stops.forEach(([t, c]) => r.addColorStop(t, c)); g.fillStyle = r; g.fillRect(0, 0, size, size); });

  function makeTextures(scene) {
    const tx = scene.textures, add = (key, c) => tx.addCanvas(key, c);
    for (const k of [E.NORMAL, E.GOLD, E.DOUBLE, E.BIG]) for (const lv of [1, 2, 3]) add(`b${k}_${lv}`, canvas(TEX, TEX, (g) => bubbleArt(g, k, lv)));
    add('glint', canvas(TEX, TEX, glintArt));
    for (let v = 0; v < 4; v++) add('cr' + v, canvas(TEX, TEX, (g) => crumpleArt(g, 11 + v * 7, '')));
    add('crGot', canvas(TEX, TEX, (g) => crumpleArt(g, 5, 'got')));
    add('crLost', canvas(TEX, TEX, (g) => crumpleArt(g, 9, 'lost')));
    add('tape', canvas(TEX, TEX, tapeArt));
    add('hintring', canvas(TEX, TEX, (g) => ringArt(g, [22, 16], PAL.cyan, 12)));
    add('pumpring', canvas(TEX, TEX, (g) => ringArt(g, [2, 20], PAL.yellow, 12)));
    add('coin', canvas(64, 64, (g) => coin(g, 32, 32, 26)));
    // 白色的光，用的时候按泡泡种类染色、加色混合
    add('glow', radial(256, [[0, 'rgba(255,255,255,0.85)'], [0.42, 'rgba(255,255,255,0.45)'], [1, 'rgba(255,255,255,0)']]));
    add('petals', canvas(256, 256, (g) => {
      g.translate(128, 128);
      for (let k = 0; k < 8; k++) {
        g.save(); g.rotate((k * Math.PI) / 4);
        const pg = g.createRadialGradient(0, -74, 4, 0, -74, 46); pg.addColorStop(0, 'rgba(255,255,255,0.95)'); pg.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = pg; g.beginPath(); g.ellipse(0, -74, 28, 46, 0, 0, 7); g.fill(); g.restore();
      }
      const cg = g.createRadialGradient(0, 0, 0, 0, 0, 70); cg.addColorStop(0, 'rgba(255,255,255,0.9)'); cg.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = cg; g.beginPath(); g.arc(0, 0, 70, 0, 7); g.fill();
    }));
    add('puff', radial(64, [[0, 'rgba(255,255,255,0.95)'], [0.5, 'rgba(255,255,255,0.4)'], [1, 'rgba(255,255,255,0)']]));
    add('shard', canvas(48, 48, (g) => {
      g.translate(24, 24); g.beginPath(); g.moveTo(-17, -2); g.quadraticCurveTo(0, -15, 17, -4); g.quadraticCurveTo(2, -6, -17, 3); g.closePath();
      g.fillStyle = '#ffffff'; g.fill(); g.lineWidth = 2.5; g.strokeStyle = PAL.ink; g.stroke();
    }));
    add('ring', canvas(256, 256, (g) => { g.lineWidth = 22; g.strokeStyle = 'rgba(255,255,255,0.25)'; g.beginPath(); g.arc(128, 128, 104, 0, 7); g.stroke(); g.lineWidth = 8; g.strokeStyle = 'rgba(255,255,255,0.95)'; g.stroke(); }));
    add('flash', radial(128, [[0, 'rgba(255,255,255,1)'], [0.3, 'rgba(255,255,255,0.6)'], [1, 'rgba(255,255,255,0)']]));
    add('spark', canvas(64, 64, (g) => { const r = g.createRadialGradient(32, 32, 0, 32, 32, 20); r.addColorStop(0, 'rgba(255,255,255,0.8)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, 64, 64); sparkle(g, 32, 32, 30, 1); }));
  }

  // ---------- 场景 ----------
  const sheetEl = () => document.getElementById('sheet');
  let resolveReady;
  const ready = new Promise((r) => { resolveReady = r; });

  class Board extends Phaser.Scene {
    constructor() { super('board'); }
    create() {
      makeTextures(this);
      this.s = DPR; this.cells = []; this.d = null; this.epoch = 0; this.hoverIdx = -1; this.cnt = null; this.popups = 0; this.rect = null;
      this.tray = null; this.trayKey = '';
      this.origin = -1; this.emitCell = 0;
      resolveReady();
    }
    makeEmitters(cs) {
      [this.emPuff, this.emShard, this.emSpark, this.emConfetti].forEach((e) => e && e.destroy());
      this.emitCell = cs;
      this.emPuff = this.add.particles(0, 0, 'puff', { emitting: false, lifespan: 420, speed: { min: 30 * DPR, max: 120 * DPR }, scale: { start: (cs * 0.25) / 64, end: (cs * 0.9) / 64 }, alpha: { start: 0.5, end: 0 } }).setDepth(46);
      this.emShard = this.add.particles(0, 0, 'shard', { emitting: false, lifespan: { min: 380, max: 650 }, speed: { min: 140 * DPR, max: 340 * DPR }, gravityY: 1000 * DPR, scale: { start: (cs * 0.5) / 48, end: (cs * 0.32) / 48 }, alpha: { start: 1, end: 0 }, rotate: { start: 0, end: 540 }, tint: [0x9ff5ee, 0xffc2ef, 0xd9c2ff, 0xffffff] }).setDepth(47);
      this.emSpark = this.add.particles(0, 0, 'spark', { emitting: false, lifespan: 600, speed: { min: 60 * DPR, max: 240 * DPR }, scale: { start: (cs * 0.55) / 64, end: 0 }, alpha: { start: 1, end: 0 }, tint: [0xffd84a, 0x4ff0ff, 0xff7ad9], blendMode: 'ADD' }).setDepth(48);
      this.emConfetti = this.add.particles(0, 0, 'shard', { emitting: false, lifespan: { min: 900, max: 1500 }, speed: { min: 300 * DPR, max: 900 * DPR }, angle: { min: 200, max: 340 }, gravityY: 1400 * DPR, scale: { start: (cs * 0.7) / 48, end: (cs * 0.5) / 48 }, alpha: { start: 1, end: 0 }, rotate: { start: 0, end: 900 }, tint: [0xff5fb8, 0x4ff0ff, 0xffd84a, 0x8cff5a, 0xb388ff] }).setDepth(49);
    }

    // 泡泡纸的位置和大小跟着 #sheet 走（它在网页里按原来的规则排版）
    layout() {
      const el = sheetEl();
      if (!el || !this.d) return;
      const b = el.getBoundingClientRect(), d = this.d, PADC = 0.42;
      const cell = Math.min((b.width * DPR) / (d.cols + PADC), (b.height * DPR) / (d.rows + PADC));
      const bw = cell * (d.cols + PADC), bh = cell * (d.rows + PADC);
      const bx = b.left * DPR + (b.width * DPR - bw) / 2, by = b.top * DPR + (b.height * DPR - bh) / 2;
      const key = [d.key, Math.round(bw), Math.round(bh)].join('|');
      this.rect = { bx, by, bw, bh, cell, pad: (cell * PADC) / 2 };
      this.base = (cell * 1.27) / TEX;
      const P = Math.round(36 * DPR);
      if (key !== this.trayKey) {
        this.trayKey = key;
        if (this.tray) this.tray.destroy();
        if (this.textures.exists('tray')) this.textures.remove('tray');
        this.textures.addCanvas('tray', trayArt(bw, bh, P, DPR, d, cell, this.rect.pad));
        this.tray = this.add.image(0, 0, 'tray').setOrigin(0).setDepth(10);
      }
      if (Math.abs(cell - this.emitCell) > 0.5) this.makeEmitters(cell);
      this.tray.setPosition(bx - P, by - P);
      this.cells.forEach((c, i) => {
        const p = this.pos(i);
        c.x = p.x; c.y = p.y;
        for (const o of [c.cr, c.glow, c.b, c.gl, c.tp, c.hint, c.pump, c.num]) if (o) o.setPosition(p.x, p.y);
        c.cr.setScale(this.base); if (c.tp) c.tp.setScale(this.base);
        c.hint.setScale(this.base * 0.98); c.pump.setScale(this.base * 0.98);
        c.num.setFontSize(Math.round(cell * 0.32) + 'px').setStroke(PAL.ink, Math.round(cell * 0.08));
      });
    }
    pos(i) { const r = this.rect, c = i % this.d.cols, row = (i / this.d.cols) | 0; return { x: r.bx + r.pad + (c + 0.5) * r.cell, y: r.by + r.pad + (row + 0.5) * r.cell }; }

    build(d) {
      this.epoch++;
      this.cells.forEach((c) => [c.cr, c.glow, c.b, c.gl, c.tp, c.hint, c.pump, c.num].forEach((o) => o && o.destroy()));
      this.cells = []; this.d = d; this.trayKey = '';
      for (let i = 0; i < d.n; i++) {
        this.cells.push({
          x: 0, y: 0, v: (i * 7) % 4, phase: (i * 2.39) % 6.28, hk: 0, pk: 0, sw: 0, sig: -1, lv: 0, kind: 0,
          cr: this.add.image(0, 0, 'cr0').setAngle((i * 137) % 360).setDepth(20).setVisible(false),
          glow: this.add.image(0, 0, 'glow').setDepth(29).setBlendMode(Phaser.BlendModes.ADD).setVisible(false),
          b: this.add.image(0, 0, 'b0_3').setDepth(30).setVisible(false),
          gl: this.add.image(0, 0, 'glint').setDepth(31).setBlendMode(Phaser.BlendModes.ADD).setVisible(false),
          tp: null,
          hint: this.add.image(0, 0, 'hintring').setDepth(41).setVisible(false),
          pump: this.add.image(0, 0, 'pumpring').setDepth(41).setVisible(false),
          num: this.add.text(0, 0, '', { fontFamily: F_NUM, fontStyle: 'bold', color: '#ffffff' }).setOrigin(0.5).setDepth(42).setVisible(false),
        });
      }
      this.layout();
    }

    // 把格子 i 画成 (k, lv, m) 这个样子
    setCell(i, k, lv, m) {
      const c = this.cells[i];
      c.lv = lv; c.kind = k;
      c.glow.setVisible(lv === 3 && k !== E.TAPE).setTint(GLOW_TINT[k] || PAL.pinkN);
      if (k === E.TAPE) {
        if (!c.tp) c.tp = this.add.image(c.x, c.y, 'tape').setScale(this.base).setAngle(((i * 53) % 24) - 12).setDepth(40);
        c.tp.setVisible(true);
        c.b.setVisible(false); c.gl.setVisible(false); c.cr.setVisible(true).setTexture('cr' + c.v).setAlpha(0.8);
        return;
      }
      if (c.tp) c.tp.setVisible(false);
      if (lv > 0) { c.b.setVisible(true).setTexture(`b${k}_${lv}`); c.gl.setVisible(true); c.cr.setVisible(false); }
      else { c.b.setVisible(false); c.gl.setVisible(false); c.cr.setVisible(true).setAlpha(1).setTexture(m === 1 ? 'crGot' : m === 2 ? 'crLost' : 'cr' + c.v).setScale(this.base); }
    }

    // st: { d, lv, kind, mark }；popped：这一波爆掉的格子（在连锁里）；o: { hint, pumping, nums, cleared, wave, coinTo }
    paint(st, popped, o = {}) {
      if (!this.d || this.d.key !== st.d.key) this.build(st.d);
      const d = st.d, pset = popped ? new Set(popped) : null, epoch = this.epoch;
      const oc = this.origin >= 0 ? this.origin % d.cols : 0, orow = this.origin >= 0 ? (this.origin / d.cols) | 0 : 0;
      for (let i = 0; i < d.n; i++) {
        const c = this.cells[i], k = st.kind[i], m = st.mark[i];
        const lv = o.cleared ? 0 : Math.min(3, st.lv[i]), sig = k * 100 + m * 10 + lv;
        if (pset && pset.has(i)) {
          const jit = o.wave ? Math.min(40, Math.hypot((i % d.cols) - oc, ((i / d.cols) | 0) - orow) * 5 + Math.random() * 16) : 0;
          c.sig = sig;
          this.time.delayedCall(jit, () => { if (this.epoch === epoch) this.popFx(i, k, lv, m, o); });
        } else if (c.sig !== sig) {
          const grew = popped && lv > c.lv && c.lv > 0;
          c.sig = sig;
          if (grew) this.time.delayedCall(30 + Math.random() * 30, () => { if (this.epoch === epoch) { this.setCell(i, k, lv, m); c.sw = 0.2; this.tweenProp(c, 'sw', 0, 320, 'Back.easeOut'); } });
          else this.setCell(i, k, lv, m);
        }
        const alive = lv > 0 && k !== E.TAPE;
        c.hint.setVisible(o.hint === i);
        c.pump.setVisible(!!o.pumping && alive && lv < 3);
        c.num.setVisible(!!o.nums && alive).setText(alive ? String(lv) : '');
      }
    }

    popFx(i, k, lv, m, o) {
      const c = this.cells[i], cs = this.rect.cell, { x, y } = c, alive = lv > 0, big = k === E.BIG && !alive;
      this.setCell(i, k, lv, m);
      if (alive) { c.sw = -0.3; this.tweenProp(c, 'sw', 0, 320, 'Back.easeOut'); }   // 双层泡泡只掉了外层
      else {
        c.hk = 0; c.pk = 0;
        c.cr.setAlpha(0).setScale(this.base * 1.3);
        this.tweens.add({ targets: c.cr, alpha: 1, scale: this.base, duration: 190, ease: 'Back.easeOut' });
      }
      const fl = this.add.image(x, y, 'flash').setDepth(45).setBlendMode(Phaser.BlendModes.ADD).setScale((cs * 0.5) / 128).setAlpha(0.85);
      this.tweens.add({ targets: fl, scale: (cs * 1.4) / 128, alpha: 0, duration: 150, ease: 'Quad.easeOut', onComplete: () => fl.destroy() });
      const hue = [PAL.pinkN, PAL.cyanN, PAL.violetN][i % 3];
      const ring = this.add.image(x, y, 'ring').setDepth(44).setScale((cs * 0.75) / 256).setAlpha(0.9).setTint(hue);
      this.tweens.add({ targets: ring, scale: (cs * (big ? 3.2 : 1.7)) / 256, alpha: 0, duration: big ? 420 : 280, ease: 'Cubic.easeOut', onComplete: () => ring.destroy() });
      if (!reduceMotion) {
        const pet = this.add.image(x, y, 'petals').setDepth(43).setScale((cs * 0.5) / 256).setAlpha(0.8).setTint(hue).setBlendMode(Phaser.BlendModes.ADD).setAngle(Math.random() * 45);
        this.tweens.add({ targets: pet, scale: (cs * 1.5) / 256, alpha: 0, angle: pet.angle + 25, duration: 380, ease: 'Cubic.easeOut', onComplete: () => pet.destroy() });
        const many = (this.chainN || 0) > 30;
        this.emPuff.explode(many ? 3 : 5, x, y);
        this.emShard.explode(alive ? 3 : many ? 2 : 4, x, y);
      }
      if (m === 1 && k === E.GOLD) { this.emSpark.explode(10, x, y); this.flyCoin(x, y, o.coinTo); }
      if (big && !reduceMotion) this.cameras.main.shake(160, 0.006);
    }

    flyCoin(x, y, el) {
      if (!el) return;
      const b = el.getBoundingClientRect(), tx = (b.left + b.width / 2) * DPR, ty = (b.top + b.height / 2) * DPR;
      const c = this.add.image(x, y, 'coin').setScale((this.rect.cell * 0.4) / 64).setDepth(66);
      this.tweens.add({ targets: c, x: tx, y: ty, scale: (b.width * DPR) / 64, duration: 560, ease: 'Cubic.easeIn', onComplete: () => { c.destroy(); el.animate && el.animate([{ transform: 'scale(1.5)' }, { transform: 'scale(1)' }], { duration: 260, easing: 'ease-out' }); } });
    }

    counter(n) {
      if (n < 2) return;
      const s = DPR, r = this.rect;
      if (!this.cnt) {
        this.cnt = this.add.text(0, 0, '', { fontFamily: F_NUM, fontSize: Math.round(46 * s) + 'px', fontStyle: 'bold', color: '#ffffff', stroke: PAL.ink, strokeThickness: Math.round(10 * s) }).setOrigin(0.5).setDepth(60).setVisible(false);
        this.cnt.setShadow(0, 5 * s, '#ff3d9a', 0, true, false);
      }
      const t = this.cnt;
      t.setText('\u00d7' + n);
      if (!t.visible || t._fading) {
        if (t._tf) t._tf.stop();
        t._fading = false;
        // 出现在起爆的那颗泡泡上方，留够位置不出泡泡纸
        const p = this.origin >= 0 ? this.pos(this.origin) : { x: r.bx + r.bw / 2, y: r.by + r.bh / 2 }, half = t.width * 0.9;
        t.setPosition(Phaser.Math.Clamp(p.x, r.bx + half, r.bx + r.bw - half), Math.max(r.by + 34 * s, p.y - r.cell * 0.95)).setAlpha(1).setVisible(true);
      }
      this.chainN = n;
      t.setColor(n < 5 ? '#ffffff' : n < 10 ? PAL.cyan : n < 20 ? PAL.yellow : PAL.pink);
      const base = 1 + Math.min(n, 40) * 0.018;
      if (t._tp) t._tp.stop();
      t.setScale(base * 1.45);
      t._tp = this.tweens.add({ targets: t, scale: base, duration: 170, ease: 'Back.easeOut' });
    }
    counterEnd() {
      this.chainN = 0;
      const t = this.cnt;
      if (!t || !t.visible || t._fading) return;
      t._fading = true;
      t._tf = this.tweens.add({ targets: t, y: t.y - 40 * DPR, alpha: 0, duration: 420, ease: 'Quad.easeIn', onComplete: () => t.setVisible(false) });
    }

    // 浮在泡泡纸上的字：kind '' 普通、'big' 横幅、'huge' 大横幅+闪光+彩纸、'bonus' / 'gold' / 'warn' 小提示
    popup(text, kind, small) {
      const s = DPR, r = this.rect;
      if (!r) return;
      const mx = r.bx + r.bw / 2, my = r.by + r.bh * 0.42;
      if (kind === 'huge' || kind === 'big') {
        const huge = kind === 'huge', c = this.add.container(mx, my).setDepth(65);
        const main = this.add.text(0, 0, text, { fontFamily: F_UI, fontSize: Math.round((huge ? 52 : 40) * s) + 'px', fontStyle: 'bold', color: huge ? PAL.yellow : '#ffffff', stroke: PAL.ink, strokeThickness: Math.round((huge ? 12 : 10) * s) }).setOrigin(0.5);
        main.setShadow(0, 7 * s, '#ff3d9a', 0, true, false);
        const fit = Math.min(1, (r.bw * 0.94) / main.width);
        c.add(main);
        if (small) c.add(this.add.text(0, (huge ? 50 : 40) * s, small, { fontFamily: F_NUM, fontSize: Math.round((huge ? 32 : 26) * s) + 'px', fontStyle: 'bold', color: PAL.cyan, stroke: PAL.ink, strokeThickness: Math.round(8 * s) }).setOrigin(0.5));
        c.setScale(0.3 * fit).setAlpha(0);
        this.tweens.add({ targets: c, scale: fit, alpha: 1, duration: 300, ease: 'Back.easeOut' });
        this.tweens.add({ targets: c, y: my - 46 * s, alpha: 0, delay: huge ? 1100 : 850, duration: 420, ease: 'Quad.easeIn', onComplete: () => c.destroy() });
        this.emConfetti.explode(huge ? 46 : 18, mx, r.by + r.bh * 0.8);
        if (huge) {
          const fl = this.add.rectangle(0, 0, this.scale.width, this.scale.height, 0xffe6fa, 0.5).setOrigin(0).setDepth(90).setBlendMode(Phaser.BlendModes.ADD);
          this.tweens.add({ targets: fl, alpha: 0, duration: 280, ease: 'Quad.easeOut', onComplete: () => fl.destroy() });
          if (!reduceMotion) { const cam = this.cameras.main; cam.zoomTo(1.035, 90, 'Quad.easeOut'); this.time.delayedCall(110, () => cam.zoomTo(1, 340, 'Quad.easeOut')); }
        }
        return;
      }
      const pill = kind === 'bonus' || kind === 'gold' || kind === 'warn';
      const color = kind === 'gold' ? PAL.yellow : kind === 'warn' ? '#ff8fb8' : kind === 'bonus' ? PAL.lime : '#ffffff';
      const size = pill ? 17 : 30, k = this.popups++;
      const t = this.add.text(mx, my + (pill ? 60 + (k % 3) * 34 : 0) * s, small ? `${text}  ${small}` : text, { fontFamily: F_UI, fontSize: Math.round(size * s) + 'px', fontStyle: 'bold', color, stroke: PAL.ink, strokeThickness: Math.round((pill ? 5 : 8) * s), align: 'center', wordWrap: { width: r.bw * 0.95 } }).setOrigin(0.5).setDepth(62);
      t.setScale(0.7);
      this.tweens.add({ targets: t, scale: 1, duration: 160, ease: 'Back.easeOut' });
      this.tweens.add({ targets: t, y: t.y - 46 * s, alpha: 0, delay: pill ? 700 : 500, duration: 600, ease: 'Cubic.easeIn', onComplete: () => { t.destroy(); this.popups = Math.max(0, this.popups - 1); } });
    }

    shake(big) { if (!reduceMotion) this.cameras.main.shake(big ? 420 : 240, big ? 0.011 : 0.006); }

    // 开局时泡泡从小鼓起来，从左上到右下错开
    fresh() {
      const d = this.d;
      this.cells.forEach((c, i) => {
        const delay = ((i % d.cols) + ((i / d.cols) | 0)) * 25;
        c.sw = -1;
        this.tweens.add({ targets: c, sw: 0, delay, duration: 440, ease: 'Back.easeOut' });
        if (c.tp && c.tp.visible) { c.tp.setAlpha(0); this.tweens.add({ targets: c.tp, alpha: 1, delay: delay + 200, duration: 220 }); }
      });
    }

    // 过关时剩下的泡泡一颗接一颗自动爆掉，只为了爽
    finale(list, done) {
      const r = this.rect, cx = r.bx + r.bw / 2, cy = r.by + r.bh / 2, dist = (i) => { const p = this.pos(i); return Math.hypot(p.x - cx, p.y - cy); };
      list = list.slice().sort((a, b) => dist(a) - dist(b));
      const epoch = this.epoch;
      let t = 0;
      list.forEach((i, j) => {
        this.time.delayedCall(t, () => {
          if (this.epoch !== epoch) return;
          const c = this.cells[i];
          c.sig = -1;
          this.popFx(i, c.kind === E.GOLD ? E.NORMAL : c.kind, 0, 0, {});
          sound.pop(1, Math.pow(2, Math.min(j, 14) / 24), 0.7); sound.note(j, 0.07);
        });
        t += Math.max(30, 95 - j * 7);
      });
      this.time.delayedCall(t + 450, () => { if (this.epoch === epoch) done(); });
    }

    tweenProp(obj, key, to, dur, ease = 'Quad.easeOut') {
      const tk = '_t' + key;
      if (obj[tk]) obj[tk].stop();
      obj[tk] = this.tweens.add({ targets: obj, [key]: to, duration: dur, ease });
      return obj[tk];
    }

    // 每帧：鼓满的泡泡微微发颤、背后的光一呼一吸，一道反光从左上扫到右下，悬停和按压时变形
    update(time) {
      if (!this.d || !this.rect) return;
      const t = time / 1000, sweep = ((t % 6) / 6) * 1.8 - 0.4, d = this.d;
      for (let i = 0; i < d.n; i++) {
        const c = this.cells[i];
        if (!c.b.visible) continue;
        const lv = Math.max(1, Math.min(3, c.lv));
        const amp = reduceMotion ? 0 : lv === 3 ? 0.018 : lv === 2 ? 0.006 : 0.003;
        const w = Math.sin(t * (lv === 3 ? 5.2 : 2.4) + c.phase) * amp;
        const k = this.base * (1 + 0.06 * c.hk) * (1 + c.sw);
        const sx = k * (1 - 0.1 * c.pk) * (1 + w), sy = k * (1 - 0.17 * c.pk) * (1 - w);
        c.b.setScale(Math.max(0, sx), Math.max(0, sy));
        const r = LVR[lv] / LVR[3];
        c.gl.setScale(Math.max(0, sx * r), Math.max(0, sy * r));
        const diag = ((i % d.cols) + ((i / d.cols) | 0)) / (d.cols + d.rows);
        const sweepA = Math.max(0, 1 - Math.abs(diag - sweep) * 7);
        c.gl.setAlpha(Math.max(0, Math.min(1, (0.05 + 0.5 * sweepA) * (0.45 + 0.55 * LVH[lv]) + 0.4 * c.hk - 0.3 * c.pk)));
        if (c.glow.visible) {
          const pulse = reduceMotion ? 0.45 : 0.38 + 0.17 * Math.sin(t * 2.4 + c.phase);
          c.glow.setScale((this.rect.cell * 1.65 * Math.max(0, 1 + c.sw) * (1 + 0.08 * c.hk)) / 256).setAlpha(pulse + 0.25 * c.hk);
        }
      }
      for (const c of this.cells) if (c.hint.visible) c.hint.setAngle(t * 40);
    }
  }

  let game = null, board = null;
  function boot() {
    const fx = document.getElementById('fx');
    game = new Phaser.Game({
      type: Phaser.WEBGL, parent: fx, transparent: true,
      width: Math.round(innerWidth * DPR), height: Math.round(innerHeight * DPR),
      scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.NO_CENTER },
      render: { antialias: true, powerPreference: 'high-performance' },
      input: { mouse: false, touch: false, keyboard: false },
      banner: false, scene: [Board],
    });
    ready.then(() => { board = game.scene.getScene('board'); });
    let rt = 0;
    const relayout = () => {
      const w = Math.round(innerWidth * DPR), h = Math.round(innerHeight * DPR);
      if (w !== game.scale.width || h !== game.scale.height) game.scale.setGameSize(w, h);
      if (board) board.layout();
    };
    window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(relayout, 60); });
    window.addEventListener('scroll', () => { if (board) board.layout(); }, { passive: true });
    if (window.ResizeObserver) ready.then(() => new ResizeObserver(() => board && board.layout()).observe(sheetEl()));
    // 网页背景的电路纹
    try { document.documentElement.style.setProperty('--circuit', `url(${canvas(512, 512, circuitArt).toDataURL()})`); } catch (e) {}
  }

  const call = (fn) => (...a) => (board ? board[fn](...a) : undefined);
  window.BW_VIEW = {
    ready, sound, DPR,
    paint: call('paint'), fresh: call('fresh'), shake: call('shake'), popup: call('popup'),
    counter: call('counter'), counterEnd: call('counterEnd'), finale: call('finale'),
    layout: call('layout'),
    // 连锁每一波轻轻震一下，波越大震得越明显
    nudge(n) { if (board && !reduceMotion) board.cameras.main.shake(80, Math.min(0.005, 0.0008 * n)); },
    // 新的一波连锁从哪一格开始（决定错开爆的顺序和计数器的位置）
    origin(i) { if (board) board.origin = i; },
    // 换盘面、跳过回放时把还没放完的特效作废
    cancel() { if (!board) return; board.epoch++; board.counterEnd(); },
    press(i, on) { if (!board || i < 0 || !board.cells[i]) return; board.tweenProp(board.cells[i], 'pk', on ? 1 : 0, on ? 700 : 260, on ? 'Expo.easeOut' : 'Back.easeOut'); },
    hover(i) {
      if (!board || i === board.hoverIdx) return;
      if (board.hoverIdx >= 0 && board.cells[board.hoverIdx]) board.tweenProp(board.cells[board.hoverIdx], 'hk', 0, 160);
      board.hoverIdx = i;
      if (i >= 0 && board.cells[i]) board.tweenProp(board.cells[i], 'hk', 1, 160, 'Back.easeOut');
    },
    clearTouch(i) { if (board && board.cells[i]) { const c = board.cells[i]; if (c._tpk) c._tpk.stop(); if (c._thk) c._thk.stop(); c.pk = 0; c.hk = 0; } },
    // 这一格现在画的是不是一颗还能捏的泡泡（自动测试用）
    isAlive(i) { const c = board && board.cells[i]; return !!(c && c.lv > 0 && c.kind !== E.TAPE); },
    // 格子中心的网页坐标（自动测试和教学指引用）
    cellCenter(i) { if (!board || !board.rect || !board.cells[i]) return null; const p = board.pos(i); return { x: p.x / DPR, y: p.y / DPR }; },
    // 网页坐标 → 格子编号（不在泡泡上返回 -1）
    cellAt(clientX, clientY) {
      if (!board || !board.rect) return -1;
      const r = board.rect, x = clientX * DPR, y = clientY * DPR, d = board.d;
      const c = Math.floor((x - r.bx - r.pad) / r.cell), row = Math.floor((y - r.by - r.pad) / r.cell);
      if (c < 0 || row < 0 || c >= d.cols || row >= d.rows) return -1;
      const i = row * d.cols + c, p = board.pos(i);
      return Math.hypot(x - p.x, y - p.y) <= r.cell * 0.52 ? i : -1;
    },
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
