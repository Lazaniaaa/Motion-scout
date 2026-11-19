/* Motion Scout API client (public). The page never scores anything itself: it asks the
 * Apps Script Web App (apps-script/Code.gs), which keeps the formula private.
 *
 *   live()             GET  <apiUrl>?mode=scores          scores of the live creator pool
 *   score(csv, self)   POST {mode:'score', csv, self}     scores an uploaded / demo CSV (+ optional self-check)
 *   check(self)        POST {mode:'check', self}          self-check against the live pool
 *
 * Every call resolves to { meta, errors, warnings, creators, self?, selfErrors? }.
 * In local development MS.localApi (js/local-api.js, never published) answers instead,
 * unless the page URL has ?server.
 */
(function (root) {
  'use strict';
  var MS = (root.MotionScout = root.MotionScout || {});

  function local() {
    return MS.localApi && !/[?&]server\b/.test(String(root.location && root.location.search || '')) ? MS.localApi : null;
  }
  function parse(r) {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.text().then(function (t) {
      var j;
      try { j = JSON.parse(t); } catch (e) { throw new Error('the server answered in an old format (redeploy apps-script/Code.gs)'); }
      if (!j || typeof j !== 'object') throw new Error('unexpected answer from the server');
      if (j.error) throw new Error(j.error);
      return j;
    });
  }
  function post(url, body) {
    // text/plain keeps it a "simple" request: no CORS preflight, which Apps Script can't answer.
    return fetch(url, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'text/plain;charset=utf-8' }, redirect: 'follow' }).then(parse);
  }

  MS.api = {
    isLocal: function () { return !!local(); },
    live: function (cfg) {
      var l = local(); if (l) return l.live(cfg);
      if (!cfg.apiUrl) return Promise.reject(new Error('no server URL'));
      return fetch(cfg.apiUrl + (cfg.apiUrl.indexOf('?') < 0 ? '?' : '&') + 'mode=scores', { cache: 'no-store', redirect: 'follow' }).then(parse);
    },
    // Official leaderboard snapshots logged by the server: { names: [...], snapshots: [{ t, p: [...] }] }.
    // Always the real server (there's no local copy of the history).
    history: function (cfg) {
      if (!cfg.apiUrl) return Promise.reject(new Error('no server URL'));
      return fetch(cfg.apiUrl + (cfg.apiUrl.indexOf('?') < 0 ? '?' : '&') + 'mode=history', { cache: 'no-store', redirect: 'follow' }).then(parse);
    },
    // "Report a problem / Suggest an idea": the server saves it and forwards it to the owner.
    feedback: function (cfg, msg) {
      if (!cfg.apiUrl) return Promise.reject(new Error('no server URL'));
      return post(cfg.apiUrl, { mode: 'feedback', type: msg.type, message: msg.message, contact: msg.contact, page: msg.page, website: msg.website });
    },
    // Memes wall: approved memes with like counts, submitting a post on X, one like per browser.
    memes: function (cfg) {
      if (!cfg.apiUrl) return Promise.reject(new Error('no server URL'));
      return fetch(cfg.apiUrl + (cfg.apiUrl.indexOf('?') < 0 ? '?' : '&') + 'mode=memes', { cache: 'no-store', redirect: 'follow' }).then(parse);
    },
    submitMeme: function (cfg, m) {
      if (!cfg.apiUrl) return Promise.reject(new Error('no server URL'));
      return post(cfg.apiUrl, { mode: 'meme', url: m.url, creator: m.creator, website: m.website });
    },
    likeMeme: function (cfg, id, voter, undo) {
      if (!cfg.apiUrl) return Promise.reject(new Error('no server URL'));
      return post(cfg.apiUrl, { mode: 'meme_like', id: id, voter: voter, undo: !!undo });
    },
    score: function (cfg, csv, self) {
      var l = local(); if (l) return l.score(cfg, csv, self);
      if (!cfg.apiUrl) return Promise.reject(new Error('no server URL'));
      return post(cfg.apiUrl, { mode: 'score', csv: csv, self: self || null });
    },
    check: function (cfg, self) {
      var l = local(); if (l) return l.check(cfg, self);
      if (!cfg.apiUrl) return Promise.reject(new Error('no server URL'));
      return post(cfg.apiUrl, { mode: 'check', self: self });
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
