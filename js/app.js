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
  // Everything from the servers is checked before it's used: numbers are numbers, dates are dates.
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function cleanStats(res) {
    if (!res || typeof res !== 'object' || !res.meta || !Array.isArray(res.creators)) throw new Error('unexpected answer from the server');
    res.creators = res.creators.filter(function (c) { return c && typeof c.key === 'string'; });
    res.creators.forEach(function (c) {
      c.stars = c.stars != null && isFinite(Number(c.stars)) ? Number(c.stars) : null;
      c.stats = (Array.isArray(c.stats) ? c.stats : []).filter(function (x) { return x && typeof x === 'object'; });
      c.stats.forEach(function (x) {
        ['posts', 'activeDays', 'days', 'views', 'interactions', 'followersNow'].forEach(function (k) { if (x[k] != null) x[k] = num(x[k]); });
        x.daily = (Array.isArray(x.daily) ? x.daily : []).filter(function (d) { return Array.isArray(d) && /^\d{4}-\d{2}-\d{2}$/.test(d[0]); })
          .map(function (d) { return [d[0], Math.max(0, Math.round(num(d[1]))), Math.max(0, num(d[2]))]; })
          .sort(function (a, b) { return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0; });
      });
    });
    return res;
  }
  function cleanHistory(h) {
    if (!h || !Array.isArray(h.names) || !Array.isArray(h.snapshots)) throw new Error('unexpected answer from the server');
    h.names = h.names.map(String);
    h.snapshots = h.snapshots.filter(function (x) { return x && isFinite(Date.parse(x.t)) && Array.isArray(x.p); }).map(function (x) {
      return { t: x.t, p: h.names.map(function (n, i) { var v = Math.round(Number(x.p[i])); return v > 0 && v < 10000 ? v : null; }) };
    }).sort(function (a, b) { return Date.parse(a.t) - Date.parse(b.t); });
    return h;
  }
  // A newer request wins: an answer that arrives after a later Refresh is ignored.
  var gen = { stats: 0, history: 0, official: 0 };
  function loadStats() {
    state.statsError = null;
    var g = ++gen.stats;
    withTimeout(API.live(state.cfg), 20000)
      .then(function (res) {
        if (g !== gen.stats) return;
        if (!res || !res.creators || !res.creators.length) throw new Error((res && res.errors && res.errors[0]) || 'no data yet');
        state.stats = cleanStats(res);
        rebuild();
      })
      .catch(function (e) { if (g !== gen.stats) return; state.statsError = e.message; rebuild(); });
  }

  // Official leaderboard snapshots the server logs every 4 hours (rank history, movers, My lineup).
  function loadHistory() {
    state.historyError = null;
    var g = ++gen.history;
    withTimeout(API.history(state.cfg), 20000)
      .then(function (h) {
        if (g !== gen.history) return;
        h = cleanHistory(h);
        if (!h.snapshots.length) throw new Error('no snapshots yet');
        state.history = h;
        rebuild();
      })
      .catch(function (e) { if (g !== gen.history) return; state.historyError = e.message; rebuild(); });
  }

  // Minutes to add to UTC to get New York time at that moment (handles daylight saving).
  function nyOffsetMin(d) {
    var m = d.toLocaleString('en-US', { timeZone: 'America/New_York', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
      .match(/(\d+)\/(\d+)\/(\d+),?\s*(\d+):(\d+)/);
    if (!m) return -300;
    return Math.round((Date.UTC(+m[3], +m[1] - 1, +m[2], +m[4] % 24, +m[5]) - Math.floor(d.getTime() / 60000) * 60000) / 60000); // both to the minute
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
    var byName = Object.create(null), g = ++gen.official;
    (MS.CREATORS || []).forEach(function (c) { byName[c.name.toLowerCase()] = c; });
    withTimeout(fetch(url, { cache: 'no-store' }), 20000)
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (j) {
        if (g !== gen.official) return;
        var rows = (j && Array.isArray(j.rows) ? j.rows : []).filter(function (r) { return r && Number(r.position) > 0 && r.name; }).map(function (r) {
          var name = String(r.name), c = byName[name.toLowerCase()];
          var key = (c && (c.x || c.name) || name).toLowerCase();
          return { key: key, id: /^[\w-]{1,64}$/.test(r.id || '') ? r.id : null, name: name, handle: c && c.x ? c.x : null,
            position: Math.round(Number(r.position)), delta: Math.round(num(r.delta)) };
        }).sort(function (a, b) { return a.position - b.position; });
        if (!rows.length) throw new Error('the leaderboard is empty');
        state.official = { asOf: j.asOf || j.capturedAt || '', rows: rows };
        rebuild();
      })
      .catch(function (e) { if (g !== gen.official) return; state.officialError = e.message; rebuild(); });
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
        key: r.key, name: r.name, handle: r.handle || (s && s.handle) || r.name, hasX: !!(r.handle || (s && s.handle)),
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
        c.hi = i; // column of this creator in the history snapshots
        c.series =snaps.map(function (sn) { return { t: sn.t, p: sn.p[i] }; }).filter(function (x) { return x.p; });
        var b = base.p[i];
        c.basePos = b || null;
        c.weekChange = b ? b - c.position : null; // + = climbed
      });
    }
    var onBoard = {};
    list.forEach(function (c) { onBoard[c.key] = true; });
    var extra = (state.stats ? state.stats.creators : []).filter(function (c) { return !onBoard[c.key]; })
      .map(function (c) { return c.handle; });
    // "at lock" only if the base snapshot is within 8 hours before the lock (snapshots come every 4 hours)
    var baseAt = base ? Date.parse(base.t) : null;
    return { list: list, extra: extra, N: N, lock: lock, baseT: base ? base.t : null, sinceLock: !!(base && baseAt <= lock.getTime() && lock.getTime() - baseAt <= 8 * 3600e3) };
  }

  function rebuild() {
    stabCache = {};
    state.board = buildBoard();
    renderHow();
    renderAll();
    if (cpick) cpick.refresh();
  }

  /* ---------- render ---------- */
  function renderStatus() {
    var el = $('data-status'), o = state.official;
    el.classList.toggle('is-demo', !o);
    if (!o) {
      el.innerHTML = state.officialError
        ? 'Official leaderboard unavailable right now <button type="button" class="status-refresh" id="btn-refresh">Try again</button>'
        : 'Loading the official leaderboard…';
      return;
    }
    var stats = state.stats
      ? 'Social stats from X' + (state.stats.meta && /youtube/i.test(state.stats.meta.platform || '') ? ' and YouTube' : '') + ' · ' +
        state.stats.meta.dateFrom + ' → ' + state.stats.meta.dateTo
      : state.statsError ? 'Social stats unavailable right now' : 'Loading social stats…';
    var stale = state.officialError || (state.stats && state.statsError) ? ' · couldn’t refresh just now, showing the last data' : '';
    el.innerHTML = esc('Creator ranks · updated ' + fTime(o.asOf) + ' · ' + o.rows.length + ' creators · ' + stats + stale) +
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
    if (document.body.getAttribute('data-tab') === 'insights') renderInsights();
    if (has && detailKey && $('detail').open) { // stats or history arrived
      var st = $('detail').scrollTop, hadFocus = $('detail').contains(document.activeElement);
      openDetail(detailKey, true); $('detail').scrollTop = st;
      if (hadFocus) $('detail').querySelector('.modal-x').focus();
    }
    if (pendingCreator && has) {
      var pc = pendingCreator.toLowerCase(), hit = state.board.list.filter(function (c) { return c.handle.toLowerCase() === pc || c.key === pc; })[0];
      if (hit) { pendingCreator = null; openDetail(hit.key); }
    }
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
    if (!withMove.length) { el.innerHTML = '<div class="movers-empty muted">Not enough rank history to compare yet. Movers show up after the next leaderboard update.</div>'; return; }
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
  // Saved as { lock, picks }: the week it was picked for (older versions saved just the picks).
  try {
    var savedLu = JSON.parse(lsGet(LS_LINEUP) || '[]');
    var luPicks = Array.isArray(savedLu) ? savedLu : savedLu && Array.isArray(savedLu.picks) ? savedLu.picks : [];
    state.lineup = luPicks.filter(function (k) { return typeof k === 'string'; }).slice(0, 5);
    state.lineupLock = savedLu && !Array.isArray(savedLu) && typeof savedLu.lock === 'string' ? savedLu.lock : null;
  } catch (e) { state.lineup = []; state.lineupLock = null; }
  function saveLineup() {
    state.lineupLock = lastLock(new Date()).toISOString();
    lsSet(LS_LINEUP, JSON.stringify({ lock: state.lineupLock, picks: state.lineup }));
    renderMyLineup();
  }
  function renderMyLineup() {
    var el = $('mylineup'), b = state.board;
    if (!el || !b) return;
    var by = {};
    b.list.forEach(function (c) { by[c.key] = c; });
    var picks = state.lineup.map(function (k) { return by[k]; }).filter(Boolean);
    var gone = state.lineup.filter(function (k) { return !by[k]; });
    var oldWeek = picks.length && state.lineupLock && Date.parse(state.lineupLock) < b.lock.getTime() - 3600e3;
    var notes = (oldWeek ? '<p class="ml-note">These are your picks for the week of ' + esc(new Date(state.lineupLock).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })) +
        '. Pick this week’s five, or <button type="button" class="link-btn" id="ml-keep">keep them for this week</button>.</p>' : '') +
      (gone.length ? '<p class="ml-note">Not on the leaderboard anymore: ' + gone.map(function (k) {
        return '@' + esc(k) + ' <button type="button" class="link-btn" data-ml-remove="' + esc(k) + '">remove</button>';
      }).join(', ') + '</p>' : '');
    var boost = function (c) { var m = myCards[c.key]; return m && m.r ? state.cfg.cardBoosts[m.r] || 1 : 1; };
    var valueAt = function (pos) { return Math.round(1000 * (b.N - pos + 1) / b.N); };
    var head = '<div class="ml-head"><h3>My lineup this week</h3>' +
      '<span class="ml-actions"><button type="button" class="btn btn-ghost" id="ml-use"><span>Use this draft</span></button>' +
      '<button type="button" class="btn btn-ghost" id="ml-edit"><span>Pick creators</span></button>' +
      (picks.length ? '<button type="button" class="btn btn-ghost" id="ml-clear"><span>Clear</span></button>' : '') + '</span></div>';
    if (!picks.length) {
      el.innerHTML = '<div class="card-cut ml-box">' + head + notes + '<p class="muted">Track the five you submitted: see how their official ranks move through the week, from Monday’s lock to Friday’s results. Saved in this browser.</p></div>';
      return;
    }
    // the change compares the same cards: only those with a rank at the base snapshot
    var withBase = picks.filter(function (c) { return c.basePos; }), hasBase = withBase.length > 0;
    var nowVal = 0, baseVal = 0, nowSame = 0;
    var rows = picks.map(function (c) {
      var bst = boost(c);
      nowVal += valueAt(c.position) * bst;
      if (c.basePos) { baseVal += valueAt(c.basePos) * bst; nowSame += valueAt(c.position) * bst; }
      return '<tr data-key="' + esc(c.key) + '"><td class="ml-who"><button type="button" class="tbl-who" data-key="' + esc(c.key) + '">' + avatarHtml(c, 26) + '@' + esc(c.handle) + '</button></td><td>' + starsText(c) + '</td><td>' + (c.basePos ? '#' + c.basePos : '—') + '</td><td><b>#' + c.position + '</b></td><td>' +
        (c.weekChange != null ? moveText(c.weekChange) : '—') + '</td><td>' + sparkline(c, 80, 20) + '</td></tr>';
    }).join('');
    var label = b.sinceLock ? 'At lock' : (b.baseT ? 'Since ' + esc(fTime(b.baseT)) : 'At lock');
    el.innerHTML = '<div class="card-cut ml-box">' + head + notes +
      '<div class="tbl-wrap"><table class="tbl ml-tbl"><thead><tr><th>Creator</th><th>Stars</th><th>' + label + '</th><th>Now</th><th>Change</th><th>Trend</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<div class="lineup-total"><span>Deck value now <b>' + fInt(nowVal) + '</b></span>' +
      (hasBase ? '<span>' + label + ' <b>' + fInt(baseVal) + '</b></span><span>Change <b>' + (nowSame - baseVal >= 0 ? '+' : '−') + fInt(Math.abs(nowSame - baseVal)) + '</b>' +
        (withBase.length < picks.length ? ' <small class="muted">(' + withBase.length + ' of ' + picks.length + ' cards have history)</small>' : '') + '</span>' : '') + '</div>' +
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
    var narrow = window.innerWidth < 700, W = narrow ? 560 : 900, H = narrow ? 300 : 240, L = narrow ? 54 : 46, R = 16, T = 16, B = 34;
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
    var dots = pts.map(function (x) { return '<circle class="ch-dot" cx="' + X(x.t).toFixed(1) + '" cy="' + Y(x.p).toFixed(1) + '" r="3.5"/>'; }).join('');
    var tips = pts.map(function (x, i) {
      var d = i ? pts[i - 1].p - x.p : null;
      var ch = d == null ? 'first snapshot' : d > 0 ? '<span class="pos">▲' + d + '</span> since the update before' : d < 0 ? '<span class="neg">▼' + (-d) + '</span> since the update before' : 'no change';
      return [+X(x.t).toFixed(1), +Y(x.p).toFixed(1), '<small>' + esc(shortTime(x.t)) + '</small><b>#' + x.p + '</b><span>' + ch + '</span>'];
    });
    var up = c.weekChange != null ? c.weekChange : pts[0].p - pts[pts.length - 1].p;
    return chartWrap(tips, W, '<svg class="rank-chart' + (up > 0 ? ' up' : up < 0 ? ' down' : '') + '" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Rank of @' + esc(c.handle) + ' over time, from #' + pts[0].p + ' to #' + pts[pts.length - 1].p + '">' +
      grid + lockLine + '<path class="ch-area" d="' + area + '"/><path class="ch-line" d="' + line + '"/>' + dots + xl +
      '<line class="ch-cross" x1="0" x2="0" y1="' + T + '" y2="' + (H - B) + '"/><circle class="ch-hot" r="7" cx="-20" cy="-20"/></svg>');
  }
  // Views per day as bars, the number of posts above each bar.
  function dailyChart(s) {
    var days = (s && s.daily) || [];
    if (days.length < 2) return '';
    var narrow = window.innerWidth < 700, W = narrow ? 560 : 900, H = narrow ? 250 : 200, L = 8, R = 8, T = 22, B = 30, n = days.length;
    var max = Math.max.apply(null, days.map(function (d) { return d[2] || 0; }).concat([1]));
    var bw = (W - L - R) / n;
    var bars = days.map(function (d, i) {
      var h = (d[2] || 0) / max * (H - T - B), x = L + i * bw + bw * 0.15, y = H - B - h;
      var label = i === 0 || i === n - 1 || i % 2 === 0 ? '<text class="ch-ax" x="' + (x + bw * 0.35).toFixed(1) + '" y="' + (H - 10) + '" text-anchor="middle">' + esc(d[0].slice(5).replace('-', '/')) + '</text>' : '';
      return '<rect class="ch-bar' + (d[1] ? '' : ' empty') + '" x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + (bw * 0.7).toFixed(1) + '" height="' + Math.max(1, h).toFixed(1) + '" rx="3"/>' +
        (d[1] ? '<text class="ch-cnt" x="' + (x + bw * 0.35).toFixed(1) + '" y="' + (y - 6).toFixed(1) + '" text-anchor="middle">' + d[1] + '</text>' : '') + label;
    }).join('');
    var tips = days.map(function (d, i) {
      var day = new Date(d[0] + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
      return [+(L + i * bw + bw * 0.5).toFixed(1), +(H - B - (d[2] || 0) / max * (H - T - B)).toFixed(1), '<small>' + esc(day) + '</small><b>' + fInt(d[2] || 0) + '</b><span>views · ' + d[1] + ' post' + (d[1] === 1 ? '' : 's') + '</span>'];
    });
    return chartWrap(tips, W, '<svg class="daily-chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Views per day over the last ' + n + ' days">' + bars +
      '<rect class="ch-band" x="-100" y="' + T + '" width="' + bw.toFixed(1) + '" height="' + (H - T - B) + '"/></svg>') +
      '<p class="muted ch-note">Bars: views per day. Numbers: posts that day.</p>';
  }
  // Hover (or tap) a chart to see the value at the nearest point: tips = [[x, y, html], ...] in viewBox units.
  // xy: pick the nearest point in both directions (scatter charts) instead of by x only.
  function chartWrap(tips, W, svg, xy) {
    return '<div class="ch-wrap" data-w="' + W + '"' + (xy ? ' data-xy="1"' : '') + ' data-tips="' + esc(JSON.stringify(tips)) + '">' + svg + '<div class="ch-tip" aria-hidden="true"></div></div>';
  }
  function chartHover(e) {
    var wrap = e.target.closest && e.target.closest('.ch-wrap');
    if (!wrap) return;
    var tips = wrap._tips || (wrap._tips = JSON.parse(wrap.dataset.tips || '[]'));
    var svg = wrap.querySelector('svg'), box = svg.getBoundingClientRect(), k = box.width / +wrap.dataset.w;
    if (!tips.length || !k) return;
    var vx = (e.clientX - box.left) / k, vy = (e.clientY - box.top) / k, best = 0, xy = !!wrap.dataset.xy;
    var dist = function (p) { return xy ? (p[0] - vx) * (p[0] - vx) + (p[1] - vy) * (p[1] - vy) : Math.abs(p[0] - vx); };
    tips.forEach(function (p, i) { if (dist(p) < dist(tips[best])) best = i; });
    var p = tips[best], tip = wrap.querySelector('.ch-tip');
    var cross = svg.querySelector('.ch-cross'), hot = svg.querySelector('.ch-hot'), band = svg.querySelector('.ch-band');
    if (cross) { cross.setAttribute('x1', p[0]); cross.setAttribute('x2', p[0]); }
    if (hot) { hot.setAttribute('cx', p[0]); hot.setAttribute('cy', p[1]); }
    if (band) band.setAttribute('x', p[0] - band.getAttribute('width') / 2);
    if (wrap._shown !== best) { tip.innerHTML = p[2]; wrap._shown = best; }
    wrap.classList.add('is-hover');
    var px = p[0] * k, py = p[1] * k, tw = tip.offsetWidth, th = tip.offsetHeight;
    var left = Math.min(Math.max(px - tw / 2, 4), box.width - tw - 4);
    var top = py - th - 14 < 0 ? py + 16 : py - th - 14;
    tip.style.transform = 'translate(' + Math.round(left) + 'px,' + Math.round(top) + 'px)';
  }
  document.addEventListener('pointermove', chartHover);
  document.addEventListener('pointerdown', chartHover);
  document.addEventListener('pointerover', function (e) {
    Array.prototype.forEach.call(document.querySelectorAll('.ch-wrap.is-hover'), function (w) { if (!w.contains(e.target)) { w.classList.remove('is-hover'); w._shown = null; } });
  });
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
          '<div class="bar"><i style="width:' + (v > 0 ? Math.max(2, w) : 0) + '%"></i></div></div>';
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
        '<p>The search is exact, so it’s the best draft for that cap by rank-based value. Real stars and the tournament’s boost limits still need checking in the game.</p></div>' +
      '<div class="card-cut how-card"><h3>Rank <em>history</em></h3><p>Motion Scout saves every snapshot of the official leaderboard (about every 4 hours) from ' + (state.history && state.history.snapshots.length ? esc(fTime(state.history.snapshots[0].t)) : 'now on') + '. <b>Movers</b> compares each creator with their rank at Monday’s 7 AM ET lineup lock; <b>My lineup this week</b> does the same for your five.</p></div>' +
      '<div class="card-cut how-card"><h3>Social <em>stats</em></h3><p>Where available: posts, active days, views and followers over the last ' + cfg.windowDays + ' days on X (original posts and quotes, no replies or reposts). YouTube is being added. Collected every day. They’re context for your picks: they don’t change the order.</p></div>' +
      '<div class="card-cut how-card how-wide"><h3>Game <em>rules</em></h3><p>From <a href="https://docs.motion.game" target="_blank" rel="noopener">docs.motion.game</a>: Motion scores creators on X, Instagram, TikTok and YouTube during each Monday-to-Friday tournament; the top creator gets 1,000 pts; stars (1–8) reflect each creator’s performance relative to others over the past 14 days and count toward each tournament’s star cap; Lineup Score = sum of each creator’s Motion Score × card boost; submitted lineups are ranked on the Tournament Leaderboard in Arena. Motion Scout is a community planning tool, not the game’s score.</p></div>';
  }

  /* ---------- detail modal ---------- */
  var detailKey = null;
  function openDetail(key, keepScroll) {
    var c = state.board && state.board.list.filter(function (x) { return x.key === key; })[0];
    if (!c) return;
    detailKey = key;
    var b = state.board, x = c.x, yt = c.yt;
    var since = b.sinceLock ? 'Since Monday’s lock' : 'Since tracking started';
    var head = '<div class="dh">' + avatarHtml(c, 72) +
      '<div class="dh-who"><h2 id="detail-title">' + esc(c.name) + '</h2>' +
        (c.hasX ? '<a class="dh-handle" href="https://x.com/' + encodeURIComponent(c.handle) + '" target="_blank" rel="noopener">@' + esc(c.handle) + '</a>' : '<span class="dh-handle muted">No X account tracked</span>') +
        '<button type="button" class="link-btn dh-copy" data-copy-link="' + esc(pageId(c)) + '">Copy link to this page</button>' +
        '<div class="chips">' + chipsFor(c) + (c.starsFrom === 'yours' ? '<span class="chip">your card</span>' : '') + '</div></div>' +
      '<div class="dh-rank"><b>#' + c.position + '</b><small>of ' + b.N + '</small></div>' +
      '<button type="button" class="modal-x" data-close aria-label="Close">✕</button></div>';
    var tiles = '<div class="dtiles">' +
      tile('Official rank', '#' + c.position, 'as of ' + esc(shortTime(state.official.asOf))) +
      tile('Last update', moveText(c.delta), 'change in rank') +
      tile(since, c.weekChange != null ? moveText(c.weekChange) : '—', c.basePos ? '#' + c.basePos + ' → #' + c.position : 'no history yet') +
      tile('Stars', starsText(c), c.starsFrom === 'yours' ? 'from your card' : c.stars != null ? 'from the game' : 'estimated from rank', 'hot') +
      tile('Deck value', fInt(c.points), '× your card’s boost') +
      swingTile(c) +
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
      '<p class="muted ch-note">Original posts and quotes only, as Motion counts them. Interactions = likes + replies + reposts + quotes.</p></section>' +
      rhythmHtml(x);
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
    if (!dlg.open) dlg.showModal();
    if (!keepScroll) dlg.scrollTop = 0;
    // a link to this creator's page: #c/<handle>
    if (location.hash !== '#c/' + encodeURIComponent(pageId(c))) history.replaceState(null, '', '#c/' + encodeURIComponent(pageId(c)));
  }
  function pageId(c) { return c.hasX ? c.handle : c.key; }
  function creatorLink(id) {
    var base = location.protocol === 'file:' ? 'https://motion-scout.vercel.app/' : location.origin + location.pathname;
    return base + '#c/' + encodeURIComponent(id);
  }
  // Average posts a day / week, tournament days vs weekends, and the busiest weekdays.
  function fAvg(n) { return n == null ? '—' : n < 10 ? n.toFixed(1).replace(/\.0$/, '') : fInt(n); }
  function rhythmHtml(x) {
    var d = (x && x.daily) || [];
    if (d.length < 7) return '';
    var NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    var wk = NAMES.map(function () { return { n: 0, posts: 0, views: 0 }; });
    var wd = { n: 0, posts: 0 }, we = { n: 0, posts: 0 }, best = null, total = 0;
    d.forEach(function (r) {
      var i = (new Date(r[0] + 'T12:00:00Z').getUTCDay() + 6) % 7, g = i < 5 ? wd : we;
      wk[i].n++; wk[i].posts += r[1]; wk[i].views += r[2] || 0;
      g.n++; g.posts += r[1]; total += r[1];
      if (r[1] && (!best || (r[2] || 0) > (best[2] || 0))) best = r;
    });
    var perDay = total / d.length, perWd = wd.n ? wd.posts / wd.n : null, perWe = we.n ? we.posts / we.n : null;
    var tiles = '<div class="dtiles">' +
      tile('Posts a day', fAvg(perDay), 'average over ' + d.length + ' days', 'hot') +
      tile('Posts a week', fAvg(perDay * 7), 'at that pace') +
      tile('Mon–Fri', fAvg(perWd == null ? null : perWd * 5), (perWd == null ? '—' : fAvg(perWd)) + ' a day, when tournaments score') +
      tile('Sat–Sun', fAvg(perWe == null ? null : perWe * 2), (perWe == null ? '—' : fAvg(perWe)) + ' a day on weekends') +
      tile('Best day', best ? fK(best[2]) : '—', best ? esc(dayLabel(best[0])) + ' · ' + best[1] + ' post' + (best[1] === 1 ? '' : 's') : 'no posts yet') +
    '</div>';
    var narrow = window.innerWidth < 700, W = narrow ? 560 : 900, H = narrow ? 240 : 190, L = 8, R = 8, T = 30, B = 30, bw = (W - L - R) / 7;
    var avg = wk.map(function (g) { return g.n ? g.posts / g.n : 0; });
    var max = Math.max.apply(null, avg.concat([0.1]));
    var bars = avg.map(function (v, i) {
      var h = v / max * (H - T - B), xx = L + i * bw + bw * 0.18, y = H - B - h;
      return '<rect class="ch-bar' + (i > 4 ? ' wkend' : '') + (v ? '' : ' empty') + '" x="' + xx.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + (bw * 0.64).toFixed(1) + '" height="' + Math.max(1, h).toFixed(1) + '" rx="3"/>' +
        '<text class="ch-cnt" x="' + (L + i * bw + bw / 2).toFixed(1) + '" y="' + (y - 7).toFixed(1) + '" text-anchor="middle">' + fAvg(v) + '</text>' +
        '<text class="ch-ax" x="' + (L + i * bw + bw / 2).toFixed(1) + '" y="' + (H - 10) + '" text-anchor="middle">' + NAMES[i].slice(0, 3) + '</text>';
    }).join('');
    var tips = avg.map(function (v, i) {
      var g = wk[i];
      return [+(L + i * bw + bw / 2).toFixed(1), +(H - B - v / max * (H - T - B)).toFixed(1),
        '<small>' + NAMES[i] + 's · ' + g.n + ' in the window</small><b>' + fAvg(v) + '</b><span>posts on average · ' + fK(g.n ? g.views / g.n : 0) + ' views</span>'];
    });
    return '<section class="dsec"><h3>Posting rhythm <span class="muted">X · last ' + d.length + ' days</span></h3>' + tiles +
      chartWrap(tips, W, '<svg class="daily-chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Average posts on X by day of the week">' + bars +
        '<rect class="ch-band" x="-100" y="' + T + '" width="' + bw.toFixed(1) + '" height="' + (H - T - B) + '"/></svg>') +
      '<p class="muted ch-note">Average posts on each day of the week. Tournaments score Monday to Friday; weekends are shown dimmer.</p></section>';
  }
  // How much the rank moved over the last 7 days, compared with every other creator.
  function swingTile(c) {
    if (!state.history || c.hi == null) return '';
    var rows = stabRows(7).rows, me = rows.filter(function (r) { return r.c.key === c.key; })[0];
    if (!me) return '';
    var others = rows.length - 1;
    var lower = rows.filter(function (r) { return r.sd < me.sd; }).length, higher = rows.filter(function (r) { return r.sd > me.sd; }).length;
    var pct = others ? (lower + (others - lower - higher) / 2) / others : 0.5;
    var label = pct < 1 / 3 ? 'Steady' : pct > 2 / 3 ? 'Swingy' : 'Average swing';
    var vs = !others ? '' : higher >= lower ? ', steadier than ' + Math.round(higher / others * 100) + '% of creators' : ', swingier than ' + Math.round(lower / others * 100) + '% of creators';
    return tile('Rank range · 7 days', me.best === me.worst ? '#' + me.best : '#' + me.best + '–' + me.worst, label + ' (±' + me.sd.toFixed(1) + ' places' + vs + ')');
  }

  /* ---------- insights: Week in Motion, steady vs swingy, X activity vs rank ---------- */
  var DAY = 864e5;
  var ins = { week: 0, weekPicked: false, stabTop: true, xr: 'views', act: { key: 'ppd', dir: -1 }, actAll: false, eff: { key: 'gp', dir: -1 }, effAll: false };
  function isoDay(t) { return new Date(t).toISOString().slice(0, 10); }
  function dayLabel(iso) { return new Date(iso + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }); }
  function snapBefore(t) {
    var s = state.history.snapshots, out = null;
    for (var i = 0; i < s.length; i++) { if (Date.parse(s[i].t) <= t) out = s[i]; else break; }
    return out;
  }
  function snapAfter(t) {
    var s = state.history.snapshots;
    for (var i = 0; i < s.length; i++) if (Date.parse(s[i].t) >= t) return s[i];
    return null;
  }
  function snapsBetween(a, b) { return state.history.snapshots.filter(function (s) { var t = Date.parse(s.t); return t >= a && t <= b; }); }
  function sdOf(a) {
    var m = a.reduce(function (x, y) { return x + y; }, 0) / a.length;
    return Math.sqrt(a.reduce(function (x, y) { return x + (y - m) * (y - m); }, 0) / a.length);
  }
  function xDaysFor(c, dates) {
    var set = {};
    dates.forEach(function (d) { set[d] = 1; });
    return c.x && c.x.daily ? c.x.daily.filter(function (d) { return set[d[0]]; }) : [];
  }
  function sum(a, f) { return a.reduce(function (s, x) { return s + f(x); }, 0); }
  // Spearman rank correlation: -1..1, how often a higher a goes with a higher b.
  function spearman(a, b) {
    var rk = function (v) {
      var idx = v.map(function (x, i) { return i; }).sort(function (i, j) { return v[i] - v[j]; }), r = [];
      for (var i = 0; i < idx.length;) {
        var j = i; while (j + 1 < idx.length && v[idx[j + 1]] === v[idx[i]]) j++;
        for (var k = i; k <= j; k++) r[idx[k]] = (i + j) / 2;
        i = j + 1;
      }
      return r;
    };
    var ra = rk(a), rb = rk(b), n = a.length;
    if (n < 3) return null;
    var ma = sum(ra, Number) / n, mb = sum(rb, Number) / n, cov = 0, va = 0, vb = 0;
    for (var i = 0; i < n; i++) { cov += (ra[i] - ma) * (rb[i] - mb); va += (ra[i] - ma) * (ra[i] - ma); vb += (rb[i] - mb) * (rb[i] - mb); }
    return va && vb ? cov / Math.sqrt(va * vb) : null;
  }

  // Tournament weeks (Monday 7 AM ET lock to the next lock) that rank history covers, newest first.
  function insightWeeks() {
    var h = state.history;
    if (!h || !h.snapshots.length) return [];
    var first = Date.parse(h.snapshots[0].t), starts = [], L = lastLock(new Date()).getTime();
    for (var i = 0; i < 8; i++) { starts.push(L); if (L <= first) break; L = lastLock(new Date(L - 60000)).getTime(); }
    return starts.map(function (s, i) { return { start: s, end: i ? starts[i - 1] : null }; });
  }
  function weekStats(w) {
    var end = w.end || Date.now(), late = false;
    var s0 = snapBefore(w.start);
    if (!s0) { s0 = snapAfter(w.start); late = true; }
    var s1 = snapBefore(end);
    if (!s0 || !s1 || Date.parse(s1.t) < w.start || Date.parse(s1.t) <= Date.parse(s0.t)) return null;
    var within = snapsBetween(Date.parse(s0.t), Date.parse(s1.t));
    var dates = [];
    for (var i = 0; i < 7; i++) dates.push(isoDay(w.start + i * DAY));
    var xDates = {};
    var rows = state.board.list.filter(function (c) { return c.hi != null && s1.p[c.hi]; }).map(function (c) {
      var a = s0.p[c.hi], b = s1.p[c.hi];
      var ps = within.map(function (s) { return s.p[c.hi]; }).filter(Boolean);
      var xd = xDaysFor(c, dates), top = null;
      xd.forEach(function (d) { xDates[d[0]] = 1; if (d[1] && (!top || (d[2] || 0) > (top[2] || 0))) top = d; });
      return {
        c: c, a: a, b: b, change: a ? a - b : null, n: ps.length,
        best: Math.min.apply(null, ps), worst: Math.max.apply(null, ps),
        atTop: ps.filter(function (p) { return p === 1; }).length,
        posts: xd.length ? sum(xd, function (d) { return d[1]; }) : null,
        views: xd.length ? sum(xd, function (d) { return d[2] || 0; }) : null, top: top, xdays: xd.length
      };
    });
    return { w: w, s0: s0, s1: s1, late: late, n: within.length, rows: rows, xDates: dates.filter(function (d) { return xDates[d]; }) };
  }
  function wkRow(r, sub, val, cls) {
    return '<li><button type="button" class="wk-row" data-key="' + esc(r.c.key) + '">' + avatarHtml(r.c, 30) +
      '<span class="wk-who"><b>@' + esc(r.c.handle) + '</b><small>' + sub + '</small></span><span class="wk-val' + (cls ? ' ' + cls : '') + '">' + val + '</span></button></li>';
  }
  function wkBox(title, cls, items) {
    return '<div class="wk-box' + (cls ? ' ' + cls : '') + '"><h4>' + title + '</h4>' +
      (items.length ? '<ol class="wk-list">' + items.join('') + '</ol>' : '<p class="muted">Nobody yet.</p>') + '</div>';
  }
  function topBy(rows, f, n, keep) {
    return rows.filter(keep).sort(function (a, b) { return f(b) - f(a) || a.b - b.b; }).slice(0, n);
  }
  function fRange(t0, t1) {
    var a = new Date(t0), b = new Date(t1), o = { day: 'numeric', month: 'short', timeZone: 'UTC' };
    return a.getUTCMonth() === b.getUTCMonth() ? a.getUTCDate() + '–' + b.toLocaleDateString('en-GB', o) : a.toLocaleDateString('en-GB', o) + ' – ' + b.toLocaleDateString('en-GB', o);
  }
  function weekMeme(w) {
    if (!memes.list) return null;
    var win = (memes.winners || []).filter(function (x) { var t = Date.parse(x.weekEnd); return t >= w.start && t < w.start + 7 * DAY; })[0];
    return win ? { win: win, m: memeById(win.id) } : null;
  }
  function renderWeek() {
    var el = $('wk');
    if (!state.history) {
      el.innerHTML = '<div class="empty">' + (state.historyError ? 'Rank history isn’t available right now.' : 'Loading rank history…') + '</div>';
      return;
    }
    var weeks = insightWeeks().map(weekStats).filter(Boolean);
    if (!weeks.length) { el.innerHTML = '<div class="empty">The week shows up after the next leaderboard update.</div>'; return; }
    // early in a new week (under a day of updates), open last week's full recap unless a week was picked
    if (!ins.weekPicked) ins.week = weeks.length > 1 && !weeks[0].w.end && Date.parse(weeks[0].s1.t) - weeks[0].w.start < DAY ? 1 : 0;
    if (ins.week >= weeks.length) ins.week = 0;
    var S = weeks[ins.week], rows = S.rows, live = !S.w.end;
    var segLabel = function (x) { return !x.w.end ? 'This week' : 'Week of ' + new Date(x.w.start).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }); };
    var seg = weeks.length > 1 ? '<div class="seg wk-seg" role="group" aria-label="Pick a week">' + weeks.slice(0, 6).map(function (x, i) {
      return '<button type="button" class="seg-btn' + (i === ins.week ? ' active' : '') + '" data-wk="' + i + '" aria-pressed="' + (i === ins.week) + '">' + esc(segLabel(x)) + '</button>';
    }).join('') + '</div>' : '';
    var up = topBy(rows, function (r) { return r.change; }, 3, function (r) { return r.change > 0; });
    var down = topBy(rows, function (r) { return -r.change; }, 3, function (r) { return r.change < 0; });
    var steady = topBy(rows, function (r) { return -(r.worst - r.best); }, 3, function (r) { return r.n === S.n && r.b <= 30; });
    var views = topBy(rows, function (r) { return r.views; }, 3, function (r) { return r.views > 0; });
    var posts = topBy(rows, function (r) { return r.posts; }, 3, function (r) { return r.posts > 0; });
    var days = topBy(rows, function (r) { return r.top[2] || 0; }, 3, function (r) { return r.top; });
    var top1 = rows.filter(function (r) { return r.b === 1; })[0];
    var xd = S.xDates.length, allViews = sum(rows, function (r) { return r.views || 0; }), allPosts = sum(rows, function (r) { return r.posts || 0; });
    var span = esc(fRange(S.w.start, S.w.start + 6 * DAY));
    var sub = 'Ranks ' + esc(shortTime(S.s0.t)) + ' → ' + esc(shortTime(S.s1.t)) + ' · ' + S.n + ' updates' + (S.late ? ' (tracking started mid-week)' : '') +
      ' · X: ' + (xd ? xd + ' of 7 days' + (xd < 7 ? ', ' + esc(dayLabel(S.xDates[0]).slice(0, 3)) + '–' + esc(dayLabel(S.xDates[xd - 1]).slice(0, 3)) : '') : 'no days yet');
    var hero = top1 ? '<button type="button" class="wk-hero" data-key="' + esc(top1.c.key) + '">' + avatarHtml(top1.c, 64) +
      '<span><small>' + (live ? '#1 right now' : '#1 at the end of the week') + '</small><b>@' + esc(top1.c.handle) + '</b>' +
      '<em>' + (top1.atTop === S.n ? 'held #1 in every update' : 'at #1 in ' + top1.atTop + ' of ' + S.n + ' updates') + '</em></span></button>' : '';
    var nums = '<div class="wk-nums">' +
      '<div><b>' + (up[0] ? '▲' + up[0].change : '–') + '</b><small>biggest climb' + (up[0] ? ' · @' + esc(up[0].c.handle) : '') + '</small></div>' +
      '<div><b>' + (down[0] ? '▼' + (-down[0].change) : '–') + '</b><small>biggest fall' + (down[0] ? ' · @' + esc(down[0].c.handle) : '') + '</small></div>' +
      '<div><b>' + (xd ? fK(allViews) : '—') + '</b><small>views on X, all creators</small></div>' +
      '<div><b>' + (xd ? fInt(allPosts) : '—') + '</b><small>posts on X' + (xd ? ' · ' + fAvg(allPosts / xd) + ' a day' : '') + '</small></div></div>';
    var meme = weekMeme(S.w), memeBox;
    if (meme && meme.m) {
      memeBox = '<div class="wk-box wk-meme"><h4>🏆 Meme of the week</h4><button type="button" class="wk-meme-btn" data-open-meme="' + esc(meme.m.id) + '">' +
        (meme.m.media ? '<img src="' + esc(meme.m.media) + '" alt="Meme by @' + esc(meme.m.author) + '" loading="lazy" referrerpolicy="no-referrer">' : '<span class="meme-text">' + esc(meme.m.text || 'Open the post') + '</span>') +
        '</button><p class="muted">by @' + esc(meme.m.author) + ' · ' + meme.win.likes + (meme.win.likes === 1 ? ' like' : ' likes') + '</p></div>';
    } else {
      memeBox = '<div class="wk-box wk-meme"><h4>🏆 Meme of the week</h4><p class="muted">' +
        (live || !memes.list ? 'Crowned on Sunday at 17:00 UTC from the most-liked meme.' : 'No winner that week.') +
        '</p><a class="link-btn" href="#memes">Go to the memes →</a></div>';
    }
    el.innerHTML = '<div class="wk card-cut">' +
      '<div class="wk-head"><div><span class="wk-tag">Week in Motion</span><h3>' + span + (live ? ' <em class="wk-live">live</em>' : '') + '</h3><p class="muted">' + sub + '</p></div>' + seg + '</div>' +
      '<div class="wk-top">' + hero + nums + '</div>' +
      '<div class="wk-grid">' +
        wkBox('Climbing', 'up', up.map(function (r) { return wkRow(r, '#' + r.a + ' → #' + r.b, '▲' + r.change, 'up'); })) +
        wkBox('Falling', 'down', down.map(function (r) { return wkRow(r, '#' + r.a + ' → #' + r.b, '▼' + (-r.change), 'down'); })) +
        wkBox('Held their place · top 30', '', steady.map(function (r) { return wkRow(r, r.best === r.worst ? 'never moved' : 'between #' + r.best + ' and #' + r.worst, '#' + r.b); })) +
        wkBox('Most views on X', '', views.map(function (r) { return wkRow(r, fAvg(r.posts) + ' posts', fK(r.views)); })) +
        wkBox('Posted the most', '', posts.map(function (r) { return wkRow(r, fAvg(r.posts / r.xdays) + ' a day', fInt(r.posts)); })) +
        wkBox('Biggest single day', '', days.map(function (r) { return wkRow(r, esc(dayLabel(r.top[0])) + ' · ' + r.top[1] + ' post' + (r.top[1] === 1 ? '' : 's'), fK(r.top[2])); })) +
        memeBox +
      '</div>' +
      '<p class="wk-foot"><span>motion-scout.vercel.app</span><span class="muted">Community tool, not affiliated with Motion · ranks from Motion’s public leaderboard, posts and views from X</span></p></div>';
  }

  // Rank spread over the last `days` days of snapshots (standard deviation in places).
  var stabCache = {};
  function stabRows(days) {
    if (stabCache[days]) return stabCache[days];
    return (stabCache[days] = stabRowsRaw(days));
  }
  function stabRowsRaw(days) {
    var s = state.history.snapshots, last = Date.parse(s[s.length - 1].t);
    var win = snapsBetween(last - days * DAY, last);
    var rows = state.board.list.filter(function (c) { return c.hi != null; }).map(function (c) {
      var pts = win.map(function (x) { return { t: x.t, p: x.p[c.hi] }; }).filter(function (x) { return x.p; });
      var ps = pts.map(function (x) { return x.p; });
      return { c: c, pts: pts, sd: ps.length > 1 ? sdOf(ps) : null, best: Math.min.apply(null, ps), worst: Math.max.apply(null, ps) };
    }).filter(function (r) { return r.sd != null; });
    return { win: win, rows: rows };
  }
  function renderStab() {
    var el = $('stab');
    if (!state.history) { el.innerHTML = ''; return; }
    var R = stabRows(7), rows = R.rows.filter(function (r) { return !ins.stabTop || r.c.position <= 25; });
    if (R.win.length < 3) { el.innerHTML = ''; return; }
    var item = function (r) {
      return '<button type="button" class="st-item" data-key="' + esc(r.c.key) + '">' + avatarHtml(r.c, 30) +
        '<span class="st-who"><b>@' + esc(r.c.handle) + '</b><small>' + (r.best === r.worst ? 'always #' + r.best : '#' + r.best + ' to #' + r.worst) + ' · now #' + r.c.position + '</small></span>' +
        sparkline({ series: r.pts }, 80, 22) + '<span class="st-sd">±' + r.sd.toFixed(1) + '</span></button>';
    };
    var steady = rows.slice().sort(function (a, b) { return a.sd - b.sd || a.c.position - b.c.position; }).slice(0, 6);
    var swingy = rows.slice().sort(function (a, b) { return b.sd - a.sd || a.c.position - b.c.position; }).slice(0, 6);
    el.innerHTML = '<div class="ins-card card-cut"><div class="ins-head"><div><h3>Steady or swingy</h3><p class="muted">How far each creator’s official rank moved over the last 7 days (' + R.win.length + ' updates since ' + esc(shortTime(R.win[0].t)) +
      '). A steady rank is easier to plan around; a swingy one can climb or drop a lot within a week. ± is the typical distance from their average rank, in places.</p></div>' +
      '<div class="seg" role="group" aria-label="Which creators"><button type="button" class="seg-btn' + (ins.stabTop ? ' active' : '') + '" data-stab="top" aria-pressed="' + ins.stabTop + '">Top 25</button>' +
      '<button type="button" class="seg-btn' + (ins.stabTop ? '' : ' active') + '" data-stab="all" aria-pressed="' + !ins.stabTop + '">Everyone</button></div></div>' +
      '<div class="movers-cols"><div><h4 class="st-h steady">Steadiest</h4>' + steady.map(item).join('') + '</div>' +
      '<div><h4 class="st-h swingy">Swingiest</h4>' + swingy.map(item).join('') + '</div></div></div>';
  }

  // Does posting on X go with climbing? Each dot is a creator: X activity over the same days vs their rank change.
  var XR = {
    views: { label: 'Views', axis: 'views on X', get: function (r) { return r.views; } },
    posts: { label: 'Posts', axis: 'posts on X', get: function (r) { return r.posts; } },
    perPost: { label: 'Views per post', axis: 'views per post', get: function (r) { return r.posts ? r.views / r.posts : null; } }
  };
  function xrData() {
    var meta = state.stats && state.stats.meta, s = state.history.snapshots;
    if (!meta || !meta.dateTo) return null;
    var first = Date.parse(s[0].t), lastSnap = Date.parse(s[s.length - 1].t);
    var endT = Math.min(Date.parse(meta.dateTo + 'T00:00:00Z') + DAY, Math.floor(lastSnap / DAY) * DAY);
    var startT = Math.max(endT - 7 * DAY, Math.ceil(first / DAY) * DAY);
    if (endT - startT < 2 * DAY) return null;
    var dates = [];
    for (var t = startT; t < endT; t += DAY) dates.push(isoDay(t));
    var s0 = snapBefore(startT) || snapAfter(startT), s1 = snapBefore(endT);
    if (!s0 || !s1 || s0 === s1) return null;
    var rows = state.board.list.filter(function (c) { return c.hi != null && c.x && s0.p[c.hi] && s1.p[c.hi]; }).map(function (c) {
      var xd = xDaysFor(c, dates);
      return { c: c, a: s0.p[c.hi], b: s1.p[c.hi], change: s0.p[c.hi] - s1.p[c.hi], posts: sum(xd, function (d) { return d[1]; }), views: sum(xd, function (d) { return d[2] || 0; }), days: xd.length };
    }).filter(function (r) { return r.days === dates.length; });
    return { dates: dates, s0: s0, s1: s1, rows: rows };
  }
  function renderXr() {
    var el = $('xr');
    if (!state.history || !state.stats) { el.innerHTML = ''; return; }
    var D = xrData();
    if (!D || D.rows.length < 10) { el.innerHTML = ''; return; }
    var M = XR[ins.xr], rows = D.rows.filter(function (r) { return M.get(r) != null; });
    var segXr = '<div class="seg" role="group" aria-label="Measure">' + Object.keys(XR).map(function (k) {
      return '<button type="button" class="seg-btn' + (ins.xr === k ? ' active' : '') + '" data-xr="' + k + '" aria-pressed="' + (ins.xr === k) + '">' + XR[k].label + '</button>';
    }).join('') + '</div>';
    if (rows.length < 10) {
      el.innerHTML = '<div class="ins-card card-cut"><div class="ins-head"><div><h3>X activity and rank change</h3></div>' + segXr + '</div><p class="muted">Not enough creators with posts over these days to compare ' + esc(M.axis) + ' yet.</p></div>';
      return;
    }
    var lg = function (v) { return Math.log(v + 1) / Math.LN10; };
    var xs = rows.map(function (r) { return lg(M.get(r)); }), ch = rows.map(function (r) { return r.change; });
    var rho = spearman(rows.map(M.get), ch);
    var narrow = window.innerWidth < 700, W = narrow ? 520 : 900, H = narrow ? 460 : 380, L = narrow ? 60 : 52, R = 18, T = 18, B = 44;
    // creators with none of it go in their own column on the left, so the scale starts where activity starts
    var nz = xs.filter(function (v) { return v > 0; }), hasZero = nz.length < xs.length;
    var x1 = Math.ceil(Math.max.apply(null, nz.concat([1]))), x0 = Math.min(x1 - 1, Math.floor(Math.min.apply(null, nz.concat([x1]))));
    var zx = x0 - 0.6, lo = hasZero ? zx - 0.25 : x0;
    xs = xs.map(function (v) { return v > 0 ? v : zx; });
    var m = Math.max(3, Math.max.apply(null, ch.map(Math.abs))) + 1;
    var X = function (v) { return L + (v - lo) / (x1 - lo) * (W - L - R); };
    var Y = function (c) { return T + (m - c) / (2 * m) * (H - T - B); };
    var grid = hasZero ? '<text class="ch-ax" x="' + X(zx).toFixed(1) + '" y="' + (H - 18) + '" text-anchor="middle">none</text>' +
      '<line class="ch-grid ch-zero" x1="' + X(x0 - 0.3).toFixed(1) + '" x2="' + X(x0 - 0.3).toFixed(1) + '" y1="' + T + '" y2="' + (H - B) + '"/>' : '';
    for (var k = x0; k <= x1; k++) {
      grid += '<line class="ch-grid" x1="' + X(k).toFixed(1) + '" x2="' + X(k).toFixed(1) + '" y1="' + T + '" y2="' + (H - B) + '"/>' +
        '<text class="ch-ax" x="' + X(k).toFixed(1) + '" y="' + (H - 18) + '" text-anchor="' + (k === x0 && !hasZero ? 'start' : k === x1 ? 'end' : 'middle') + '">' + (['1', '10', '100', '1K', '10K', '100K', '1M', '10M', '100M', '1B'][k] || fK(Math.pow(10, k))) + '</text>';
    }
    var step = m > 12 ? 10 : 5, yt = [];
    for (var v = -Math.floor(m / step) * step; v <= m; v += step) yt.push(v);
    grid += yt.map(function (v) {
      return '<line class="ch-grid' + (v === 0 ? ' ch-zero' : '') + '" x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(v).toFixed(1) + '" y2="' + Y(v).toFixed(1) + '"/>' +
        '<text class="ch-ax" x="' + (L - 8) + '" y="' + (Y(v) + 4).toFixed(1) + '" text-anchor="end">' + (v > 0 ? '▲' + v : v < 0 ? '▼' + (-v) : '0') + '</text>';
    }).join('');
    var tips = [], dots = rows.map(function (r, i) {
      var cx = X(xs[i]), cy = Y(r.change);
      tips.push([+cx.toFixed(1), +cy.toFixed(1), '<small>@' + esc(r.c.handle) + ' · #' + r.a + ' → #' + r.b + '</small><b>' + (r.change > 0 ? '<span class="pos">▲' + r.change + '</span>' : r.change < 0 ? '<span class="neg">▼' + (-r.change) + '</span>' : '±0') + '</b>' +
        '<span>' + fK(r.views) + ' views · ' + r.posts + (r.posts === 1 ? ' post' : ' posts') + (r.posts ? ' · ' + fK(r.views / r.posts) + ' a post' : '') + '</span>']);
      return '<circle class="sc-dot' + (r.change > 0 ? ' up' : r.change < 0 ? ' down' : '') + '" cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="6"/>';
    }).join('');
    var svg = '<svg class="rank-chart xr-chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Each creator’s ' + esc(M.axis) + ' against their rank change">' + grid + dots +
      '<text class="ch-ax" x="' + (W - R) + '" y="' + (H - 2) + '" text-anchor="end">' + esc(M.axis) + ' (log scale) →</text><circle class="ch-hot" r="9" cx="-20" cy="-20"/></svg>';
    // a plain-words verdict, plus the most and least active thirds
    var sorted = rows.slice().sort(function (a, b) { return M.get(b) - M.get(a); }), third = Math.max(1, Math.floor(sorted.length / 3));
    var avgCh = function (a) { return sum(a, function (r) { return r.change; }) / a.length; };
    var hiC = avgCh(sorted.slice(0, third)), loC = avgCh(sorted.slice(-third));
    var f1 = function (v) { return (v > 0 ? '▲' : v < 0 ? '▼' : '±') + Math.abs(v).toFixed(1); };
    var a = rho == null ? 0 : Math.abs(rho);
    var strength = a < 0.15 ? 'No clear link' : a < 0.35 ? 'A weak link' : a < 0.6 ? 'A clear link' : 'A strong link';
    var dir = rho > 0 ? 'more ' + M.axis + ' went with climbing' : 'more ' + M.axis + ' went with falling';
    var verdict = '<p class="xr-verdict"><b>' + strength + '</b>' + (a < 0.15 ? ': over these days, ' + esc(M.axis) + ' said little about who climbed.' : ': over these days, ' + esc(dir) + '.') +
      ' <span class="muted">(Spearman ρ = ' + (rho == null ? '—' : rho.toFixed(2)) + ', ' + rows.length + ' creators)</span></p>';
    el.innerHTML = '<div class="ins-card card-cut"><div class="ins-head"><div><h3>X activity and rank change</h3><p class="muted">Each dot is a creator: their ' + esc(M.axis) + ' from ' + esc(dayLabel(D.dates[0])) + ' to ' + esc(dayLabel(D.dates[D.dates.length - 1])) +
      ' against how many places they moved over the same days (rank at ' + esc(shortTime(D.s0.t)) + ' → ' + esc(shortTime(D.s1.t)) + '). Higher = climbed. It shows how the two went together, not what caused what.</p></div>' +
      segXr + '</div>' + verdict +
      chartWrap(tips, W, svg, true) +
      '<div class="xr-thirds"><div><small>Most ' + esc(M.axis) + ' (top third)</small><b class="' + (hiC > 0 ? 'up' : hiC < 0 ? 'down' : '') + '">' + f1(hiC) + '</b><span>places on average</span></div>' +
      '<div><small>Least ' + esc(M.axis) + ' (bottom third)</small><b class="' + (loC > 0 ? 'up' : loC < 0 ? 'down' : '') + '">' + f1(loC) + '</b><span>places on average</span></div></div>' +
      '<p class="muted ch-note">Motion also scores Instagram, TikTok and YouTube, which aren’t counted here, and a rank moves when everyone else’s scores move too. Read it as a hint, not a rule: the picture gets clearer as more weeks are collected.</p></div>';
  }
  // Who posts the most on X, their average reach (views per post) and their rank.
  var ACT = [
    { key: 'handle', label: 'Creator' },
    { key: 'ppd', label: 'Posts a day', get: function (r) { return r.ppd; }, fmt: fAvg },
    { key: 'vpp', label: 'Avg reach', title: 'Average views per post', get: function (r) { return r.vpp; }, fmt: fK },
    { key: 'vpd', label: 'Views a day', get: function (r) { return r.vpd; }, fmt: fK },
    { key: 'rank', label: 'Rank now', get: function (r) { return r.c.position; }, fmt: function (v) { return '#' + v; } },
    { key: 'avg', label: 'Avg rank · 7d', get: function (r) { return r.avg; }, fmt: function (v) { return v == null ? '—' : '#' + Math.round(v); } }
  ];
  function renderAct() {
    var el = $('act');
    if (!state.stats) { el.innerHTML = ''; return; }
    var avgRank = {};
    if (state.history) stabRows(7).rows.forEach(function (r) { avgRank[r.c.key] = sum(r.pts, function (x) { return x.p; }) / r.pts.length; });
    var rows = state.board.list.filter(function (c) { return c.x && c.x.days; }).map(function (c) {
      return { c: c, ppd: c.x.posts / c.x.days, vpp: c.x.posts ? c.x.views / c.x.posts : null, vpd: c.x.views / c.x.days, avg: avgRank[c.key] != null ? avgRank[c.key] : null };
    });
    var col = ACT.filter(function (a) { return a.key === ins.act.key; })[0], dir = ins.act.dir;
    rows.sort(function (a, b) {
      if (col.key === 'handle') return a.c.handle.toLowerCase().localeCompare(b.c.handle.toLowerCase()) * dir;
      var va = col.get(a), vb = col.get(b);
      if (va == null || vb == null) return (va == null) - (vb == null) || a.c.position - b.c.position;
      return (va - vb) * dir || a.c.position - b.c.position;
    });
    var shown = ins.actAll ? rows : rows.slice(0, 20), days = state.stats.meta ? state.stats.meta.windowDays || 14 : 14;
    var head = ACT.map(function (a) {
      var on = a.key === ins.act.key;
      return '<th' + (on ? ' aria-sort="' + (dir < 0 ? 'descending' : 'ascending') + '"' : '') + '><button type="button" class="act-sort' + (on ? ' active' : '') + '" data-act="' + a.key + '"' + (a.title ? ' title="' + a.title + '"' : '') + '>' + a.label + (on ? (dir < 0 ? ' ▼' : ' ▲') : '') + '</button></th>';
    }).join('');
    var body = shown.map(function (r) {
      return '<tr data-key="' + esc(r.c.key) + '"><td><button type="button" class="tbl-who act-who" data-key="' + esc(r.c.key) + '">' + avatarHtml(r.c, 26) + '<b>@' + esc(r.c.handle) + '</b></button></td>' +
        ACT.slice(1).map(function (a) { return '<td' + (a.key === ins.act.key ? ' class="act-on"' : '') + '>' + a.fmt(a.get(r)) + '</td>'; }).join('') + '</tr>';
    }).join('');
    el.innerHTML = '<div class="ins-card card-cut"><div class="ins-head"><div><h3>Who posts the most</h3><p class="muted">Posts a day, average reach (views per post) and views a day on X over the last ' + days +
      ' days, next to each creator’s rank now and their average rank over the last 7 days. Click a column to sort, a creator to open their page.</p></div></div>' +
      '<div class="tbl-wrap"><table class="tbl act-tbl"><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table></div>' +
      (rows.length > 20 ? '<div class="act-more"><button type="button" class="btn btn-ghost" data-act-all><span>' + (ins.actAll ? 'Show top 20' : 'Show all ' + rows.length) + '</span></button></div>' : '') + '</div>';
  }
  // Rank vs activity: each creator's place by posts (views, interactions) a day next to their place on Motion's board.
  // Gap = activity place - rank place: positive = ranks higher than their posting would suggest.
  var EFF = [
    { key: 'handle', label: 'Creator' },
    { key: 'rank', label: 'Avg rank · 7d', get: function (r) { return r.rank; }, fmt: function (v, r) { return '#' + Math.round(v) + (r.rankPlace !== Math.round(v) ? ' <small>' + r.rankPlace + ' here</small>' : ''); } },
    { key: 'ppd', label: 'Posts a day', get: function (r) { return r.ppd; }, fmt: function (v, r) { return fAvg(v) + ' <small>#' + r.pPlace + '</small>'; } },
    { key: 'gp', label: 'Gap · posts', title: 'Place by posts a day minus place on the leaderboard', gap: 1, get: function (r) { return r.pPlace - r.rankPlace; } },
    { key: 'vpd', label: 'Views a day', get: function (r) { return r.vpd; }, fmt: function (v, r) { return fK(v) + ' <small>#' + r.vPlace + '</small>'; } },
    { key: 'gv', label: 'Gap · views', title: 'Place by views a day minus place on the leaderboard', gap: 1, get: function (r) { return r.vPlace - r.rankPlace; } },
    { key: 'ipd', label: 'Interactions a day', title: 'Likes + replies + reposts + quotes a day', get: function (r) { return r.ipd; }, fmt: function (v, r) { return fK(v) + ' <small>#' + r.iPlace + '</small>'; } },
    { key: 'gi', label: 'Gap · interactions', title: 'Place by interactions a day minus place on the leaderboard', gap: 1, get: function (r) { return r.iPlace - r.rankPlace; } }
  ];
  function fGap(g) { return g > 0 ? '<span class="dl up">▲' + g + '</span>' : g < 0 ? '<span class="dl down">▼' + (-g) + '</span>' : '<span class="dl">0</span>'; }
  function placesBy(rows, f, prop) { // 1 = the most; ties share a place
    var sorted = rows.slice().sort(function (a, b) { return f(b) - f(a); });
    sorted.forEach(function (r, i) { r[prop] = i && f(sorted[i - 1]) === f(r) ? sorted[i - 1][prop] : i + 1; });
  }
  function renderEff() {
    var el = $('eff');
    if (!state.stats) { el.innerHTML = ''; return; }
    var avgRank = {};
    if (state.history) stabRows(7).rows.forEach(function (r) { avgRank[r.c.key] = sum(r.pts, function (x) { return x.p; }) / r.pts.length; });
    var rows = state.board.list.filter(function (c) { return c.x && c.x.days; }).map(function (c) {
      return { c: c, rank: avgRank[c.key] != null ? avgRank[c.key] : c.position, ppd: c.x.posts / c.x.days, vpd: c.x.views / c.x.days, ipd: (c.x.interactions || 0) / c.x.days };
    });
    placesBy(rows, function (r) { return -r.rank; }, 'rankPlace');
    placesBy(rows, function (r) { return r.ppd; }, 'pPlace');
    placesBy(rows, function (r) { return r.vpd; }, 'vPlace');
    placesBy(rows, function (r) { return r.ipd; }, 'iPlace');
    var col = EFF.filter(function (a) { return a.key === ins.eff.key; })[0], dir = ins.eff.dir;
    rows.sort(function (a, b) {
      if (col.key === 'handle') return a.c.handle.toLowerCase().localeCompare(b.c.handle.toLowerCase()) * dir;
      return (col.get(a) - col.get(b)) * dir || a.rankPlace - b.rankPlace;
    });
    var shown = ins.effAll ? rows : rows.slice(0, 20);
    var head = EFF.map(function (a) {
      var on = a.key === ins.eff.key;
      return '<th' + (on ? ' aria-sort="' + (dir < 0 ? 'descending' : 'ascending') + '"' : '') + (a.gap ? ' class="eff-gap"' : '') + '><button type="button" class="act-sort' + (on ? ' active' : '') + '" data-eff="' + a.key + '"' + (a.title ? ' title="' + a.title + '"' : '') + '>' + a.label + (on ? (dir < 0 ? ' ▼' : ' ▲') : '') + '</button></th>';
    }).join('');
    var body = shown.map(function (r) {
      return '<tr data-key="' + esc(r.c.key) + '"><td><button type="button" class="tbl-who act-who" data-key="' + esc(r.c.key) + '">' + avatarHtml(r.c, 26) + '<b>@' + esc(r.c.handle) + '</b></button></td>' +
        EFF.slice(1).map(function (a) { return '<td class="' + (a.gap ? 'eff-gap' : '') + (a.key === ins.eff.key ? ' act-on' : '') + '">' + (a.gap ? fGap(a.get(r)) : a.fmt(a.get(r), r)) + '</td>'; }).join('') + '</tr>';
    }).join('');
    // the two ends, in words
    var byGap = rows.slice().sort(function (a, b) { return (b.pPlace - b.rankPlace) - (a.pPlace - a.rankPlace) || a.rankPlace - b.rankPlace; });
    var hi = byGap.slice(0, 3), lo = byGap.slice(-3).reverse();
    var names = function (a) { return a.map(function (r) { return '@' + esc(r.c.handle); }).join(', '); };
    el.innerHTML = '<div class="ins-card card-cut"><div class="ins-head"><div><h3>Rank vs activity</h3><p class="muted">Each creator’s place among ' + rows.length +
      ' creators by posts, views and interactions a day on X, next to their place on Motion’s board (average rank over 7 days). Gaps compare places among these ' + rows.length + ' creators: <b class="up-t">▲</b> means they rank higher than that activity would suggest, <b class="down-t">▼</b> lower. Click a column to sort.</p></div></div>' +
      '<div class="eff-ends"><div><small>Most rank for their posts</small><b>' + names(hi) + '</b></div><div><small>Post the most for their rank</small><b>' + names(lo) + '</b></div></div>' +
      '<div class="tbl-wrap"><table class="tbl act-tbl eff-tbl"><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table></div>' +
      (rows.length > 20 ? '<div class="act-more"><button type="button" class="btn btn-ghost" data-eff-all><span>' + (ins.effAll ? 'Show top 20' : 'Show all ' + rows.length) + '</span></button></div>' : '') +
      '<p class="muted ch-note">X only: Motion also scores Instagram, TikTok and YouTube, so a big ▲ can simply mean a creator is strongest on another platform.</p></div>';
  }
  var xrNarrow = window.innerWidth < 700;
  window.addEventListener('resize', function () { // the scatter is taller on phones
    var n = window.innerWidth < 700;
    if (n !== xrNarrow) { xrNarrow = n; if (document.body.getAttribute('data-tab') === 'insights' && state.board && state.history) renderXr(); }
  });
  function renderInsights() {
    if (!$('wk')) return;
    if (!state.board) { $('wk').innerHTML = '<div class="empty">' + (state.officialError ? 'Couldn’t load Motion’s official leaderboard.' : 'Loading the official leaderboard…') + '</div>'; $('stab').innerHTML = $('xr').innerHTML = $('act').innerHTML = $('eff').innerHTML = ''; return; }
    renderWeek(); renderAct(); renderEff(); renderStab(); renderXr();
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
  var TABS = ['play', 'build', 'leaderboard', 'insights', 'memes', 'about'];
  var pendingCreator = null; // #c/<handle>: open that creator's page once the leaderboard loads
  function creatorFromHash() {
    var m = (location.hash || '').match(/^#c\/([^\/]{1,80})$/);
    if (!m) return null;
    try { return decodeURIComponent(m[1]); } catch (e) { return null; }
  }
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
      if (on && a.parentNode.scrollWidth > a.parentNode.clientWidth) a.parentNode.scrollLeft = a.offsetLeft - (a.parentNode.clientWidth - a.offsetWidth) / 2;
    });
    document.body.setAttribute('data-tab', tab);
    lsSet(LS_TAB, tab);
    if (!keepScroll) window.scrollTo(0, 0);
    // the deck builder's slider and lists are measured on screen: redraw when its tab opens
    if (tab === 'build' && state.board) renderLineup();
    if (tab === 'memes') { loadMemes(); lsSet(LS_MEMES_SEEN, '1'); document.body.classList.add('memes-seen'); }
    if (tab === 'insights') { loadMemes(); renderInsights(); }
  }
  window.addEventListener('hashchange', function () {
    var ch = creatorFromHash();
    if (ch) { if (!document.body.getAttribute('data-tab')) showTab('leaderboard'); pendingCreator = ch; renderAll(); return; }
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
    }).catch(function () { // embeds blocked in this browser: the text version stays
      var wait = el.querySelector('.meme-fallback .muted'); if (wait) wait.textContent = 'The post can’t be shown here. Open it on X instead.';
    });
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
    if (!memes.list) { box.innerHTML = '<div class="motw-head"><span class="motw-tag">Meme of the week</span></div><p class="motw-empty">' + (memes.error ? 'Couldn’t load memes right now.' : 'Loading…') + '</p>'; memes.motwId = null; return; }
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
      var mk = MS.MemeMaker;
      wall.innerHTML = '<div class="empty">No memes on the wall yet. Be the first: post yours on X and submit it above.' +
        (mk ? ' Need one? Pick a template below, add your text and post it.' : '') + '</div>' +
        (mk ? '<div class="mk-grid mk-wall-grid">' + mk.gridHtml('') + '</div>' : '');
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
        m.likes = Math.max(0, Math.round(num(m.likes)));
        m.mediaRatio = num(m.mediaRatio) || null;
        if (!/^https:\/\/pbs\.twimg\.com\//.test(m.media || '')) m.media = '';
        if (!/^https:\/\/pbs\.twimg\.com\//.test(m.authorPic || '')) m.authorPic = '';
      });
      memes.winners = (Array.isArray(r.winners) ? r.winners : []).filter(function (w) { return w && /^\d{5,25}$/.test(w.id); })
        .map(function (w) { return { id: w.id, likes: Math.max(0, Math.round(num(w.likes))), weekStart: w.weekStart, weekEnd: w.weekEnd }; });
      memes.nextReveal = r.nextReveal || null;
      memes.error = null;
    }).catch(function (e) {
      if (/unknown mode/.test(e.message)) memes.list = []; // server not updated yet: just an empty wall
      else memes.error = e.message;
    }).then(function () {
      memes.loading = false; memes.shown = MEMES_PAGE; memes.motwId = null; renderMemes();
      if (document.body.getAttribute('data-tab') === 'insights' && state.board && state.history) renderWeek();
    });
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
  // Creator picker: a searchable list with avatars (replaces a plain <select>, which can't be searched or styled).
  // It opens inline, inside the form card, because the card's clip-path would cut off a floating dropdown.
  var cpick = (function () {
    var val = $('meme-creator'), btn = $('cpick-btn'), pop = $('cpick-pop'), q = $('cpick-search'), ul = $('cpick-list');
    var items = [], shown = [], active = 0;
    function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
    function people() {
      var board = {};
      (state.board ? state.board.list : []).forEach(function (c) { board[c.key] = c; });
      return (MS.CREATORS || []).filter(function (c) { return c.x; }).map(function (c) {
        var key = c.x.toLowerCase(), b = board[key];
        return { key: key, name: c.name, handle: c.x, avatar: b ? b.avatar : null, rank: b ? b.position : null, s: norm(c.name + ' ' + c.x) };
      }).sort(function (a, b) { return a.name.localeCompare(b.name); });
    }
    function find(key) { return items.filter(function (c) { return c.key === key; })[0]; }
    function renderBtn() {
      var c = find(val.value) || (val.value ? CREATOR_BY_X[val.value] && { name: CREATOR_BY_X[val.value].name, handle: CREATOR_BY_X[val.value].x } : null);
      btn.innerHTML = c
        ? avatarHtml(c, 26) + '<span class="cpick-who"><b>' + esc(c.name) + '</b><small>@' + esc(c.handle) + '</small></span><i class="cpick-caret" aria-hidden="true"></i>'
        : '<span class="cpick-none">No creator</span><i class="cpick-caret" aria-hidden="true"></i>';
    }
    function rowHtml(c, i) {
      var on = c ? c.key === val.value : !val.value;
      return '<li role="option" id="cpick-o' + i + '" data-i="' + i + '" class="cpick-opt' + (i === active ? ' is-active' : '') + '" aria-selected="' + on + '">' +
        (c ? avatarHtml(c, 28) + '<span class="cpick-who"><b>' + esc(c.name) + '</b><small>@' + esc(c.handle) + '</small></span>' + (c.rank ? '<span class="cpick-rank">#' + c.rank + '</span>' : '')
           : '<span class="cpick-noava" aria-hidden="true">—</span><span class="cpick-who"><b>No creator</b><small>The meme isn’t about anyone in particular</small></span>') + '</li>';
    }
    function renderList() {
      var t = norm(q.value.trim().replace(/^@/, ''));
      shown = t ? items.filter(function (c) { return c.s.indexOf(t) >= 0; }) : [null].concat(items);
      if (t) shown.sort(function (a, b) { return (a.s.indexOf(t) === 0 ? 0 : 1) - (b.s.indexOf(t) === 0 ? 0 : 1); });
      if (active >= shown.length) active = Math.max(0, shown.length - 1);
      ul.innerHTML = shown.length ? shown.map(rowHtml).join('') : '<li class="cpick-empty">No creator matches “' + esc(q.value.trim()) + '”</li>';
      q.setAttribute('aria-activedescendant', shown.length ? 'cpick-o' + active : '');
    }
    function moveTo(i) {
      if (!shown.length) return;
      active = (i + shown.length) % shown.length;
      Array.prototype.forEach.call(ul.children, function (li) { li.classList.toggle('is-active', +li.dataset.i === active); });
      var li = $('cpick-o' + active);
      if (li) li.scrollIntoView({ block: 'nearest' });
      q.setAttribute('aria-activedescendant', 'cpick-o' + active);
    }
    function open() {
      items = people();
      q.value = '';
      active = 0;
      renderList();
      var cur = shown.map(function (c) { return c ? c.key : ''; }).indexOf(val.value);
      pop.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
      $('cpick').classList.add('is-open');
      if (cur > 0) moveTo(cur);
      q.focus();
    }
    function close(focusBtn) {
      if (pop.hidden) return;
      pop.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
      $('cpick').classList.remove('is-open');
      if (focusBtn) btn.focus();
    }
    function choose(i) {
      var c = shown[i];
      if (c === undefined) return;
      val.value = c ? c.key : '';
      renderBtn();
      close(true);
    }
    btn.addEventListener('click', function () { if (pop.hidden) open(); else close(true); });
    q.addEventListener('input', function () { active = 0; renderList(); ul.scrollTop = 0; });
    q.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); moveTo(active + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); moveTo(active - 1); }
      else if (e.key === 'Enter') { e.preventDefault(); choose(active); }
      else if (e.key === 'Escape') { e.preventDefault(); close(true); }
      else if (e.key === 'Tab') close(false);
    });
    ul.addEventListener('mousedown', function (e) { e.preventDefault(); });
    ul.addEventListener('click', function (e) {
      var li = e.target.closest('[data-i]');
      if (li) choose(+li.dataset.i);
    });
    document.addEventListener('click', function (e) { if (!$('cpick').contains(e.target)) close(false); });
    items = people();
    renderBtn();
    return { reset: function () { val.value = ''; renderBtn(); }, refresh: function () { items = people(); renderBtn(); } };
  })();
  // A link to a post on X → https://x.com/<user>/status/<id>, or null.
  function postLink(raw) {
    var u;
    try { u = new URL(/^https?:\/\//i.test(raw) ? raw : 'https://' + raw); } catch (e) { return null; }
    if (!/^https?:$/.test(u.protocol) || u.username || u.password || u.port) return null;
    if (!/^(www\.|mobile\.)?(x|twitter)\.com$/i.test(u.hostname)) return null;
    var m = u.pathname.match(/^\/(\w{1,15})\/status(?:es)?\/(\d{5,25})(?:\/(?:photo|video)\/\d{1,2})?\/?$/i);
    return m ? 'https://x.com/' + m[1] + '/status/' + m[2] : null;
  }
  (function initMemeForm() {
    var sel = $('meme-creator');
    $('meme-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var url = postLink($('meme-url').value.trim()), st = $('meme-status');
      if (!url) {
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
        if (!r.duplicate) { $('meme-url').value = ''; cpick.reset(); }
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

  function refocus(sel) { var el = document.querySelector(sel); if (el) el.focus(); }

  /* ---------- events ---------- */
  document.addEventListener('click', function (e) {
    var t = e.target;
    var closer = t.closest('[data-close]');
    if (closer) { closer.closest('dialog').close(); return; }
    if (t.tagName === 'DIALOG') { t.close(); return; } // click on backdrop
    var wkb = t.closest('[data-wk]');
    if (wkb) { ins.week = +wkb.dataset.wk; ins.weekPicked = true; renderWeek(); refocus('[data-wk="' + ins.week + '"]'); return; }
    var stb = t.closest('[data-stab]');
    if (stb) { ins.stabTop = stb.dataset.stab === 'top'; renderStab(); refocus('[data-stab="' + stb.dataset.stab + '"]'); return; }
    var ab = t.closest('[data-act]');
    if (ab) {
      var k = ab.dataset.act;
      ins.act = ins.act.key === k ? { key: k, dir: -ins.act.dir } : { key: k, dir: k === 'handle' || k === 'rank' || k === 'avg' ? 1 : -1 };
      renderAct();
      var again = document.querySelector('[data-act="' + k + '"]'); if (again) again.focus();
      return;
    }
    if (t.closest('[data-act-all]')) { ins.actAll = !ins.actAll; renderAct(); refocus('[data-act-all]'); return; }
    var eb = t.closest('[data-eff]');
    if (eb) {
      var ek = eb.dataset.eff;
      ins.eff = ins.eff.key === ek ? { key: ek, dir: -ins.eff.dir } : { key: ek, dir: ek === 'handle' || ek === 'rank' ? 1 : -1 };
      renderEff();
      var again2 = document.querySelector('[data-eff="' + ek + '"]'); if (again2) again2.focus();
      return;
    }
    if (t.closest('[data-eff-all]')) { ins.effAll = !ins.effAll; renderEff(); refocus('[data-eff-all]'); return; }
    if (t.closest('#ml-keep')) { saveLineup(); return; }
    var mlr = t.closest('[data-ml-remove]');
    if (mlr) { state.lineup = state.lineup.filter(function (k) { return k !== mlr.dataset.mlRemove; }); saveLineup(); return; }
    var xrb = t.closest('[data-xr]');
    if (xrb) { ins.xr = xrb.dataset.xr; renderXr(); refocus('[data-xr="' + ins.xr + '"]'); return; }
    var cl = t.closest('[data-copy-link]');
    if (cl) {
      var link = creatorLink(cl.dataset.copyLink), done = function (ok) { cl.textContent = ok ? 'Link copied' : link; setTimeout(function () { cl.textContent = 'Copy link to this page'; }, 2500); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(link).then(function () { done(true); }, function () { done(false); });
      else done(false);
      return;
    }
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

  // closing a creator's page puts the tab back in the address bar
  $('detail').addEventListener('close', function () {
    if (creatorFromHash()) history.replaceState(null, '', '#' + (document.body.getAttribute('data-tab') || 'leaderboard'));
  });

  /* ---------- boot ---------- */
  try { applySaved(JSON.parse(lsGet(LS_SET) || '{}') || {}); } catch (e) { /* ignore bad settings */ }
  state.onlyMine = lsGet('motionScout.onlyMine.v1') !== '0';
  state.cfg.lineup.starCap = Math.round(Math.min(CAP_MAX, Math.max(CAP_MIN, state.cfg.lineup.starCap)));
  ['motionScout.data.v1', 'motionScout.source.v1', 'motionScout.self.v1'].forEach(lsDel); // left over from older versions
  renderHow();
  renderAll();
  (function () {
    pendingCreator = creatorFromHash();
    var tab = pendingCreator ? 'leaderboard' : tabFromHash() || lsGet(LS_TAB) || 'play';
    if (TABS.indexOf(tab) < 0) tab = 'play';
    if (!pendingCreator && location.hash.replace(/^#/, '') !== tab) history.replaceState(null, '', '#' + tab);
    showTab(tab);
  })();
  loadOfficial();
  if (state.cfg.apiUrl) { loadStats(); loadHistory(); } else { state.statsError = 'no server URL'; state.historyError = 'no server URL'; }
})();
