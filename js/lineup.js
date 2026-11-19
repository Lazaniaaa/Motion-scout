/* Public helpers that use only official game rules (no Motion Scout formula):
 *   best(creators, cfg, boosts)  best lineup under the star cap, Lineup Score = sum of pts × card boost
 *   spearman(a, b)               rank correlation, to compare our order with the official leaderboard
 */
(function (root) {
  'use strict';
  var MS = (root.MotionScout = root.MotionScout || {});

  // 0/1 knapsack: exactly `size` creators, total stars <= cap, max sum of (points × boost).
  // `boosts` (optional): { creatorKey: boost } for the cards you own. When given, only those
  // creators are used; otherwise every creator counts with a 1× (Common) card.
  // Uses real stars when known, otherwise predicted stars (flagged in the result).
  // opts.onlyOwned (default true): with boosts given, use only those creators; false = everyone,
  // with your boost where you own the card and 1× elsewhere.
  function best(creators, cfg, boosts, opts) {
    var size = cfg.lineup.size, cap = cfg.lineup.starCap;
    var owned = boosts && Object.keys(boosts).length ? boosts : null;
    var onlyOwned = !opts || opts.onlyOwned !== false;
    var pool = owned && onlyOwned ? creators.filter(function (c) { return owned[c.key] > 0; }) : creators;
    if (pool.length < size) {
      return { error: owned && onlyOwned
        ? 'Your cards cover ' + pool.length + ' creator' + (pool.length === 1 ? '' : 's') + ' in this data. A lineup needs ' + size + ' different creators: add more in My cards, or turn off “Only creators I own”.'
        : 'Need at least ' + size + ' creators for a lineup.' };
    }
    var cands = pool.map(function (c) {
      var boost = owned ? owned[c.key] || 1 : 1;
      return { c: c, stars: c.stars != null ? c.stars : c.predictedStars, predicted: c.stars == null,
        boost: boost, contribution: c.points * boost };
    });
    var dp = [];
    for (var j = 0; j <= size; j++) { dp.push(new Array(cap + 1).fill(null)); }
    dp[0][0] = { score: 0, picks: [] };
    cands.forEach(function (cand, idx) {
      for (var j = size - 1; j >= 0; j--) {
        for (var s = cap - cand.stars; s >= 0; s--) {
          var cur = dp[j][s];
          if (!cur) continue;
          var score = cur.score + cand.contribution;
          var nxt = dp[j + 1][s + cand.stars];
          if (!nxt || score > nxt.score) dp[j + 1][s + cand.stars] = { score: score, picks: cur.picks.concat(idx) };
        }
      }
    });
    var top = null, topStars = 0;
    dp[size].forEach(function (cell, s) { if (cell && (!top || cell.score > top.score)) { top = cell; topStars = s; } });
    if (!top) {
      var cheapest = cands.map(function (c) { return c.stars; }).sort(function (a, b) { return a - b; }).slice(0, size)
        .reduce(function (a, b) { return a + b; }, 0);
      return { error: 'No ' + size + '-creator deck fits under ' + cap + '★: the ' + size + ' lowest-star creators here already add up to ' + cheapest + '★. Raise the cap to at least ' + cheapest + '★.' };
    }
    var picks = top.picks.map(function (i) { return cands[i]; })
      .sort(function (a, b) { return b.contribution - a.contribution; });
    return {
      picks: picks, score: top.score, stars: topStars, cap: cap, usesCards: !!owned,
      usesPredicted: picks.some(function (p) { return p.predicted; })
    };
  }

  function ranks(values) {
    var n = values.length;
    return values.map(function (v) {
      var below = 0, equal = 0;
      for (var i = 0; i < n; i++) { if (values[i] < v) below++; else if (values[i] === v) equal++; }
      return below + (equal - 1) / 2;
    });
  }

  // Spearman rank correlation (-1 … 1), ties averaged. Null when fewer than 3 pairs.
  function spearman(a, b) {
    var n = a.length;
    if (n < 3 || b.length !== n) return null;
    var ra = ranks(a), rb = ranks(b), ma = (n - 1) / 2, mb = (n - 1) / 2, cov = 0, va = 0, vb = 0;
    for (var i = 0; i < n; i++) {
      cov += (ra[i] - ma) * (rb[i] - mb);
      va += (ra[i] - ma) * (ra[i] - ma);
      vb += (rb[i] - mb) * (rb[i] - mb);
    }
    return va > 0 && vb > 0 ? cov / Math.sqrt(va * vb) : null;
  }

  MS.lineup = { best: best, spearman: spearman };
})(typeof window !== 'undefined' ? window : globalThis);
