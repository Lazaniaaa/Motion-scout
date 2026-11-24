/* Vercel function: a cached copy of the Apps Script data (GET /api/data?mode=scores|history).
 * The Apps Script Web App answers slowly (1–2 s) and only a few requests at a time, so Vercel's CDN keeps the
 * answer for a few minutes and every visitor gets that copy. Google sees about one request per mode every few minutes.
 * Only reads go through here; feedback, memes and likes still go straight to Apps Script.
 */
'use strict';

const UPSTREAM = 'https://script.google.com/macros/s/AKfycbx8DoQw-yWY3wmGXbXNDd0NSfNaZLTVdoqDrvbF3dJ--ydsfumsfH1MyJ4W6h6pXiki_g/exec';
const FRESH = { scores: 300, history: 300 }; // seconds the CDN serves a copy before asking Google again

module.exports = async function (req, res) {
  const mode = String((req.query && req.query.mode) || '');
  if (!Object.prototype.hasOwnProperty.call(FRESH, mode)) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(400).json({ error: 'unknown mode' });
    return;
  }
  try {
    const r = await fetch(UPSTREAM + '?mode=' + mode, { redirect: 'follow', signal: AbortSignal.timeout(25000) });
    const text = await r.text();
    if (!r.ok) throw new Error('upstream HTTP ' + r.status);
    const j = JSON.parse(text); // only valid JSON is ever cached
    if (!j || typeof j !== 'object' || j.error) throw new Error('upstream error');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    // s-maxage: the CDN copy is fresh this long; after that it's served once more while a new one is fetched,
    // and if Google fails, the last good copy keeps being served for up to a day.
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=' + FRESH[mode] + ', stale-while-revalidate=3600, stale-if-error=86400');
    res.status(200).send(text);
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(502).json({ error: 'the data server did not answer, please try again' });
  }
};
