/* Motion Scout — UI (public).
 * The page is built on Motion's official leaderboard (ranks only). Creator stats from X and
 * YouTube come from the server (js/api.js → Apps Script) and are shown as context: they don't
 * change the order. The deck builder values creators by official rank.
 * The earlier version with Motion Scout's own score estimate is kept in archive/.
 */
(function () {
  'use strict';
  var MS = window.MotionScout, API = MS.api, LU = MS.lineup;
  var LS_SET = 'motionScout.settings.v1', LS_CARDS = 'motionScout.cards.v1', LS_LINEUP = 'motionScout.lineup.v1';
  var PLATFORM = { x: { label: 'X', short: 'X' }, youtube: { label: 'YouTube', short: 'YT' } };
  var RARITIES = ['common', 'rare', 'epic', 'legendary'];
  var CAP_MIN = 8, CAP_MAX = 40;

  var state = {
    cfg: MS.clonePublicConfig(),
    stats: null, statsError: null,          // server result: { meta, creators: [{ key, handle, platforms, followers, stars, stats }] }
    official: null, officialError: null,    // { asOf, rows: [{ key, name, handle, position, delta }] }
    history: null, historyError: null,      // server: { names: [...], snapshots: [{ t, p: [position per name] }] }
    board: null,                            // official rows joined with stats and history (see buildBoard)
    lastPicks: [],                          // keys of the current deck draft
    lineup: [],                             // keys of "My lineup this week" (max 5)
    onlyMine: true,                         // deck from owned creators only (when cards are set)
    sort: { key: 'rank', dir: -1 }
  };

  /* ---------- helpers ---------- */
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fInt(n) { return n == null ? '—' : Math.round(n).toLocaleString('en-US'); }
  function fK(n) {
    if (n == null) return '—';
    if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + 'K';
    return String(Math.round(n));
  }
  function fTime(iso) {
    var t = Date.parse(iso);
    return isFinite(t) ? new Date(t).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' }) : 'latest';
  }
  function lsGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { window.localStorage.setItem(k, v); } catch (e) { /* storage unavailable */ } }
  function lsDel(k) { try { window.localStorage.removeItem(k); } catch (e) { /* ignore */ } }
  function rarityLabel(r) { return r.charAt(0).toUpperCase() + r.slice(1); }
  function starsText(c) { return c.stars != null ? c.stars + '★' : '≈' + c.estStars + '★'; }

  /* ---------- data ---------- */
  // Creator stats (X + YouTube, last 14 days) from the server. Only context: the order comes from Motion.
  function withTimeout(promise, ms) {
    return new Promise(function (resolve, reject) {
      var t = setTimeout(function () { reject(new Error('timed out')); }, ms);
      promise.then(function (v) { clearTimeout(t); resolve(v); }, function (e) { clearTimeout(t); reject(e); });
    });
  }
  function loadStats() {
    state.statsError = null;
    withTimeout(API.live(state.cfg), 20000)
      .then(function (res) {
        if (!res.creators || !res.creators.length) throw new Error((res.errors && res.errors[0]) || 'no data yet');
        state.stats = res;
        rebuild();
      })
      .catch(function (e) { state.statsError = e.message; rebuild(); });
  }

  // Official leaderboard snapshots the server logs every 4 hours (rank history, movers, My lineup).
  function loadHistory() {
    state.historyError = null;
    withTimeout(API.history(state.cfg), 20000)
      .then(function (h) {
        if (!h || !h.snapshots || !h.snapshots.length) throw new Error('no snapshots yet');
        state.history = h;
        rebuild();
      })
      .catch(function (e) { state.historyError = e.message; rebuild(); });
  }

  // Minutes to add to UTC to get New York time at that moment (handles daylight saving).
  function nyOffsetMin(d) {
    var m = d.toLocaleString('en-US', { timeZone: 'America/New_York', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
      .match(/(\d+)\/(\d+)\/(\d+),?\s*(\d+):(\d+)/);
    if (!m) return -300;
    return Math.round((Date.UTC(+m[3], +m[1] - 1, +m[2], +m[4] % 24, +m[5]) - d.getTime()) / 60000);
  }
  // Lineups lock on Monday 7 AM ET: the latest such moment at or before `now`.
  function lastLock(now) {
    for (var i = 0; i < 8; i++) {
      var day = new Date(now.getTime() - i * 864e5), off = nyOffsetMin(day);
      var local = new Date(day.getTime() + off * 60000);
      if (local.getUTCDay() !== 1) continue;
      var lock = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), 7, 0) - off * 60000;
      if (lock <= now.getTime()) return new Date(lock);
    }
    return new Date(now.getTime() - 7 * 864e5);
  }

  // Motion's public leaderboard has names and ranks only. Names are matched to X handles
  // through js/creators-data.js (generated from data/creators.csv).
  function loadOfficial() {
    var url = state.cfg.officialUrl;
    if (!url || !window.fetch) { state.officialError = 'not configured'; rebuild(); return; }
    state.officialError = null;
    var byName = {};
    (MS.CREATORS || []).forEach(function (c) { byName[c.name.toLowerCase()] = c; });
    fetch(url, { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (j) {
        var rows = (j.rows || []).filter(function (r) { return r.position > 0; }).map(function (r) {
          var c = byName[String(r.name || '').toLowerCase()];
          var key = (c && (c.x || c.name) || String(r.name)).toLowerCase();
          return { key: key, name: r.name, handle: c && c.x ? c.x : null, position: r.position, delta: r.delta || 0 };
        }).sort(function (a, b) { return a.position - b.position; });
        if (!rows.length) throw new Error('the leaderboard is empty');
        state.official = { asOf: j.asOf || j.capturedAt || '', rows: rows };
        rebuild();
      })
      .catch(function (e) { state.officialError = e.message; rebuild(); });
  }

  // One row per creator on the official leaderboard:
  //   estStars  ≈ stars from rank, using Fantasy Top's published tier split (until real stars are added)
  //   points    deck value from rank: #1 = 1,000, the last ≈ 1,000 / N (Motion doesn't publish scores)
  function buildBoard() {
    if (!state.official) return null;
    var rows = state.official.rows, N = rows.length, bands = state.cfg.starBands;
    var statsBy = {};
    (state.stats ? state.stats.creators : []).forEach(function (c) { statsBy[c.key] = c; });
    var list = rows.map(function (r) {
      var s = statsBy[r.key] || null;
      var pct = N > 1 ? (N - r.position) / (N - 1) * 100 : 100, est = 1;
      bands.forEach(function (b, i) { if (pct >= b) est = i + 1; });
      var x = s ? (s.stats || []).filter(function (p) { return p.platform === 'x'; })[0] : null;
      var yt = s ? (s.stats || []).filter(function (p) { return p.platform === 'youtube'; })[0] : null;
      return {
        key: r.key, name: r.name, handle: r.handle || (s && s.handle) || r.name,
        position: r.position, delta: r.delta,
        stars: mineStars(r.key) || (s && s.stars != null ? s.stars : null), estStars: est, predictedStars: est,
        starsFrom: mineStars(r.key) ? 'yours' : (s && s.stars != null ? 'game' : null),
        points: Math.round(1000 * (N - r.position + 1) / N),
        platforms: s ? s.platforms : [], x: x, yt: yt,
        perPost: x && x.posts > 0 ? x.views / x.posts : null
      };
    });
    // rank history: each creator's positions over the logged snapshots, and the change since the lock
    var hist = state.history, lock = lastLock(new Date()), base = null;
    if (hist) {
      var idx = {};
      hist.names.forEach(function (n, i) { idx[n.toLowerCase()] = i; });
      var snaps = hist.snapshots;
      for (var k = snaps.length - 1; k >= 0; k--) if (Date.parse(snaps[k].t) <= lock.getTime()) { base = snaps[k]; break; }
      if (!base) base = snaps[0];
      list.forEach(function (c) {
        var i = idx[c.name.toLowerCase()];
        if (i == null) return;
        c.series = snaps.map(function (sn) { return { t: sn.t, p: sn.p[i] }; }).filter(function (x) { return x.p; });
        var b = base.p[i];
        c.basePos = b || null;
        c.weekChange = b ? b - c.position : null; // + = climbed
      });
    }
    var onBoard = {};
    list.forEach(function (c) { onBoard[c.key] = true; });
    var extra = (state.stats ? state.stats.creators : []).filter(function (c) { return !onBoard[c.key]; })
      .map(function (c) { return c.handle; });
    return { list: list, extra: extra, N: N, lock: lock, baseT: base ? base.t : null, sinceLock: !!(base && Date.parse(base.t) <= lock.getTime()) };
  }

  function rebuild() {
    state.board = buildBoard();
    renderAll();
  }

  /* ---------- render ---------- */
  function renderStatus() {
    var el = $('data-status'), o = state.official;
    el.classList.toggle('is-demo', !o);
    if (!o) {
      el.textContent = state.officialError ? 'Official leaderboard unavailable right now' : 'Loading the official leaderboard…';
      return;
    }
    var stats = state.stats
      ? 'Social stats from X' + (state.stats.meta && /youtube/i.test(state.stats.meta.platform || '') ? ' and YouTube' : '') + ' · ' +
        state.stats.meta.dateFrom + ' → ' + state.stats.meta.dateTo
      : state.statsError ? 'Social stats unavailable right now' : 'Loading social stats…';
    el.innerHTML = esc('Creator ranks · updated ' + fTime(o.asOf) + ' · ' + o.rows.length + ' creators · ' + stats) +
      ' <button type="button" class="status-refresh" id="btn-refresh">Refresh</button>';
  }
  function refreshAll() {
    $('data-status').textContent = 'Refreshing…';
    loadOfficial();
    if (state.cfg.apiUrl) { loadStats(); loadHistory(); }
  }
  function renderAll() {
    renderStatus();
    $('errors').innerHTML = !state.official && state.officialError
      ? '<div class="err">Couldn’t load Motion’s official leaderboard (' + esc(state.officialError) + '). Try again in a minute.</div>' : '';
    var has = !!state.board;
    ['lineup-section', 'ranking-section'].forEach(function (id) { $(id).hidden = !has && !!state.officialError; });
    if (has) { renderLineup(); renderMyLineup(); renderMovers(); renderRanking(); }
  }

  function chipsFor(c) {
    return (c.platforms || []).filter(function (id) { return id !== 'x'; })
      .map(function (id) { var p = PLATFORM[id] || { label: id, short: id }; return '<span class="chip chip-pf" title="' + esc(p.label) + '">' + esc(p.short) + '</span>'; }).join('');
  }
  function deltaHtml(d) {
    return d > 0 ? '<span class="dl up">▲' + d + '</span>' : d < 0 ? '<span class="dl down">▼' + (-d) + '</span>' : '<span class="dl">–</span>';
  }
  function tierOf(c) { var s = c.stars != null ? c.stars : c.estStars; return s >= 7 ? 4 : s >= 5 ? 3 : s >= 4 ? 2 : s >= 2 ? 1 : 0; }

  /* ---------- build a deck ---------- */
  var myCards = {}; // creator key → best rarity you own
  try { myCards = JSON.parse(lsGet(LS_CARDS) || '{}') || {}; } catch (e) { myCards = {}; }
  Object.keys(myCards).forEach(function (k) { // older versions stored just the rarity
    if (typeof myCards[k] === 'string') myCards[k] = { r: myCards[k], s: null };
  });
  function mineStars(key) { return myCards[key] && myCards[key].s ? myCards[key].s : null; }
  function cardBoosts() {
    var out = {};
    Object.keys(myCards).forEach(function (k) { var b = state.cfg.cardBoosts[myCards[k].r]; if (b > 0) out[k] = b; });
    return out;
  }
  function setStarCap(v) {
    v = Math.round(Math.min(CAP_MAX, Math.max(CAP_MIN, Number(v) || state.cfg.lineup.starCap)));
    if (v === state.cfg.lineup.starCap) { $('cap-num').value = v; return; }
    state.cfg.lineup.starCap = v;
    lsSet(LS_SET, JSON.stringify(savedSettings()));
    renderLineup();
  }

  function renderLineup() {
    var cfg = state.cfg, boosts = cardBoosts(), list = state.board.list;
    var useCards = Object.keys(boosts).length > 0;
    var lu = LU.best(list, cfg, useCards ? boosts : null, { onlyOwned: state.onlyMine });
    var owned = list.filter(function (c) { return myCards[c.key] && myCards[c.key].r; }).length;
    $('lineup-title').textContent = 'Build a deck · ≤' + cfg.lineup.starCap + '★';
    $('lineup-sub').textContent = 'Pick a star cap (' + CAP_MIN + '–' + CAP_MAX + '★) to draft the ' + cfg.lineup.size + ' creators with the best rank-based value that fit under it, with your card boosts. A planning draft: check boost limits and submit in Motion’s Homebase.';
    // The controls are drawn once, so dragging the slider isn't interrupted by re-rendering.
    if (!$('cap-range')) {
      $('lineup').innerHTML = '<div class="card-cut lineup-box"><div class="lineup-bar">' +
        '<label class="cap-ctl"><span>Star cap</span>' +
          '<input type="range" id="cap-range" min="' + CAP_MIN + '" max="' + CAP_MAX + '" step="1" aria-label="Star cap">' +
          '<input type="number" id="cap-num" min="' + CAP_MIN + '" max="' + CAP_MAX + '" step="1" inputmode="numeric" aria-label="Star cap, number"><b>★</b></label>' +
        '<button type="button" class="btn btn-ghost" id="btn-cards"><span>My cards</span></button>' +
        '<button type="button" class="btn btn-ghost" id="btn-config"><span>Boosts</span></button>' +
        '<label class="only-mine"><input type="checkbox" id="only-mine"> Only creators I own</label>' +
        '<span class="muted" id="lineup-mode"></span></div><div id="lineup-body"></div></div>';
    }
    if (String($('cap-range').value) !== String(cfg.lineup.starCap)) $('cap-range').value = cfg.lineup.starCap;
    if (document.activeElement !== $('cap-num')) $('cap-num').value = cfg.lineup.starCap;
    $('btn-cards').innerHTML = '<span>My cards' + (owned ? ' · ' + owned : '') + '</span>';
    $('only-mine').checked = state.onlyMine;
    $('only-mine').disabled = !useCards;
    $('lineup-mode').textContent = !useCards
      ? 'No cards set: every creator counts with a Common 1× card. Add your cards to plan with your real boosts and stars.'
      : state.onlyMine ? 'Picking only from creators you have cards of, with each card’s Score Boost.'
      : 'Picking from everyone: your cards add their boosts, the rest count as Common 1×.';
    state.lastPicks = lu.error ? [] : lu.picks.map(function (p) { return p.c.key; });
    if (lu.error) { $('lineup-body').innerHTML = '<div class="empty">' + esc(lu.error) + '</div>'; return; }
    $('lineup-body').innerHTML = '<div class="lineup-picks">' +
      lu.picks.map(function (p) {
        var r = myCards[p.c.key] && myCards[p.c.key].r;
        return '<button type="button" class="lineup-pick' + (r ? ' r-' + r : '') + '" data-key="' + esc(p.c.key) + '">' +
          '<span class="lp-rank">#' + p.c.position + '</span>' +
          '<span class="lp-handle">@' + esc(p.c.handle) + '</span>' +
          '<span class="lp-meta"><b>' + (p.predicted ? '≈' : '') + p.stars + '★</b>' +
            (useCards && r ? ' · ' + esc(rarityLabel(r)) + ' <b>' + p.boost + '×</b>' : '') + '</span>' +
        '</button>';
      }).join('') + '</div>' +
      '<div class="lineup-total"><span>' + (lu.usesPredicted ? 'Estimated stars' : 'Stars') + ' <b>' + (lu.usesPredicted ? '≈' : '') + lu.stars + ' / ' + lu.cap + '</b></span><span>Deck value <b>' + fInt(lu.score) + '</b></span></div>' +
      '<p class="lineup-note muted">Motion doesn’t publish creator scores, so the deck is valued by official rank (#1 = 1,000 … last ≈ ' + fInt(1000 / state.board.N) + ') × card boost. ' +
      (lu.usesPredicted ? '<b>Stars marked ≈ are estimated from rank</b>, so the real total may differ: add the stars your cards show in <b>My cards</b>. ' : '') +
      'Tournament boost limits aren’t checked here.</p>';
  }

  function openCards() {
    var list = state.board.list.slice().sort(function (a, b) { return a.handle.localeCompare(b.handle); });
    var b = state.cfg.cardBoosts;
    var opts = '<option value="">— none</option>' + RARITIES.map(function (r) {
      return '<option value="' + r + '">' + rarityLabel(r) + ' ' + b[r] + '×</option>';
    }).join('');
    var starOpts = '<option value="">★ ?</option>' + [1, 2, 3, 4, 5, 6, 7, 8].map(function (n) { return '<option value="' + n + '">' + n + '★</option>'; }).join('');
    var dlg = $('cards');
    dlg.innerHTML = '<div class="modal-head"><h2 id="cards-title">My cards</h2><button type="button" class="modal-x" data-close aria-label="Close">✕</button></div>' +
      '<div class="modal-body"><p class="muted">For each creator you own, pick your rarest card and the stars the game shows on it. The deck builder then uses only these creators, with their boosts and real stars. Saved in this browser only.</p>' +
      '<input type="search" id="cards-filter" class="cards-filter" placeholder="Search creators" aria-label="Search creators" autocomplete="off">' +
      '<p class="cards-empty muted" id="cards-empty" hidden>No creators match your search. <button type="button" class="status-refresh" id="cards-search-clear">Clear search</button></p>' +
      '<div class="cards-list">' + list.map(function (c) {
        return '<label class="cards-row" data-name="' + esc((c.handle + ' ' + c.name).toLowerCase()) + '"><span>@' + esc(c.handle) + ' <small class="muted">#' + c.position + '</small></span>' +
          '<span class="cards-sel"><select data-card="' + esc(c.key) + '" aria-label="Card rarity for @' + esc(c.handle) + '">' + opts + '</select>' +
          '<select data-stars="' + esc(c.key) + '" aria-label="Stars for @' + esc(c.handle) + '">' + starOpts + '</select></span></label>';
      }).join('') + '</div></div>' +
      '<div class="cfg-actions"><button type="button" class="btn btn-ghost" id="cards-clear"><span>Clear all</span></button>' +
      '<button type="button" class="btn btn-pink" data-close><span>Done</span></button></div>';
    Array.prototype.forEach.call(dlg.querySelectorAll('select[data-card]'), function (s) { s.value = myCards[s.dataset.card] ? myCards[s.dataset.card].r || '' : ''; });
    Array.prototype.forEach.call(dlg.querySelectorAll('select[data-stars]'), function (s) { s.value = myCards[s.dataset.stars] && myCards[s.dataset.stars].s ? String(myCards[s.dataset.stars].s) : ''; });
    dlg.showModal();
  }
  function saveCards() { lsSet(LS_CARDS, JSON.stringify(myCards)); rebuild(); }

  /* ---------- rank history: sparklines and movers ---------- */
  function moveText(d) { return d > 0 ? '<span class="dl up">▲' + d + '</span>' : d < 0 ? '<span class="dl down">▼' + (-d) + '</span>' : '<span class="dl">–</span>'; }
  // Rank over the logged snapshots; #1 at the top. Needs at least two points.
  function sparkline(c, w, h, big) {
    var pts = c.series || [];
    if (pts.length < 2) return '';
    var t0 = Date.parse(pts[0].t), t1 = Date.parse(pts[pts.length - 1].t), span = Math.max(1, t1 - t0);
    var ps = pts.map(function (x) { return x.p; }), lo = Math.min.apply(null, ps), hi = Math.max.apply(null, ps);
    if (hi - lo < 4) { var mid = (hi + lo) / 2; lo = mid - 2; hi = mid + 2; }
    var pad = big ? 8 : 2;
    var xy = pts.map(function (x) {
      return [pad + (Date.parse(x.t) - t0) / span * (w - 2 * pad), pad + (x.p - lo) / (hi - lo) * (h - 2 * pad)];
    });
    var d = xy.map(function (q, i) { return (i ? 'L' : 'M') + q[0].toFixed(1) + ' ' + q[1].toFixed(1); }).join(' ');
    var last = xy[xy.length - 1];
    var up = c.weekChange != null ? c.weekChange : pts[0].p - pts[pts.length - 1].p; // same reference as Movers
    return '<svg class="spark' + (big ? ' spark-big' : '') + (up > 0 ? ' up' : up < 0 ? ' down' : '') + '" viewBox="0 0 ' + w + ' ' + h + '" width="' + w + '" height="' + h + '" aria-hidden="true">' +
      '<path d="' + d + '"/><circle cx="' + last[0].toFixed(1) + '" cy="' + last[1].toFixed(1) + '" r="' + (big ? 4 : 2.2) + '"/></svg>';
  }

  function renderMovers() {
    var el = $('movers'), b = state.board;
    if (!el) return;
    if (!state.history) {
      el.innerHTML = state.historyError
        ? '<div class="movers-empty muted">Rank history isn’t available yet. Movers will show up here once snapshots of the official leaderboard are collected.</div>'
        : '<div class="movers-empty muted">Loading rank history…</div>';
      return;
    }
    var withMove = b.list.filter(function (c) { return c.weekChange != null; });
    var since = b.sinceLock ? 'since Monday’s lock (' + esc(fTime(b.lock.toISOString())) + ')' : 'since ' + esc(fTime(b.baseT)) + ', when tracking started';
    var up = withMove.filter(function (c) { return c.weekChange > 0; }).sort(function (x, y) { return y.weekChange - x.weekChange || x.position - y.position; }).slice(0, 5);
    var down = withMove.filter(function (c) { return c.weekChange < 0; }).sort(function (x, y) { return x.weekChange - y.weekChange || x.position - y.position; }).slice(0, 5);
    var item = function (c) {
      return '<button type="button" class="mv-item" data-key="' + esc(c.key) + '"><span class="mv-move">' + moveText(c.weekChange) + '</span>' +
        '<span class="mv-who">@' + esc(c.handle) + '<small>#' + c.basePos + ' → #' + c.position + '</small></span>' + sparkline(c, 70, 20) + '</button>';
    };
    el.innerHTML = '<div class="movers card-cut"><div class="movers-head"><h3>Movers</h3><span class="muted">' + since + ' · ' + state.history.snapshots.length + ' snapshots</span></div>' +
      (up.length || down.length
        ? '<div class="movers-cols"><div><h4 class="up">Climbing</h4>' + (up.map(item).join('') || '<p class="muted">Nobody yet.</p>') + '</div>' +
          '<div><h4 class="down">Falling</h4>' + (down.map(item).join('') || '<p class="muted">Nobody yet.</p>') + '</div></div>'
        : '<p class="muted">No rank changes yet. Motion updates the leaderboard about every 4 hours.</p>') + '</div>';
  }

  /* ---------- my lineup this week ---------- */
  try { state.lineup = (JSON.parse(lsGet(LS_LINEUP) || '[]') || []).slice(0, 5); } catch (e) { state.lineup = []; }
  function saveLineup() { lsSet(LS_LINEUP, JSON.stringify(state.lineup)); renderMyLineup(); }
  function renderMyLineup() {
    var el = $('mylineup'), b = state.board;
    if (!el || !b) return;
    var by = {};
    b.list.forEach(function (c) { by[c.key] = c; });
    var picks = state.lineup.map(function (k) { return by[k]; }).filter(Boolean);
    var boost = function (c) { var m = myCards[c.key]; return m && m.r ? state.cfg.cardBoosts[m.r] || 1 : 1; };
    var valueAt = function (pos) { return Math.round(1000 * (b.N - pos + 1) / b.N); };
    var head = '<div class="ml-head"><h3>My lineup this week</h3>' +
      '<span class="ml-actions"><button type="button" class="btn btn-ghost" id="ml-use"><span>Use this draft</span></button>' +
      '<button type="button" class="btn btn-ghost" id="ml-edit"><span>Pick creators</span></button>' +
      (picks.length ? '<button type="button" class="btn btn-ghost" id="ml-clear"><span>Clear</span></button>' : '') + '</span></div>';
    if (!picks.length) {
      el.innerHTML = '<div class="card-cut ml-box">' + head + '<p class="muted">Track the five you submitted: see how their official ranks move through the week, from Monday’s lock to Friday’s results. Saved in this browser.</p></div>';
      return;
    }
    var hasBase = picks.some(function (c) { return c.basePos; });
    var nowVal = 0, baseVal = 0;
    var rows = picks.map(function (c) {
      var bst = boost(c);
      nowVal += valueAt(c.position) * bst;
      if (c.basePos) baseVal += valueAt(c.basePos) * bst;
      return '<tr data-key="' + esc(c.key) + '"><td>@' + esc(c.handle) + '</td><td>' + starsText(c) + '</td><td>' + (c.basePos ? '#' + c.basePos : '—') + '</td><td><b>#' + c.position + '</b></td><td>' +
        (c.weekChange != null ? moveText(c.weekChange) : '—') + '</td><td>' + sparkline(c, 80, 20) + '</td></tr>';
    }).join('');
    var label = b.sinceLock ? 'At lock' : (b.baseT ? 'Since ' + esc(fTime(b.baseT)) : 'At lock');
    el.innerHTML = '<div class="card-cut ml-box">' + head +
      '<div class="tbl-wrap"><table class="tbl ml-tbl"><thead><tr><th>Creator</th><th>Stars</th><th>' + label + '</th><th>Now</th><th>Change</th><th>Trend</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<div class="lineup-total"><span>Deck value now <b>' + fInt(nowVal) + '</b></span>' +
      (hasBase ? '<span>' + label + ' <b>' + fInt(baseVal) + '</b></span><span>Change <b>' + (nowVal - baseVal >= 0 ? '+' : '−') + fInt(Math.abs(nowVal - baseVal)) + '</b></span>' : '') + '</div>' +
      (state.history ? '' : '<p class="muted">Rank history is still loading or not collected yet, so changes appear once snapshots exist.</p>') + '</div>';
  }
  function openLineupPicker() {
    var list = state.board.list.slice().sort(function (a, b) { return a.position - b.position; });
    var dlg = $('lineup-dlg');
    dlg.innerHTML = '<div class="modal-head"><h2 id="lineup-dlg-title">My lineup</h2><button type="button" class="modal-x" data-close aria-label="Close">✕</button></div>' +
      '<div class="modal-body"><p class="muted">Pick the five creators you submitted this week (<span id="ml-count">' + state.lineup.length + '</span>/5).</p>' +
      '<input type="search" id="ml-filter" class="cards-filter" placeholder="Search creators" aria-label="Search creators" autocomplete="off">' +
      '<div class="cards-list">' + list.map(function (c) {
        return '<label class="cards-row" data-name="' + esc((c.handle + ' ' + c.name).toLowerCase()) + '"><span>@' + esc(c.handle) + ' <small class="muted">#' + c.position + '</small></span>' +
          '<input type="checkbox" data-ml="' + esc(c.key) + '"' + (state.lineup.indexOf(c.key) >= 0 ? ' checked' : '') + ' aria-label="Pick @' + esc(c.handle) + '"></label>';
      }).join('') + '</div></div>' +
      '<div class="cfg-actions"><button type="button" class="btn btn-pink" data-close><span>Done</span></button></div>';
    syncPickerLimit();
    dlg.showModal();
  }
  function syncPickerLimit() {
    var full = state.lineup.length >= 5;
    Array.prototype.forEach.call($('lineup-dlg').querySelectorAll('input[data-ml]'), function (i) { i.disabled = full && !i.checked; });
    if ($('ml-count')) $('ml-count').textContent = state.lineup.length;
  }

  /* ---------- leaderboard ---------- */
  var SORTS = [
    { key: 'rank', label: '#' },
    { key: 'handle', label: 'Creator' },
    { key: 'delta', label: 'Change' },
    { key: 'posts', label: 'Posts' },
    { key: 'active', label: 'Active' },
    { key: 'views', label: 'Views' },
    { key: 'followers', label: 'Followers' },
    { key: 'stars', label: 'Stars' },
    { key: 'perPost', label: 'Views/post' }
  ];
  var STAT_COLS = [
    { key: 'posts', short: 'POSTS', get: function (c) { return c.x ? c.x.posts : null; }, fmt: fInt },
    { key: 'active', short: 'ACTIVE', get: function (c) { return c.x ? c.x.activeDays : null; }, fmt: function (v, c) { return v == null ? '—' : v + '/' + c.x.days + ' d'; } },
    { key: 'views', short: 'VIEWS', get: function (c) { return c.x ? c.x.views : null; }, fmt: fK },
    { key: 'followers', short: 'FOLLOW.', get: function (c) { return c.x ? c.x.followersNow : null; }, fmt: fK }
  ];
  // null = no data: always sorted to the bottom, in both directions
  function sortVal(c, key) {
    if (key === 'rank') return -c.position;
    if (key === 'handle') return c.handle.toLowerCase();
    if (key === 'delta') return c.delta;
    if (key === 'stars') return (c.stars != null ? c.stars : c.estStars) * 100 - c.position / 1000;
    if (key === 'perPost') return c.perPost;
    var col = STAT_COLS.filter(function (s) { return s.key === key; })[0];
    var v = col ? col.get(c) : null;
    return v == null ? null : v;
  }
  var STAT_SORTS = { posts: 1, active: 1, views: 1, followers: 1, perPost: 1 };
  function sortBtn(s) {
    var active = state.sort.key === s.key;
    var arrow = active ? (state.sort.dir < 0 ? ' ▼' : ' ▲') : '';
    return '<button type="button" class="sort-btn' + (active ? ' active' : '') + '" data-sort="' + s.key + '"' +
      ' aria-pressed="' + active + '">' + s.label + arrow + '</button>';
  }

  function renderRanking() {
    var byKey = {}; SORTS.forEach(function (s) { byKey[s.key] = s; });
    var hasStats = !!state.stats;
    if (!hasStats && STAT_SORTS[state.sort.key]) state.sort = { key: 'rank', dir: -1 };
    $('rank-head').innerHTML = sortBtn(byKey.rank) + sortBtn(byKey.handle) + sortBtn(byKey.delta) +
      '<div class="sort-subs">' + (hasStats ? STAT_COLS.map(function (s) { return sortBtn(byKey[s.key]); }).join('') : '<span class="muted">Social stats</span>') + '</div>' +
      sortBtn(byKey.stars) + (hasStats ? sortBtn(byKey.perPost) : '<span></span>');
    $('mobile-sort').innerHTML = '<span>Sort</span>' + SORTS.filter(function (s) { return hasStats || !STAT_SORTS[s.key]; })
      .map(function (s) { return sortBtn(s.key === 'rank' ? { key: 'rank', label: 'Rank' } : s); }).join('');

    var list = state.board.list;
    var max = {};
    STAT_COLS.forEach(function (s) { max[s.key] = Math.max.apply(null, list.map(function (c) { return s.get(c) || 0; }).concat([0])); });
    var sorted = list.slice().sort(function (a, b) {
      var va = sortVal(a, state.sort.key), vb = sortVal(b, state.sort.key);
      if (va == null || vb == null) return (va == null) - (vb == null) || a.position - b.position;
      var d = typeof va === 'string' ? va.localeCompare(vb) : (va - vb);
      return d * state.sort.dir || a.position - b.position;
    });
    var noStats = state.statsError ? 'Social stats unavailable right now' : 'Loading social stats…';
    $('ranking').innerHTML = sorted.map(function (c) {
      var subs = STAT_COLS.map(function (s) {
        var v = s.get(c), w = v != null && max[s.key] > 0 ? v / max[s.key] * 100 : 0;
        return '<div class="sub"><div class="sub-top"><span>' + s.short + '</span>' + (v == null ? '—' : s.fmt(v, c)) + '</div>' +
          '<div class="bar"><i style="width:' + Math.max(2, w) + '%"></i></div></div>';
      }).join('');
      return '<button type="button" class="rank-row t' + tierOf(c) + (c.position <= 3 ? ' top3' : '') + '" data-key="' + esc(c.key) + '">' +
        '<span class="r-rank">' + (c.position < 10 ? '0' : '') + c.position + '</span>' +
        '<span class="r-who"><span class="r-handle">@' + esc(c.handle) + '</span><span class="r-name">' + esc(c.name) + '</span>' +
          '<span class="chips">' + chipsFor(c) + '</span></span>' +
        '<span class="r-score">' + deltaHtml(c.delta) + '<small>change</small>' + sparkline(c, 64, 18) + '</span>' +
        '<span class="r-subs">' + (hasStats ? subs : '<span class="muted r-nostats">' + noStats + '</span>') + '</span>' +
        '<span class="r-stars"><span class="pred" title="' + (c.stars != null ? 'Stars from the game' : 'Estimated from rank') + '">' + starsText(c) + '</span><br><small>' + (c.starsFrom === 'yours' ? 'your card' : c.stars != null ? 'real' : 'from rank') + '</small></span>' +
        '<span class="r-value">' + (hasStats ? '<b>' + fK(c.perPost) + '</b><small>views / post</small>' : '') + '</span>' +
      '</button>';
    }).join('') + (state.board.extra.length
      ? '<p class="muted rank-extra">Tracked but not on the official leaderboard yet: ' + state.board.extra.map(function (h) { return '@' + esc(h); }).join(', ') + '.</p>' : '');
  }

  /* ---------- how it works ---------- */
  function renderHow() {
    var cfg = state.cfg;
    var bands = cfg.starBands.map(function (b, i) { return { s: i + 1, b: b }; }).reverse().map(function (x) {
      return x.s === 1 ? '1★ the rest' : x.s + '★ top ' + +(100 - x.b).toFixed(2) + '%';
    }).join(' · ');
    $('how-body').innerHTML =
      '<div class="card-cut how-card"><h3>Official <em>leaderboard</em></h3><p>The order comes straight from Motion’s public leaderboard (<a href="https://leaderboard.motion.game" target="_blank" rel="noopener">leaderboard.motion.game</a>), which Motion refreshes every 4 hours. Arrows show the change since its last update; press Refresh to reload. The public feed has ranks only: creators’ Motion Scores are shown in the game.</p></div>' +
      '<div class="card-cut how-card"><h3>Stars <em>≈</em></h3><p>Until real stars from the game are added, each creator’s stars are estimated from their rank with Fantasy Top’s published split: ' + esc(bands) + '. Real stars in the game can differ.</p></div>' +
      '<div class="card-cut how-card"><h3>Build a <em>deck</em></h3><p>Five different creators whose stars fit under your cap. Each creator is worth their rank (#1 = 1,000, the last ≈ ' + (state.board ? fInt(1000 / state.board.N) : '13') + ') × your card’s boost:</p><ul>' +
        RARITIES.map(function (r) { return '<li>' + rarityLabel(r) + ': ' + cfg.cardBoosts[r] + '×</li>'; }).join('') + '</ul>' +
        '<p>Every combination is checked, so it’s the best draft for that cap by rank-based value. Real stars and the tournament’s boost limits still need checking in the game.</p></div>' +
      '<div class="card-cut how-card"><h3>Rank <em>history</em></h3><p>Motion Scout saves every snapshot of the official leaderboard (about every 4 hours) from ' + (state.history && state.history.snapshots.length ? esc(fTime(state.history.snapshots[0].t)) : 'now on') + '. <b>Movers</b> compares each creator with their rank at Monday’s 7 AM ET lineup lock; <b>My lineup this week</b> does the same for your five.</p></div>' +
      '<div class="card-cut how-card"><h3>Social <em>stats</em></h3><p>Where available: posts, active days, views and followers over the last ' + cfg.windowDays + ' days on X (original posts and quotes, no replies or reposts). YouTube is being added. Collected every day. They’re context for your picks: they don’t change the order.</p></div>' +
      '<div class="card-cut how-card how-wide"><h3>Game <em>rules</em></h3><p>From <a href="https://docs.motion.game" target="_blank" rel="noopener">docs.motion.game</a>: Motion scores creators on X, Instagram, TikTok and YouTube during each Monday-to-Friday tournament; the top creator gets 1,000 pts; stars (1–8) reflect each creator’s performance relative to others over the past 14 days and count toward each tournament’s star cap; Lineup Score = sum of each creator’s Motion Score × card boost; submitted lineups are ranked on the Tournament Leaderboard in Arena. Motion Scout is a community planning tool, not the game’s score.</p></div>';
  }

  /* ---------- detail modal ---------- */
  function step(title, body) { return '<li><h4>' + title + '</h4>' + body + '</li>'; }
  function openDetail(key) {
    var c = state.board && state.board.list.filter(function (x) { return x.key === key; })[0];
    if (!c) return;
    var h = '';
    h += step('Official leaderboard',
      '<p class="calc">Rank <b>#' + c.position + '</b> of ' + state.board.N + ' · ' + deltaHtml(c.delta) + ' since the last update</p>' +
      '<p class="muted">As of ' + esc(fTime(state.official.asOf)) + '.</p>');
    if (c.series && c.series.length > 1) {
      h += step('Rank history',
        '<div class="hist-chart">' + sparkline(c, 520, 90, true) + '</div>' +
        '<p class="calc">' + esc(fTime(c.series[0].t)) + ': <b>#' + c.series[0].p + '</b> → now <b>#' + c.position + '</b>' +
        (c.weekChange != null ? ' · ' + (state.board.sinceLock ? 'since Monday’s lock' : 'since ' + esc(fTime(state.board.baseT))) + ' ' + moveText(c.weekChange) : '') + '</p>');
    }
    h += step('Stars',
      c.stars != null
        ? '<p class="calc">' + (c.starsFrom === 'yours' ? 'Your card’s stars (from My cards)' : 'Real stars from the game') + ': <b>' + c.stars + '★</b></p>'
        : '<p class="calc">≈<b>' + c.estStars + '★</b>, estimated from rank</p><p class="muted">Replaced by the real stars once they’re added.</p>');
    h += step('In a deck',
      '<p class="calc">Deck value <b>' + fInt(c.points) + '</b> × your card’s boost · costs <b>' + starsText(c) + '</b> of the cap</p>');
    var rows = [c.x, c.yt].filter(Boolean).map(function (s) {
      var p = PLATFORM[s.platform] || { label: s.platform };
      return '<tr><td>' + esc(p.label) + '</td><td>@' + esc(s.handle) + '</td><td>' + fInt(s.followersNow) +
        '</td><td>' + fInt(s.posts) + '</td><td>' + s.activeDays + '/' + s.days + '</td><td>' + fInt(s.interactions) + '</td><td>' + fInt(s.views) + '</td></tr>';
    }).join('');
    h += step('Last ' + state.cfg.windowDays + ' days',
      rows
        ? '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Platform</th><th>Handle</th><th>Followers</th><th>Posts</th><th>Active days</th><th>Interactions</th><th>Views</th></tr></thead><tbody>' +
          rows + '</tbody></table></div><p class="muted">Interactions = likes + replies + reposts + quotes on X; likes + comments on YouTube.</p>'
        : '<p class="muted">' + (state.stats ? 'No stats collected for this creator yet.' : 'Creator stats temporarily unavailable.') + '</p>');
    var dlg = $('detail');
    dlg.innerHTML = '<div class="modal-head t' + tierOf(c) + '"><span class="big">#' + c.position + '</span><h2 id="detail-title">@' + esc(c.handle) + '</h2>' +
      '<span class="big" style="color:var(--text)">' + starsText(c) + '</span>' +
      '<button type="button" class="modal-x" data-close aria-label="Close">✕</button></div>' +
      '<div class="modal-body"><p class="muted" style="margin-top:0">' + esc(c.name) + '</p><div class="chips" style="margin-bottom:6px">' + chipsFor(c) + '</div>' +
      '<ol class="steps">' + h + '</ol></div>';
    dlg.showModal();
    dlg.scrollTop = 0;
  }

  /* ---------- settings (official game rules only) ---------- */
  var SETTINGS = [
    ['lineup.starCap', 'Deck star cap (8–40)'],
    ['cardBoosts.common', 'Common boost ×'], ['cardBoosts.rare', 'Rare boost ×'],
    ['cardBoosts.epic', 'Epic boost ×'], ['cardBoosts.legendary', 'Legendary boost ×']
  ];
  function getPath(o, p) { return p.split('.').reduce(function (a, k) { return a[k]; }, o); }
  function setPath(o, p, v) { var ks = p.split('.'), last = ks.pop(); ks.reduce(function (a, k) { return a[k]; }, o)[last] = v; }
  function savedSettings() {
    var o = {};
    SETTINGS.forEach(function (f) { o[f[0]] = getPath(state.cfg, f[0]); });
    return o;
  }
  function applySaved(o) {
    SETTINGS.forEach(function (f) { if (typeof o[f[0]] === 'number' && isFinite(o[f[0]])) setPath(state.cfg, f[0], o[f[0]]); });
  }
  function openSettings() {
    var dlg = $('config');
    dlg.innerHTML = '<form method="dialog" id="cfg-form" novalidate>' +
      '<div class="modal-head"><h2 id="config-title">Boosts and cap</h2><button type="button" class="modal-x" data-close aria-label="Close">✕</button></div>' +
      '<div class="modal-body"><div class="cfg-section"><h3>Game rules</h3><p class="muted">From docs.motion.game. Change them if a tournament uses different values. Saved in this browser.</p><div class="cfg-grid">' +
      SETTINGS.map(function (f) {
        return '<label>' + f[1] + '<input type="number" step="any" data-path="' + f[0] + '" value="' + getPath(state.cfg, f[0]) + '"></label>';
      }).join('') + '</div></div></div>' +
      '<div class="cfg-actions"><p class="cfg-error" id="cfg-error"></p>' +
      '<button type="button" class="btn btn-ghost" id="cfg-reset"><span>Reset defaults</span></button>' +
      '<button type="submit" class="btn btn-pink"><span>Apply</span></button></div></form>';
    dlg.showModal();
    $('cfg-form').addEventListener('submit', function (e) { e.preventDefault(); applySettings(); });
    $('cfg-reset').addEventListener('click', function () {
      state.cfg = MS.clonePublicConfig();
      lsDel(LS_SET);
      dlg.close();
      rebuild(); renderHow();
    });
  }
  function applySettings() {
    var next = JSON.parse(JSON.stringify(state.cfg)), bad = false;
    Array.prototype.forEach.call($('config').querySelectorAll('input[data-path]'), function (inp) {
      var v = parseFloat(inp.value);
      if (!isFinite(v)) bad = true; else setPath(next, inp.dataset.path, v);
    });
    var err = bad ? 'Every field needs a number.'
      : !(next.lineup.starCap >= CAP_MIN && next.lineup.starCap <= CAP_MAX && next.lineup.starCap % 1 === 0) ? 'Star cap must be a whole number from ' + CAP_MIN + ' to ' + CAP_MAX + '.'
      : RARITIES.some(function (r) { return !(next.cardBoosts[r] > 0); }) ? 'Card boosts must be above 0.' : null;
    if (err) { $('cfg-error').textContent = err; return; }
    state.cfg = next;
    lsSet(LS_SET, JSON.stringify(savedSettings()));
    $('config').close();
    rebuild(); renderHow();
  }

  /* ---------- tabs: one view at a time, chosen by the URL hash ---------- */
  // #play (How to play) · #build (Build a deck) · #leaderboard · #about. Old section links still work.
  var TABS = ['play', 'build', 'leaderboard', 'about'];
  var OLD_HASH = { howto: 'play', top: 'play', 'lineup-section': 'build', 'check-section': 'build', deck: 'build',
    'ranking-section': 'leaderboard', roadmap: 'about', how: 'about' };
  var LS_TAB = 'motionScout.tab.v1';
  function tabFromHash() {
    var h = (location.hash || '').replace(/^#/, '');
    return TABS.indexOf(h) >= 0 ? h : OLD_HASH[h] || null;
  }
  function showTab(tab, keepScroll) {
    if (TABS.indexOf(tab) < 0) tab = 'play';
    Array.prototype.forEach.call(document.querySelectorAll('[data-views]'), function (el) {
      el.hidden = el.getAttribute('data-views').split(' ').indexOf(tab) < 0;
    });
    Array.prototype.forEach.call(document.querySelectorAll('.topnav-links a[data-tab]'), function (a) {
      var on = a.getAttribute('data-tab') === tab;
      a.classList.toggle('active', on);
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    document.body.setAttribute('data-tab', tab);
    lsSet(LS_TAB, tab);
    if (!keepScroll) window.scrollTo(0, 0);
    // the deck builder's slider and lists are measured on screen: redraw when its tab opens
    if (tab === 'build' && state.board) renderLineup();
  }
  window.addEventListener('hashchange', function () {
    var tab = tabFromHash() || 'play';
    if (location.hash.replace(/^#/, '') !== tab) history.replaceState(null, '', '#' + tab); // old section links → tab name
    showTab(tab);
  });

  /* ---------- how to play: card deck ---------- */
  // Cards lie in a stack. Tapping the top card throws it to the back of the deck; Back brings
  // the last card to the front. `deckOrder` holds card indexes from top to bottom.
  var deck = $('deck'), deckCards = deck ? Array.prototype.slice.call(deck.querySelectorAll('.deck-card')) : [];
  var deckOrder = deckCards.map(function (c, i) { return i; }), deckBusy = false;
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function layoutDeck() {
    deckOrder.forEach(function (idx, p) {
      var c = deckCards[idx], shown = p < 4;
      c.style.zIndex = String(deckCards.length - p);
      c.style.transform = 'translateY(' + (shown ? p * 14 : 42) + 'px) scale(' + (shown ? 1 - p * 0.045 : 0.865) + ')';
      c.style.opacity = shown ? '1' : '0';
      c.classList.toggle('is-top', p === 0);
      c.setAttribute('aria-hidden', String(p !== 0));
    });
    if ($('deck-pos')) $('deck-pos').textContent = (deckOrder[0] + 1) + ' / ' + deckCards.length;
  }
  function deckNext() {
    if (deckBusy || !deckCards.length) return;
    var top = deckCards[deckOrder[0]];
    deckOrder.push(deckOrder.shift());
    layoutDeck(); // the next card rises right away, while the old top card flies out
    if (reduceMotion) return;
    deckBusy = true;
    top.style.zIndex = String(deckCards.length + 1);
    top.style.opacity = '1';
    top.style.transform = 'translate(118%, 30px) rotate(12deg)';
    setTimeout(function () { top.style.zIndex = '0'; layoutDeck(); deckBusy = false; }, 330);
  }
  function deckBack() {
    if (deckBusy || !deckCards.length) return;
    deckOrder.unshift(deckOrder.pop());
    var c = deckCards[deckOrder[0]];
    if (!reduceMotion) {
      c.style.transition = 'none';
      c.style.zIndex = String(deckCards.length + 1);
      c.style.opacity = '1';
      c.style.transform = 'translate(-118%, 30px) rotate(-12deg)';
      void c.offsetWidth; // apply the start position before animating in
      c.style.transition = '';
    }
    layoutDeck();
  }
  if (deck) {
    layoutDeck();
    deck.addEventListener('click', deckNext);
    deck.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowRight') { e.preventDefault(); deckNext(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); deckBack(); }
    });
  }

  /* ---------- feedback ---------- */
  function openFeedback() {
    var dlg = $('feedback');
    dlg.innerHTML = '<form id="fb-form" novalidate>' +
      '<div class="modal-head"><h2 id="feedback-title">Feedback</h2><button type="button" class="modal-x" data-close aria-label="Close">✕</button></div>' +
      '<div class="modal-body">' +
        '<p class="muted">Found a problem or have an idea? Tell me here. I read every message.</p>' +
        '<div class="fb-types" role="radiogroup" aria-label="Type">' +
          ['problem', 'idea', 'other'].map(function (t, i) {
            return '<label><input type="radio" name="fb-type" value="' + t + '"' + (i === 0 ? ' checked' : '') + '><span>' + (t === 'problem' ? 'Report a problem' : t === 'idea' ? 'Suggest an idea' : 'Something else') + '</span></label>';
          }).join('') + '</div>' +
        '<label class="fb-field"><span>Message</span><textarea id="fb-message" rows="6" maxlength="3000" placeholder="What happened, or what would make Motion Scout better?" required></textarea></label>' +
        '<label class="fb-field"><span>Your X handle or email <em>optional, only if you want a reply</em></span><input type="text" id="fb-contact" maxlength="200" autocomplete="off" placeholder="@yourhandle"></label>' +
        '<label class="fb-hp" aria-hidden="true">Website<input type="text" id="fb-website" tabindex="-1" autocomplete="off"></label>' +
        '<p class="fb-status" id="fb-status" aria-live="polite"></p>' +
      '</div>' +
      '<div class="cfg-actions"><button type="button" class="btn btn-ghost" data-close><span>Cancel</span></button>' +
      '<button type="submit" class="btn btn-pink" id="fb-send"><span>Send</span></button></div></form>';
    dlg.showModal();
    $('fb-message').focus();
    $('fb-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var msg = $('fb-message').value.trim(), st = $('fb-status');
      if (msg.length < 5) { st.className = 'fb-status err-text'; st.textContent = 'Please write a few words.'; $('fb-message').focus(); return; }
      var checked = dlg.querySelector('input[name="fb-type"]:checked');
      $('fb-send').disabled = true;
      st.className = 'fb-status'; st.textContent = 'Sending…';
      withTimeout(API.feedback(state.cfg, {
        type: checked ? checked.value : 'other', message: msg, contact: $('fb-contact').value.trim(),
        page: document.body.getAttribute('data-tab') || '', website: $('fb-website').value
      }), 20000).then(function () {
        dlg.querySelector('.modal-body').innerHTML = '<p class="fb-done">Thanks! Your message was sent.</p>';
        dlg.querySelector('.cfg-actions').innerHTML = '<button type="button" class="btn btn-pink" data-close><span>Close</span></button>';
      }).catch(function (err) {
        $('fb-send').disabled = false;
        st.className = 'fb-status err-text';
        st.textContent = 'Couldn’t send: ' + err.message + '. Please try again in a minute.';
      });
    });
  }

  /* ---------- events ---------- */
  document.addEventListener('click', function (e) {
    var t = e.target;
    var closer = t.closest('[data-close]');
    if (closer) { closer.closest('dialog').close(); return; }
    if (t.tagName === 'DIALOG') { t.close(); return; } // click on backdrop
    var dk = t.closest('[data-deck]');
    if (dk) { if (dk.dataset.deck === '1') deckNext(); else deckBack(); return; }
    var sb = t.closest('[data-sort]');
    if (sb) {
      var key = sb.dataset.sort;
      if (state.sort.key === key) state.sort.dir *= -1;
      else state.sort = { key: key, dir: key === 'handle' ? 1 : -1 };
      var where = sb.closest('#mobile-sort') ? '#mobile-sort' : '#rank-head';
      renderRanking();
      var again = document.querySelector(where + ' [data-sort="' + key + '"]');
      if (again) again.focus();
      return;
    }
    if (t.closest('#btn-cards')) { openCards(); return; }
    if (t.closest('#btn-config')) { openSettings(); return; }
    if (t.closest('#btn-refresh')) { refreshAll(); return; }
    if (t.closest('[data-feedback]')) { openFeedback(); return; }
    if (t.closest('#ml-use')) { if (state.lastPicks.length) { state.lineup = state.lastPicks.slice(0, 5); saveLineup(); } return; }
    if (t.closest('#ml-edit')) { openLineupPicker(); return; }
    if (t.closest('#ml-clear')) { state.lineup = []; saveLineup(); return; }
    if (t.closest('#cards-search-clear')) {
      var f = $('cards-filter'); f.value = ''; f.dispatchEvent(new Event('input', { bubbles: true })); f.focus();
      return;
    }
    if (t.closest('#cards-clear')) {
      myCards = {};
      Array.prototype.forEach.call($('cards').querySelectorAll('select[data-card], select[data-stars]'), function (s) { s.value = ''; });
      saveCards();
      return;
    }
    var card = t.closest('[data-key]');
    if (card && !t.closest('dialog')) openDetail(card.dataset.key);
  });
  $('lineup').addEventListener('input', function (e) { if (e.target.id === 'cap-range') setStarCap(e.target.value); });
  $('lineup').addEventListener('change', function (e) {
    if (e.target.id === 'cap-num') setStarCap(e.target.value);
    if (e.target.id === 'only-mine') { state.onlyMine = e.target.checked; lsSet('motionScout.onlyMine.v1', state.onlyMine ? '1' : '0'); renderLineup(); }
  });
  $('cards').addEventListener('change', function (e) {
    var d = e.target.dataset || {}, key = d.card || d.stars;
    if (!key) return;
    var m = myCards[key] || { r: '', s: null };
    if (d.card) m.r = e.target.value; else m.s = e.target.value ? Number(e.target.value) : null;
    if (m.r || m.s) myCards[key] = m; else delete myCards[key];
    saveCards();
  });
  $('lineup-dlg').addEventListener('change', function (e) {
    var key = e.target.dataset && e.target.dataset.ml;
    if (!key) return;
    var i = state.lineup.indexOf(key);
    if (e.target.checked && i < 0 && state.lineup.length < 5) state.lineup.push(key);
    if (!e.target.checked && i >= 0) state.lineup.splice(i, 1);
    syncPickerLimit();
    saveLineup();
  });
  $('lineup-dlg').addEventListener('input', function (e) {
    if (e.target.id !== 'ml-filter') return;
    var q = e.target.value.trim().toLowerCase().replace(/^@/, '');
    Array.prototype.forEach.call($('lineup-dlg').querySelectorAll('.cards-row'), function (row) { row.hidden = q && row.dataset.name.indexOf(q) < 0; });
  });
  $('cards').addEventListener('input', function (e) {
    if (e.target.id !== 'cards-filter') return;
    var q = e.target.value.trim().toLowerCase().replace(/^@/, '');
    var shown = 0;
    Array.prototype.forEach.call($('cards').querySelectorAll('.cards-row'), function (row) {
      row.hidden = q && row.dataset.name.indexOf(q) < 0;
      if (!row.hidden) shown++;
    });
    $('cards-empty').hidden = shown > 0;
  });

  /* ---------- boot ---------- */
  try { applySaved(JSON.parse(lsGet(LS_SET) || '{}') || {}); } catch (e) { /* ignore bad settings */ }
  state.onlyMine = lsGet('motionScout.onlyMine.v1') !== '0';
  state.cfg.lineup.starCap = Math.round(Math.min(CAP_MAX, Math.max(CAP_MIN, state.cfg.lineup.starCap)));
  ['motionScout.data.v1', 'motionScout.source.v1', 'motionScout.self.v1'].forEach(lsDel); // left over from older versions
  renderHow();
  renderAll();
  (function () {
    var tab = tabFromHash() || lsGet(LS_TAB) || 'play';
    if (TABS.indexOf(tab) < 0) tab = 'play';
    if (location.hash.replace(/^#/, '') !== tab) history.replaceState(null, '', '#' + tab);
    showTab(tab);
  })();
  loadOfficial();
  if (state.cfg.apiUrl) { loadStats(); loadHistory(); } else { state.statsError = 'no server URL'; state.historyError = 'no server URL'; }
})();
