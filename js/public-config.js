/* Motion Scout — public settings for the page.
 * No formula here: the scores come from the Apps Script Web App (apps-script/Code.gs),
 * which keeps the formula private. Only official game rules and URLs live in this file.
 */
(function (root) {
  'use strict';
  var MS = (root.MotionScout = root.MotionScout || {});

  MS.PUBLIC_CONFIG = {
    // Web App URL of apps-script/Code.gs: returns scores (GET) and scores uploaded data / self-checks (POST).
    apiUrl: 'https://script.google.com/macros/s/AKfycbx8DoQw-yWY3wmGXbXNDd0NSfNaZLTVdoqDrvbF3dJ--ydsfumsfH1MyJ4W6h6pXiki_g/exec',

    // Motion's public leaderboard (rank only, no scores). Shown as "Official #N". Empty = off.
    officialUrl: 'https://leaderboard.motion.game/api/leaderboard',

    // Length of the scoring window in days (labels of the "Check yourself" form).
    windowDays: 14,

    // Official game rules (docs.motion.game): five different creators, star cap, card boosts.
    lineup: { size: 5, starCap: 32 },
    cardBoosts: { common: 1, rare: 1.5, epic: 2, legendary: 2.5 },

    // "Undervalued" = predicted stars at least this many above the creator's real stars.
    undervaluedMinGap: 1,

    // Predicted star split, same as Fantasy Top's published tiers: 8★ = top 7% … 1★ = bottom 7%.
    // Shown in "How it works"; the scores themselves come from the server.
    starBands: [0, 7, 18, 32, 50, 68, 82, 93]
  };

  MS.clonePublicConfig = function () { return JSON.parse(JSON.stringify(MS.PUBLIC_CONFIG)); };
})(typeof window !== 'undefined' ? window : globalThis);
