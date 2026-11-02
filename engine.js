/* 捏泡泡纸 · 规则引擎
 * 纯逻辑、不碰 DOM：浏览器里挂到 window.BW，Node 里 module.exports（关卡生成器、将来服务器验分也用它）。
 * 一个格子 = 气量 lv（0 已破，1–3 越来越鼓）+ 种类 kind：
 *   普通 / 胶带格（不透气）/ 金泡泡（被连锁带爆才算）/ 双层泡泡（爆一次外层还剩一层）/ 大气泡（爆开时周围 8 格都鼓）
 * 双层泡泡爆掉外层后会变成普通泡泡，所以 kind 也会被 settle 改写，分叉推演时 lv 和 kind 要一起拷贝。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BW = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const NORMAL = 0, TAPE = 1, GOLD = 2, DOUBLE = 3, BIG = 4;
  const GOLD_POINTS = 50, LEFTOVER_POINTS = 30;

  const dimsCache = new Map();
  function dims(cols, rows) {
    const key = cols + 'x' + rows;
    if (dimsCache.has(key)) return dimsCache.get(key);
    const n = cols * rows, nb = [], nb8 = [];
    for (let i = 0; i < n; i++) {
      const r = (i / cols) | 0, c = i % cols, a = [], b = [];
      if (r > 0) a.push(i - cols);
      if (r < rows - 1) a.push(i + cols);
      if (c > 0) a.push(i - 1);
      if (c < cols - 1) a.push(i + 1);
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const rr = r + dr, cc = c + dc;
        if (rr >= 0 && rr < rows && cc >= 0 && cc < cols) b.push(rr * cols + cc);
      }
      nb.push(a); nb8.push(b);
    }
    const d = { cols, rows, n, nb, nb8, key };
    dimsCache.set(key, d);
    return d;
  }

  const tri = (n) => n * (n + 1) / 2;
  const pointsFor = (count, gold) => tri(count) + gold * GOLD_POINTS;

  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function hash(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  function alive(lv) { let n = 0; for (let i = 0; i < lv.length; i++) if (lv[i]) n++; return n; }

  function sheet(d, rand, p1, p3) {
    const lv = new Int8Array(d.n);
    for (let i = 0; i < d.n; i++) { const x = rand(); lv[i] = x < p1 ? 1 : (x < 1 - p3 ? 2 : 3); }
    return lv;
  }

  // 按 spec 生成一张纸：{ p1, p3, tape, gold, double, big } 都是可选的数量。
  function board(d, rand, spec) {
    const lv = sheet(d, rand, spec.p1, spec.p3);
    const kind = new Int8Array(d.n);
    const free = () => { for (let t = 0; t < 500; t++) { const i = (rand() * d.n) | 0; if (kind[i] === NORMAL && lv[i]) return i; } return -1; };
    const place = (k, count, setLv) => { for (let j = 0; j < (count || 0); j++) { const i = free(); if (i < 0) return; kind[i] = k; if (setLv) lv[i] = setLv(); } };
    place(TAPE, spec.tape, () => 0);
    place(GOLD, spec.gold, () => 1 + ((rand() * 2) | 0));
    place(DOUBLE, spec.double);
    place(BIG, spec.big);
    return { lv, kind };
  }

  // 一个泡泡爆了：返回 true 表示它真的没了（双层泡泡只是掉了外层，变回普通的 1 级泡泡）。
  function burstCell(lv, kind, i) {
    if (kind[i] === DOUBLE) { kind[i] = NORMAL; lv[i] = 1; return false; }
    lv[i] = 0;
    return true;
  }
  const spread = (d, kind, c) => (kind[c] === BIG ? d.nb8[c] : d.nb[c]);

  // 捏破 idx：四周还没破的泡泡各鼓一级（大气泡是 8 个方向），鼓到 4 的下一波自己爆。改写 lv 和 kind。
  // 返回这一下一共爆了几次，以及其中被连锁带爆的金泡泡数（直接捏破的那个不算）。
  function settle(d, lv, kind, idx) {
    burstCell(lv, kind, idx);
    let wave = [idx], count = 1, gold = 0;
    while (wave.length) {
      for (const c of wave) for (const n of spread(d, kind, c)) if (lv[n] > 0) lv[n]++;
      const next = [];
      for (const c of wave) for (const n of spread(d, kind, c)) {
        if (lv[n] >= 4) {
          if (kind[n] === GOLD) gold++;
          burstCell(lv, kind, n);
          next.push(n);
        }
      }
      count += next.length;
      wave = next;
    }
    return { count, gold };
  }

  // 和 settle 一样，但保留每一波，给界面做动画。frame.lv / frame.kind 是这一波结束时的样子。
  function frames(d, lv0, kind0, idx) {
    const lv = Int8Array.from(lv0), kind = Int8Array.from(kind0);
    const goldAt = (i) => kind[i] === GOLD;
    burstCell(lv, kind, idx);
    const out = [{ lv: Int8Array.from(lv), kind: Int8Array.from(kind), popped: [idx], gold: [] }];
    let wave = [idx];
    while (wave.length) {
      for (const c of wave) for (const n of spread(d, kind, c)) if (lv[n] > 0) lv[n]++;
      const next = [], gold = [];
      for (const c of wave) for (const n of spread(d, kind, c)) {
        if (lv[n] >= 4) { if (goldAt(n)) gold.push(n); burstCell(lv, kind, n); next.push(n); }
      }
      out.push({ lv: Int8Array.from(lv), kind: Int8Array.from(kind), popped: next, gold });
      wave = next;
    }
    return out;
  }

  // 最大的一片"鼓满"泡泡有多大：粗略估计下一下能连锁多少。
  function readyGroup(d, lv) {
    const seen = new Uint8Array(d.n);
    let best = 0;
    for (let i = 0; i < d.n; i++) {
      if (seen[i] || lv[i] !== 3) continue;
      let size = 0;
      const stack = [i]; seen[i] = 1;
      while (stack.length) {
        const c = stack.pop(); size++;
        for (const n of d.nb[c]) if (!seen[n] && lv[n] === 3) { seen[n] = 1; stack.push(n); }
      }
      if (size > best) best = size;
    }
    return best;
  }

  function goldTotal(lv, kind) { let n = 0; for (let i = 0; i < lv.length; i++) if (kind[i] === GOLD && lv[i]) n++; return n; }

  function goalMet(goal, s) {
    switch (goal.type) {
      case 'clear': return s.left === 0;
      case 'score': return s.score >= goal.target;
      case 'gold': return s.gold >= goal.target;
      case 'chain': return s.maxChain >= goal.target;
      default: return true;
    }
  }

  // 从 (lv, kind) 捏 i，返回新的盘面和这一下的结果，不改原盘面。
  function tryPress(d, lv0, kind0, i) {
    const lv = Int8Array.from(lv0), kind = Int8Array.from(kind0);
    const direct = kind0[i] === GOLD ? 1 : 0;
    const r = settle(d, lv, kind, i);
    return { lv, kind, count: r.count, gold: r.gold, direct };
  }

  // 束搜索：在 presses 下之内找一条达成目标、分数尽量高的捏法。
  // rankBy 'chain' 时改为找最长单次连锁（出"连锁关"的题用）。
  function solve(d, lv0, kind0, presses, goal, width, rankBy) {
    goal = goal || { type: 'none' };
    width = width || 70;
    const total = goldTotal(lv0, kind0);
    let beamArr = [{ lv: Int8Array.from(lv0), kind: Int8Array.from(kind0), score: 0, gold: 0, lost: 0, maxChain: 0, path: [] }];
    let best = null;
    const better = (a, b) => rankBy === 'chain'
      ? (a.maxChain > b.maxChain || (a.maxChain === b.maxChain && a.score > b.score))
      : a.score > b.score;
    const consider = (s, used) => {
      const left = alive(s.lv);
      const score = s.score + (left === 0 ? (presses - used) * LEFTOVER_POINTS : 0);
      const res = { score, gold: s.gold, lost: s.lost, maxChain: s.maxChain, left, path: s.path };
      if (!goalMet(goal, res)) return;
      if (!best || better(res, best)) best = res;
    };
    const value = (s) => {
      let v = s.score + 0.6 * tri(readyGroup(d, s.lv));
      if (rankBy === 'chain') v += s.maxChain * 40;
      if (goal.type === 'clear') v -= alive(s.lv) * 12;
      else if (goal.type === 'gold') v += s.gold * 150;
      else if (goal.type === 'chain') v += s.maxChain >= goal.target ? 400 : s.maxChain * 8;
      return v;
    };
    for (let step = 0; step < presses && beamArr.length; step++) {
      const seen = new Map();
      for (const s of beamArr) {
        for (let i = 0; i < d.n; i++) {
          if (!s.lv[i]) continue;
          const lost = s.lost + (s.kind[i] === GOLD ? 1 : 0);
          if (goal.type === 'gold' && total - lost < goal.target) continue;
          const r = tryPress(d, s.lv, s.kind, i);
          const ns = { lv: r.lv, kind: r.kind, score: s.score + pointsFor(r.count, r.gold), gold: s.gold + r.gold, lost, maxChain: Math.max(s.maxChain, r.count), path: s.path.concat(i) };
          if (!alive(r.lv)) { consider(ns, step + 1); continue; }
          const key = r.lv.join('') + r.kind.join('');
          const v = value(ns);
          const prev = seen.get(key);
          if (!prev || prev.v < v) seen.set(key, { s: ns, v });
        }
      }
      beamArr = [...seen.values()].sort((a, b) => b.v - a.v).slice(0, width).map((x) => x.s);
    }
    for (const s of beamArr) consider(s, presses);
    return best;
  }

  // 最少几下捏完整张（束搜索近似）。
  function minClear(d, lv0, kind0, width) {
    width = width || 140;
    kind0 = kind0 || new Int8Array(d.n);
    if (!alive(lv0)) return 0;
    let arr = [{ lv: lv0, kind: kind0 }];
    for (let depth = 1; depth <= 40; depth++) {
      const seen = new Map();
      for (const s of arr) {
        for (let i = 0; i < d.n; i++) {
          if (!s.lv[i]) continue;
          const r = tryPress(d, s.lv, s.kind, i);
          let rem = 0, sum = 0;
          for (let j = 0; j < d.n; j++) if (r.lv[j]) { rem++; sum += r.lv[j]; }
          if (rem === 0) return depth;
          const key = r.lv.join('') + r.kind.join('');
          if (!seen.has(key)) seen.set(key, { lv: r.lv, kind: r.kind, v: rem * 8 - sum });
        }
      }
      arr = [...seen.values()].sort((a, b) => a.v - b.v).slice(0, width);
    }
    return null;
  }

  // 用某种挑法把一关从头玩到尾。pick(d, lv, kind, rand) 返回要捏的格子。
  function playOut(d, lv0, kind0, presses, pick, rand) {
    let lv = Int8Array.from(lv0), kind = Int8Array.from(kind0);
    let score = 0, gold = 0, lost = 0, maxChain = 0, used = 0;
    const path = [];
    for (; used < presses && alive(lv); used++) {
      const i = pick(d, lv, kind, rand);
      path.push(i);
      const r = tryPress(d, lv, kind, i);
      lv = r.lv; kind = r.kind;
      score += pointsFor(r.count, r.gold); gold += r.gold; lost += r.direct; maxChain = Math.max(maxChain, r.count);
    }
    const left = alive(lv);
    if (left === 0) score += (presses - used) * LEFTOVER_POINTS;
    return { score, gold, lost, maxChain, left, path };
  }

  // 只要还有别的泡泡可捏，就不直接捏金泡泡（直接捏破就白费了）。
  function plainCells(lv, kind) {
    const out = [];
    for (let i = 0; i < lv.length; i++) if (lv[i] && kind[i] !== GOLD) out.push(i);
    if (!out.length) for (let i = 0; i < lv.length; i++) if (lv[i]) out.push(i);
    return out;
  }
  // 每次都挑连锁最多的那一下：用来检验一关是不是"不动脑也能过"。
  function greedyPick(d, lv, kind) {
    let best = -1, bc = -1, bs = -1;
    for (const i of plainCells(lv, kind)) {
      const r = tryPress(d, lv, kind, i);
      let sum = 0; for (let j = 0; j < d.n; j++) sum += r.lv[j];
      const c = pointsFor(r.count, r.gold);
      if (c > bc || (c === bc && sum > bs)) { bc = c; bs = sum; best = i; }
    }
    return best;
  }
  function playGreedy(d, lv0, kind0, presses) { return playOut(d, lv0, kind0, presses, greedyPick); }
  // 往后看一步：这一下的分 + 下一下最好的分。无尽模式的提示用它，会教玩家"先垫后爆"。
  function lookPick(d, lv, kind) {
    let best = -1, bv = -1;
    for (const i of plainCells(lv, kind)) {
      const r = tryPress(d, lv, kind, i);
      let next = 0;
      for (let j = 0; j < d.n; j++) {
        if (!r.lv[j] || r.kind[j] === GOLD) continue;
        const t = tryPress(d, r.lv, r.kind, j);
        next = Math.max(next, pointsFor(t.count, t.gold));
      }
      const v = pointsFor(r.count, r.gold) + next;
      if (v > bv) { bv = v; best = i; }
    }
    return best;
  }

  return { NORMAL, TAPE, GOLD, DOUBLE, BIG, GOLD_POINTS, LEFTOVER_POINTS, dims, tri, pointsFor, rng, hash, alive, sheet, board, settle, frames, tryPress, readyGroup, goldTotal, goalMet, solve, minClear, playOut, playGreedy, greedyPick, lookPick, plainCells };
});
