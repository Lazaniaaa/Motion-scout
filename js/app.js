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
          return { key: key, id: r.id || null, name: r.name, handle: c && c.x ? c.x : null, position: r.position, delta: r.delta || 0 };
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
        avatar: r.id ? 'https://leaderboard.motion.game/pfp/' + encodeURIComponent(r.id) + '.jpg' : null,
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
          '<span class="lp-top">' + avatarHtml(p.c, 34) + '<span class="lp-rank">#' + p.c.position + '</span></span>' +
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
        '<span class="mv-who">' + avatarHtml(c, 28) + '<span>@' + esc(c.handle) + '<small>#' + c.basePos + ' → #' + c.position + '</small></span></span>' + sparkline(c, 70, 20) + '</button>';
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
      return '<tr data-key="' + esc(c.key) + '"><td class="ml-who">' + avatarHtml(c, 26) + '@' + esc(c.handle) + '</td><td>' + starsText(c) + '</td><td>' + (c.basePos ? '#' + c.basePos : '—') + '</td><td><b>#' + c.position + '</b></td><td>' +
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

  /* ---------- avatars and big charts ---------- */
  // Profile pictures come from Motion's public leaderboard; initials show if one doesn't load.
  function avatarHtml(c, size) {
    var initials = String(c.name || c.handle || '?').split(/\s+/).map(function (w) { return w.charAt(0); }).join('').slice(0, 2).toUpperCase();
    return '<span class="ava" style="width:' + size + 'px;height:' + size + 'px;font-size:' + Math.round(size * 0.38) + 'px" aria-hidden="true"><i>' + esc(initials) + '</i>' +
      (c.avatar ? '<img src="' + esc(c.avatar) + '" alt="" loading="lazy" decoding="async" onerror="this.remove()">' : '') + '</span>';
  }
  function shortTime(iso) {
    var t = Date.parse(iso);
    return isFinite(t) ? new Date(t).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
  }
  // Rank over every logged snapshot, #1 at the top, with axes, points and Monday's lock.
  function rankChart(c) {
    var pts = c.series || [];
    if (pts.length < 2) return '<p class="muted">The trend appears after the next leaderboard update (Motion updates about every 4 hours).</p>';
    var W = 900, H = 240, L = 46, R = 16, T = 16, B = 34;
    var t0 = Date.parse(pts[0].t), t1 = Date.parse(pts[pts.length - 1].t), span = Math.max(1, t1 - t0);
    var ps = pts.map(function (x) { return x.p; }), best = Math.min.apply(null, ps), worst = Math.max.apply(null, ps);
    var lo = Math.max(1, best - 2), hi = worst + 2;
    var X = function (t) { return L + (Date.parse(t) - t0) / span * (W - L - R); };
    var Y = function (p) { return T + (p - lo) / (hi - lo) * (H - T - B); };
    var ticks = [lo, Math.round((lo + hi) / 2), hi];
    var grid = ticks.map(function (p) {
      return '<line class="ch-grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(p).toFixed(1) + '" y2="' + Y(p).toFixed(1) + '"/>' +
        '<text class="ch-ax" x="' + (L - 8) + '" y="' + (Y(p) + 4).toFixed(1) + '" text-anchor="end">#' + p + '</text>';
    }).join('');
    var xl = [pts[0], pts[Math.floor(pts.length / 2)], pts[pts.length - 1]].filter(function (x, i, a) { return a.indexOf(x) === i; }).map(function (x, i, a) {
      return '<text class="ch-ax" x="' + X(x.t).toFixed(1) + '" y="' + (H - 10) + '" text-anchor="' + (i === 0 ? 'start' : i === a.length - 1 ? 'end' : 'middle') + '">' + esc(shortTime(x.t)) + '</text>';
    }).join('');
    var lock = state.board && state.board.lock ? state.board.lock.getTime() : null, lockLine = '';
    if (lock && lock > t0 && lock < t1) {
      var lx = X(new Date(lock).toISOString()).toFixed(1);
      lockLine = '<line class="ch-lock" x1="' + lx + '" x2="' + lx + '" y1="' + T + '" y2="' + (H - B) + '"/><text class="ch-ax ch-lock-t" x="' + lx + '" y="' + (T + 10) + '" text-anchor="middle">lock</text>';
    }
    var line = pts.map(function (x, i) { return (i ? 'L' : 'M') + X(x.t).toFixed(1) + ' ' + Y(x.p).toFixed(1); }).join(' ');
    var area = line + ' L' + X(pts[pts.length - 1].t).toFixed(1) + ' ' + (H - B) + ' L' + X(pts[0].t).toFixed(1) + ' ' + (H - B) + ' Z';
    var dots = pts.map(function (x) { return '<circle class="ch-dot" cx="' + X(x.t).toFixed(1) + '" cy="' + Y(x.p).toFixed(1) + '" r="3.5"><title>' + esc(shortTime(x.t)) + ': #' + x.p + '</title></circle>'; }).join('');
    var up = c.weekChange != null ? c.weekChange : pts[0].p - pts[pts.length - 1].p;
    return '<svg class="rank-chart' + (up > 0 ? ' up' : up < 0 ? ' down' : '') + '" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Rank of @' + esc(c.handle) + ' over time, from #' + pts[0].p + ' to #' + pts[pts.length - 1].p + '">' +
      grid + lockLine + '<path class="ch-area" d="' + area + '"/><path class="ch-line" d="' + line + '"/>' + dots + xl + '</svg>';
  }
  // Views per day as bars, the number of posts above each bar.
  function dailyChart(s) {
    var days = (s && s.daily) || [];
    if (days.length < 2) return '';
    var W = 900, H = 200, L = 8, R = 8, T = 22, B = 30, n = days.length;
    var max = Math.max.apply(null, days.map(function (d) { return d[2] || 0; }).concat([1]));
    var bw = (W - L - R) / n;
    var bars = days.map(function (d, i) {
      var h = (d[2] || 0) / max * (H - T - B), x = L + i * bw + bw * 0.15, y = H - B - h;
      var label = i === 0 || i === n - 1 || i % 2 === 0 ? '<text class="ch-ax" x="' + (x + bw * 0.35).toFixed(1) + '" y="' + (H - 10) + '" text-anchor="middle">' + esc(d[0].slice(5).replace('-', '/')) + '</text>' : '';
      return '<rect class="ch-bar' + (d[1] ? '' : ' empty') + '" x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + (bw * 0.7).toFixed(1) + '" height="' + Math.max(1, h).toFixed(1) + '" rx="3"><title>' + esc(d[0]) + ': ' + d[1] + ' posts, ' + fInt(d[2]) + ' views</title></rect>' +
        (d[1] ? '<text class="ch-cnt" x="' + (x + bw * 0.35).toFixed(1) + '" y="' + (y - 6).toFixed(1) + '" text-anchor="middle">' + d[1] + '</text>' : '') + label;
    }).join('');
    return '<svg class="daily-chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Views per day over the last ' + n + ' days">' + bars + '</svg>' +
      '<p class="muted ch-note">Bars: views per day. Numbers: posts that day.</p>';
  }
  function tile(label, value, sub, cls) {
    return '<div class="dt' + (cls ? ' ' + cls : '') + '"><small>' + label + '</small><b>' + value + '</b>' + (sub ? '<span>' + sub + '</span>' : '') + '</div>';
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
        '<span class="r-who">' + avatarHtml(c, 38) + '<span class="r-whotext"><span class="r-handle">@' + esc(c.handle) + '</span><span class="r-name">' + esc(c.name) + '</span>' +
          '<span class="chips">' + chipsFor(c) + '</span></span></span>' +
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
  function openDetail(key) {
    var c = state.board && state.board.list.filter(function (x) { return x.key === key; })[0];
    if (!c) return;
    var b = state.board, x = c.x, yt = c.yt;
    var since = b.sinceLock ? 'Since Monday’s lock' : 'Since tracking started';
    var head = '<div class="dh">' + avatarHtml(c, 72) +
      '<div class="dh-who"><h2 id="detail-title">' + esc(c.name) + '</h2>' +
        '<a class="dh-handle" href="https://x.com/' + encodeURIComponent(c.handle) + '" target="_blank" rel="noopener">@' + esc(c.handle) + '</a>' +
        '<div class="chips">' + chipsFor(c) + (c.starsFrom === 'yours' ? '<span class="chip">your card</span>' : '') + '</div></div>' +
      '<div class="dh-rank"><b>#' + c.position + '</b><small>of ' + b.N + '</small></div>' +
      '<button type="button" class="modal-x" data-close aria-label="Close">✕</button></div>';
    var tiles = '<div class="dtiles">' +
      tile('Official rank', '#' + c.position, 'as of ' + esc(shortTime(state.official.asOf))) +
      tile('Last update', moveText(c.delta), 'change in rank') +
      tile(since, c.weekChange != null ? moveText(c.weekChange) : '—', c.basePos ? '#' + c.basePos + ' → #' + c.position : 'no history yet') +
      tile('Stars', starsText(c), c.starsFrom === 'yours' ? 'from your card' : c.stars != null ? 'from the game' : 'estimated from rank', 'hot') +
      tile('Deck value', fInt(c.points), '× your card’s boost') +
    '</div>';
    var body = '<section class="dsec"><h3>Rank history</h3>' + rankChart(c) + '</section>';
    if (x) {
      var eng = x.views > 0 ? (x.interactions / x.views * 100) : null;
      body += '<section class="dsec"><h3>X · last ' + x.days + ' days <span class="muted">' + esc(x.dateFrom || '') + ' → ' + esc(x.dateTo || '') + '</span></h3><div class="dtiles">' +
        tile('Followers', fK(x.followersNow)) +
        tile('Posts', fInt(x.posts), x.activeDays + ' of ' + x.days + ' days active') +
        tile('Views', fK(x.views), fK(x.posts ? x.views / x.posts : null) + ' per post') +
        tile('Interactions', fK(x.interactions), fK(x.posts ? x.interactions / x.posts : null) + ' per post') +
        tile('Engagement', eng == null ? '—' : eng.toFixed(eng < 1 ? 2 : 1) + '%', 'interactions ÷ views') +
      '</div>' + dailyChart(x) +
      '<p class="muted ch-note">Original posts and quotes only, as Motion counts them. Interactions = likes + replies + reposts + quotes.</p></section>';
    } else {
      body += '<section class="dsec"><h3>X</h3><p class="muted">' + (state.stats ? 'No stats collected for this creator yet.' : 'Creator stats temporarily unavailable.') + '</p></section>';
    }
    if (yt) {
      body += '<section class="dsec"><h3>YouTube · last ' + yt.days + ' days</h3><div class="dtiles">' +
        tile('Subscribers', fK(yt.followersNow)) + tile('Videos', fInt(yt.posts)) + tile('Views', fK(yt.views)) + tile('Likes + comments', fK(yt.interactions)) +
      '</div>' + dailyChart(yt) + '</section>';
    }
    var dlg = $('detail');
    dlg.className = 'modal modal-detail t' + tierOf(c);
    dlg.innerHTML = head + '<div class="modal-body">' + tiles + body + '</div>';
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
  var TABS = ['play', 'build', 'leaderboard', 'memes', 'about'];
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
    if (tab === 'memes') { loadMemes(); lsSet(LS_MEMES_SEEN, '1'); document.body.classList.add('memes-seen'); }
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

  /* ---------- memes wall ---------- */
  // Approved memes come from the server (every one is reviewed first). Each is shown with X's
  // official embed, so the author keeps the views and a deleted post disappears here too.
  // Likes are anonymous: one per browser per meme. Meme of the week = most liked since Monday's lock.
  var LS_VOTER = 'motionScout.voter.v1', LS_LIKED = 'motionScout.liked.v1', LS_MSORT = 'motionScout.memeSort.v1';
  var MEMES_PAGE = 12, LS_MEMES_SEEN = 'motionScout.memesSeen.v1';
  if (lsGet(LS_MEMES_SEEN)) document.body.classList.add('memes-seen'); // the menu dot is only for people who haven't opened Memes yet
  var memes = { list: null, error: null, loading: false, sort: lsGet(LS_MSORT) === 'top' ? 'top' : 'new', shown: MEMES_PAGE, liked: {}, likeBusy: {}, motwId: null, winners: [], nextReveal: null };
  try { memes.liked = JSON.parse(lsGet(LS_LIKED) || '{}') || {}; } catch (e) { memes.liked = {}; }
  var CREATOR_BY_X = {};
  (MS.CREATORS || []).forEach(function (c) { if (c.x) CREATOR_BY_X[c.x.toLowerCase()] = c; });

  function voterId() {
    var v = lsGet(LS_VOTER);
    if (v && /^[a-z0-9]{8,40}$/.test(v)) return v;
    var a = new Uint8Array(16);
    if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(a);
    else for (var i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256);
    v = Array.prototype.map.call(a, function (b) { return (b % 36).toString(36); }).join('');
    lsSet(LS_VOTER, v);
    return v;
  }
  var widgetsReady = null;
  function loadWidgets() {
    if (widgetsReady) return widgetsReady;
    widgetsReady = new Promise(function (resolve, reject) {
      if (window.twttr && window.twttr.widgets) { resolve(window.twttr); return; }
      var s = document.createElement('script');
      s.src = 'https://platform.twitter.com/widgets.js'; s.async = true; s.charset = 'utf-8';
      s.onload = function () { if (window.twttr && window.twttr.ready) window.twttr.ready(resolve); else reject(new Error('no widgets')); };
      s.onerror = function () { reject(new Error('blocked')); };
      document.head.appendChild(s);
    });
    return widgetsReady;
  }
  // Swap the text fallback for X's embed; hide the card if the post is gone.
  function embedMeme(el, m) {
    loadWidgets().then(function (tw) {
      return tw.widgets.createTweet(m.id, el.querySelector('.meme-embed'), { theme: 'dark', dnt: true, conversation: 'none', align: 'center' });
    }).then(function (node) {
      el.classList.add(node ? 'is-embedded' : 'is-gone');
      var wait = el.querySelector('.meme-fallback .muted'); if (wait && !node) wait.textContent = 'This post isn’t available on X anymore.';
    }).catch(function () { /* embeds blocked in this browser: the text version stays */ });
  }
  function memeAgo(iso) {
    var t = Date.parse(iso), s = (Date.now() - t) / 1000;
    if (!isFinite(t)) return '';
    if (s < 3600) return Math.max(1, Math.round(s / 60)) + 'm ago';
    if (s < 86400) return Math.round(s / 3600) + 'h ago';
    if (s < 7 * 86400) return Math.round(s / 86400) + 'd ago';
    return new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  }
  function likeBtnHtml(m) {
    var on = !!memes.liked[m.id];
    return '<button type="button" class="meme-like' + (on ? ' is-liked' : '') + '" data-like="' + esc(m.id) + '" aria-pressed="' + on + '" aria-label="Like this meme">' +
      '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 21s-7.5-4.6-9.6-9.3C.9 8.2 3 4.5 6.6 4.5c2.1 0 3.6 1.2 4.4 2.6.8-1.4 2.3-2.6 4.4-2.6 3.6 0 5.7 3.7 4.2 7.2C19.5 16.4 12 21 12 21z"/></svg>' +
      '<b>' + m.likes + '</b></button>';
  }
  function memeCreatorHtml(m) {
    var info = m.creator && CREATOR_BY_X[m.creator];
    if (!info) return '';
    var c = state.board && state.board.list.filter(function (x) { return x.key === m.creator; })[0];
    var who = c || { name: info.name, handle: info.x };
    return '<button type="button" class="meme-creator" data-key="' + esc(m.creator) + '" title="About ' + esc(who.name) + '">' +
      avatarHtml(who, 22) + '<span>' + esc(who.name) + '</span></button>';
  }
  function memeUrl(m) { return 'https://x.com/' + encodeURIComponent(m.author) + '/status/' + m.id; }
  function memeById(id) { return memes.list && memes.list.filter(function (x) { return x.id === id; })[0]; }
  function isWinner(id) { return (memes.winners || []).some(function (w) { return w.id === id; }); }
  // A tile: the meme's picture (or video/GIF frame) at its own shape, author, likes, creator.
  // Opening it shows the full post from X. Without a stored picture the X embed is shown, cut short.
  function memeHtml(m, big) {
    var ratio = m.mediaRatio ? Math.min(1.25, Math.max(0.5, m.mediaRatio)) : 0.75;
    var media = m.media
      ? '<button type="button" class="meme-media" data-open-meme="' + esc(m.id) + '" style="aspect-ratio:' + (1 / ratio).toFixed(3) + '" aria-label="Open the meme by @' + esc(m.author) + '">' +
          '<img src="' + esc(m.media) + '" alt="Meme by @' + esc(m.author) + '" loading="lazy" decoding="async" referrerpolicy="no-referrer">' +
          (m.mediaType === 'video' ? '<span class="meme-play" aria-hidden="true">▶</span>' : m.mediaType === 'gif' ? '<span class="meme-gif" aria-hidden="true">GIF</span>' : '') +
          (isWinner(m.id) && !big ? '<span class="meme-trophy">🏆 Meme of the week</span>' : '') +
        '</button>'
      : '<div class="meme-cut"><div class="meme-embed"></div>' +
          '<div class="meme-fallback">' + (m.text ? '<p class="meme-text">' + esc(m.text) + '</p>' : '') + '</div>' +
          '<button type="button" class="meme-open" data-open-meme="' + esc(m.id) + '"><span>Open the post</span></button></div>';
    var pic = m.authorPic ? '<img class="meme-pfp" src="' + esc(m.authorPic) + '" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">' : '';
    return '<article class="meme card-cut' + (big ? ' meme-big' : '') + (m.media ? '' : ' meme-noimg') + '" data-meme="' + esc(m.id) + '">' + media +
      '<div class="meme-meta"><a class="meme-author" href="' + esc(memeUrl(m)) + '" target="_blank" rel="noopener" title="See the post on X">' + pic +
        '<b>' + esc(m.authorName || m.author) + '</b><span class="muted">@' + esc(m.author) + '</span></a>' +
        (m.text && m.media ? '<p class="meme-caption">' + esc(m.text) + '</p>' : '') + '</div>' +
      '<div class="meme-foot">' + likeBtnHtml(m) + memeCreatorHtml(m) + '<span class="meme-time muted">' + esc(memeAgo(m.time)) + '</span></div>' +
      '</article>';
  }
  function fDay(t) { return new Date(t).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }); }
  function fReveal(iso) {
    var t = Date.parse(iso);
    return fDay(t) + ' at ' + new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  }
  function untilText(iso) {
    var s = Math.max(0, (Date.parse(iso) - Date.now()) / 1000), d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), mi = Math.floor(s % 3600 / 60);
    return d ? d + 'd ' + h + 'h' : h ? h + 'h ' + mi + 'm' : mi + 'm';
  }
  // Meme of the week: revealed by the server every Sunday (likes before the reveal only).
  function renderMotw() {
    var box = $('motw');
    if (!memes.list) { box.innerHTML = '<div class="motw-head"><span class="motw-tag">Meme of the week</span></div><p class="motw-empty">Loading…</p>'; memes.motwId = null; return; }
    var w = (memes.winners || []).filter(function (x) { return memeById(x.id); })[0] || null;
    var next = memes.nextReveal ? '<p class="motw-next">Next winner: <b>' + esc(fReveal(memes.nextReveal)) + '</b> <span class="muted">(in ' + esc(untilText(memes.nextReveal)) + ')</span></p>' : '';
    if (!w) {
      memes.motwId = '';
      box.innerHTML = '<div class="motw-head"><span class="motw-tag">Meme of the week</span></div>' +
        '<p class="motw-empty">' + (memes.nextReveal
          ? 'The first winner is revealed on <b>' + esc(fReveal(memes.nextReveal)) + '</b> (your time), in ' + esc(untilText(memes.nextReveal)) + '. Every meme sent in this week can win: like your favorites below.'
          : 'No winner yet. Like your favorites below.') + '</p>';
      return;
    }
    if (memes.motwId === w.id && box.querySelector('.meme')) { // same winner: just refresh the counter and likes
      var n = box.querySelector('.motw-next'); if (n) n.outerHTML = next;
      return;
    }
    memes.motwId = w.id;
    var m = memeById(w.id), end = Date.parse(w.weekEnd);
    box.innerHTML = '<div class="motw-head"><span class="motw-tag">🏆 Meme of the week</span>' +
      '<span class="motw-sub muted">' + esc('Week ending ' + fDay(end)) + ' · ' + w.likes + (w.likes === 1 ? ' like' : ' likes') + '</span></div>' +
      memeHtml(m, true) + next;
    var el = box.querySelector('.meme');
    if (!m.media) embedMeme(el, m);
  }
  function sortedMemes() {
    var t = function (m) { return Date.parse(m.time) || 0; };
    return memes.list.slice().sort(memes.sort === 'top'
      ? function (a, b) { return b.likes - a.likes || t(b) - t(a); }
      : function (a, b) { return t(b) - t(a); });
  }
  function renderMemes(from) {
    Array.prototype.forEach.call(document.querySelectorAll('[data-msort]'), function (b) {
      var on = b.dataset.msort === memes.sort;
      b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on));
    });
    var wall = $('memes-wall');
    renderMotw();
    if (!memes.list) {
      wall.innerHTML = memes.error
        ? '<div class="empty">Couldn’t load memes right now. <button type="button" class="link-btn" id="memes-retry">Try again</button></div>'
        : '<div class="empty">Loading memes…</div>';
      $('memes-more').hidden = true;
      return;
    }
    var list = sortedMemes();
    $('memes-count').textContent = list.length ? list.length + (list.length === 1 ? ' meme' : ' memes') : '';
    $('memes-more').hidden = list.length <= memes.shown;
    if (!list.length) {
      wall.innerHTML = '<div class="empty">No memes on the wall yet. Be the first: post yours on X and submit it above.</div>';
      return;
    }
    from = from || 0;
    var part = list.slice(from, memes.shown);
    if (!from) wall.innerHTML = '';
    wall.insertAdjacentHTML('beforeend', part.map(function (m) { return memeHtml(m); }).join(''));
    var cards = wall.querySelectorAll('.meme');
    part.forEach(function (m, i) { if (!m.media) embedMeme(cards[from + i], m); });
  }
  function loadMemes(force) {
    if (memes.loading || (memes.list && !force)) return;
    memes.loading = true;
    if (!memes.list) renderMemes();
    withTimeout(API.memes(state.cfg), 20000).then(function (r) {
      memes.list = (r.memes || []).filter(function (m) { return /^\d{5,25}$/.test(m.id) && /^\w{1,15}$/.test(m.author); });
      memes.list.forEach(function (m) {
        if (!/^https:\/\/pbs\.twimg\.com\//.test(m.media || '')) m.media = '';
        if (!/^https:\/\/pbs\.twimg\.com\//.test(m.authorPic || '')) m.authorPic = '';
      });
      memes.winners = r.winners || [];
      memes.nextReveal = r.nextReveal || null;
      memes.error = null;
    }).catch(function (e) {
      if (/unknown mode/.test(e.message)) memes.list = []; // server not updated yet: just an empty wall
      else memes.error = e.message;
    }).then(function () { memes.loading = false; memes.shown = MEMES_PAGE; memes.motwId = null; renderMemes(); });
  }
  function setLikeButtons(m) {
    Array.prototype.forEach.call(document.querySelectorAll('[data-like="' + m.id + '"]'), function (b) {
      var on = !!memes.liked[m.id];
      b.classList.toggle('is-liked', on); b.setAttribute('aria-pressed', String(on));
      b.setAttribute('aria-label', on ? 'Take your like back' : 'Like this meme');
      b.querySelector('b').textContent = String(m.likes);
    });
  }
  // Tap to like, tap again to take it back.
  function likeMeme(id) {
    var m = memeById(id);
    if (!m || memes.likeBusy[id]) return;
    var undo = !!memes.liked[id];
    var apply = function (liked) {
      if (liked) memes.liked[id] = 1; else delete memes.liked[id];
      lsSet(LS_LIKED, JSON.stringify(memes.liked));
    };
    apply(!undo); m.likes = Math.max(0, m.likes + (undo ? -1 : 1)); setLikeButtons(m);
    memes.likeBusy[id] = true;
    withTimeout(API.likeMeme(state.cfg, id, voterId(), undo), 20000).then(function (r) {
      if (r && r.likes != null) { m.likes = r.likes; setLikeButtons(m); }
    }).catch(function (e) {
      apply(undo); m.likes = Math.max(0, m.likes + (undo ? 1 : -1)); setLikeButtons(m);
      Array.prototype.forEach.call(document.querySelectorAll('[data-like="' + id + '"]'), function (b) { b.title = 'Couldn’t save that: ' + e.message; });
    }).then(function () { delete memes.likeBusy[id]; });
  }
  // The full post from X in a window, with likes and a link out.
  function openMeme(id) {
    var m = memeById(id);
    if (!m) return;
    var dlg = $('meme-dlg');
    dlg.innerHTML = '<div class="modal-head"><h2 id="meme-dlg-title">Meme by @' + esc(m.author) + '</h2><button type="button" class="modal-x" data-close aria-label="Close">✕</button></div>' +
      '<div class="modal-body"><article class="meme meme-full" data-meme="' + esc(m.id) + '"><div class="meme-embed"></div>' +
        '<div class="meme-fallback">' + (m.media ? '<img class="meme-full-img" src="' + esc(m.media) + '" alt="Meme by @' + esc(m.author) + '" referrerpolicy="no-referrer">' : '') +
          (m.text ? '<p class="meme-text">' + esc(m.text) + '</p>' : '') + '<p class="muted">Loading the post from X…</p></div>' +
        '<div class="meme-foot">' + likeBtnHtml(m) + memeCreatorHtml(m) + '<a class="meme-x" href="' + esc(memeUrl(m)) + '" target="_blank" rel="noopener">Open on X →</a></div>' +
      '</article></div>';
    dlg.showModal();
    embedMeme(dlg.querySelector('.meme'), m);
  }
  (function initMemeForm() {
    var sel = $('meme-creator');
    (MS.CREATORS || []).slice().sort(function (a, b) { return a.name.localeCompare(b.name); }).forEach(function (c) {
      if (!c.x) return;
      var o = document.createElement('option');
      o.value = c.x.toLowerCase(); o.textContent = c.name + ' (@' + c.x + ')';
      sel.appendChild(o);
    });
    $('meme-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var url = $('meme-url').value.trim(), st = $('meme-status');
      if (!/^(https?:\/\/)?(www\.|mobile\.)?(x|twitter)\.com\/\w{1,15}\/status(es)?\/\d{5,25}/i.test(url)) {
        st.className = 'fb-status err-text'; st.textContent = 'Paste a link to your post on X, like https://x.com/you/status/123…';
        $('meme-url').focus();
        return;
      }
      $('meme-send').disabled = true;
      st.className = 'fb-status'; st.textContent = 'Checking your post…';
      withTimeout(API.submitMeme(state.cfg, { url: url, creator: sel.value, website: $('meme-website').value }), 30000).then(function (r) {
        st.className = 'fb-status ok-text';
        st.textContent = r.duplicate
          ? (r.status === 'live' ? 'That meme is already on the wall.' : 'Already submitted: it’s waiting for review.')
          : 'Thanks! Your meme is in review and shows up here once it’s approved.';
        if (!r.duplicate) { $('meme-url').value = ''; sel.value = ''; }
      }).catch(function (err) {
        st.className = 'fb-status err-text';
        st.textContent = /unknown mode/.test(err.message) ? 'Submissions open very soon. Please try again later.' : err.message;
      }).then(function () { $('meme-send').disabled = false; });
    });
  })();

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
        '<label class="fb-field"><span>Your email <em>· optional, only if you’d like a reply</em></span><input type="email" id="fb-contact" maxlength="200" autocomplete="email" inputmode="email" placeholder="you@example.com"></label>' +
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
      var contact = $('fb-contact').value.trim();
      if (contact && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(contact)) {
        st.className = 'fb-status err-text'; st.textContent = 'That email doesn’t look right. Leave it empty if you don’t need a reply.'; $('fb-contact').focus(); return;
      }
      var checked = dlg.querySelector('input[name="fb-type"]:checked');
      $('fb-send').disabled = true;
      st.className = 'fb-status'; st.textContent = 'Sending…';
      withTimeout(API.feedback(state.cfg, {
        type: checked ? checked.value : 'other', message: msg, contact: contact,
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
    var lk = t.closest('[data-like]');
    if (lk) { likeMeme(lk.dataset.like); return; }
    var ms = t.closest('[data-msort]');
    if (ms) {
      if (memes.sort !== ms.dataset.msort) { memes.sort = ms.dataset.msort; lsSet(LS_MSORT, memes.sort); memes.shown = MEMES_PAGE; renderMemes(); }
      return;
    }
    var om = t.closest('[data-open-meme]');
    if (om) { openMeme(om.dataset.openMeme); return; }
    if (t.closest('#memes-more')) { var from = memes.shown; memes.shown += MEMES_PAGE; renderMemes(from); return; }
    if (t.closest('#memes-retry')) { memes.error = null; loadMemes(true); return; }
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
    if (card && t.closest('#meme-dlg')) { $('meme-dlg').close(); openDetail(card.dataset.key); return; }
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
