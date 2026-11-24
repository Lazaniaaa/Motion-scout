/* Countdown to Motion's 11.30.2026 drop (00:00 UTC, 30 Nov): a small floating pill, and a big countdown when you click it.
 * Self-contained: builds its own elements. Gone once the moment has passed. */
(function () {
  'use strict';
  var TARGET = Date.UTC(2026, 10, 30, 0, 0, 0);
  var SS_HIDE = 'motionScout.countdownHidden.v1';
  if (Date.now() >= TARGET || !document.body) return;
  try { if (window.sessionStorage.getItem(SS_HIDE)) return; } catch (e) { /* storage unavailable: show it */ }

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function left() {
    var s = Math.max(0, Math.floor((TARGET - Date.now()) / 1000));
    return { d: Math.floor(s / 86400), h: Math.floor(s % 86400 / 3600), m: Math.floor(s % 3600 / 60), s: s % 60, done: s === 0 };
  }

  var pill = document.createElement('div');
  pill.className = 'cd-float';
  pill.innerHTML = '<button type="button" class="cd-open" aria-haspopup="dialog" aria-label="Countdown to 11.30.2026">' +
    '<span class="cd-dot" aria-hidden="true"></span><span class="cd-lbl">11.30</span><span class="cd-mini"></span></button>' +
    '<button type="button" class="cd-hide" aria-label="Hide the countdown">×</button>';

  var UNITS = [['d', 'Days'], ['h', 'Hours'], ['m', 'Minutes'], ['s', 'Seconds']];
  var local = new Date(TARGET).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  var dlg = document.createElement('dialog');
  dlg.className = 'cd-dlg';
  dlg.setAttribute('aria-labelledby', 'cd-title');
  dlg.innerHTML = '<button type="button" class="cd-x" data-close aria-label="Close">×</button>' +
    '<p class="cd-kicker">@motiongame_ · countdown</p><h2 id="cd-title" class="cd-date">11.30.2026</h2>' +
    '<div class="cd-grid">' + UNITS.map(function (u, i) {
      return (i ? '<span class="cd-sep" aria-hidden="true">:</span>' : '') +
        '<div class="cd-unit" style="--i:' + i + '"><b data-u="' + u[0] + '">00</b><span>' + u[1] + '</span></div>';
    }).join('') + '</div>' +
    '<p class="cd-local">Motion announced the date only, not the time. This counts down to the start of 30 November, 00:00 UTC (' + local + ' your time).</p>' +
    '<a class="cd-link" href="https://x.com/motiongame_" target="_blank" rel="noopener">Follow @motiongame_ on X</a>' +
    '<div class="cd-clip" hidden><span>Download a video clip</span>' +
    '<button type="button" class="cd-clip-btn" data-clip="5">5 s</button><button type="button" class="cd-clip-btn" data-clip="10">10 s</button>' +
    '<p class="cd-clip-status" aria-live="polite"></p></div>';

  document.body.appendChild(pill);
  document.body.appendChild(dlg);
  var mini = pill.querySelector('.cd-mini');
  var cells = {};
  UNITS.forEach(function (u) { cells[u[0]] = dlg.querySelector('[data-u="' + u[0] + '"]'); });

  var timer;
  function tick() {
    var t = left();
    mini.textContent = t.d + 'd ' + pad(t.h) + ':' + pad(t.m) + ':' + pad(t.s);
    if (dlg.open) {
      UNITS.forEach(function (u) {
        var el = cells[u[0]], v = pad(t[u[0]]);
        if (el.textContent === v) return;
        el.textContent = v;
        el.classList.remove('tick'); void el.offsetWidth; el.classList.add('tick'); // replay the drop-in
      });
    }
    if (t.done) {
      clearInterval(timer);
      mini.textContent = 'It’s time';
      dlg.querySelector('.cd-kicker').textContent = '@motiongame_ · it’s time';
    }
  }

  pill.querySelector('.cd-open').addEventListener('click', function () {
    dlg.classList.remove('cd-in');
    tick();
    if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
    void dlg.offsetWidth; dlg.classList.add('cd-in');
  });
  pill.querySelector('.cd-hide').addEventListener('click', function () {
    try { window.sessionStorage.setItem(SS_HIDE, '1'); } catch (e) { /* hide for this page only */ }
    pill.remove();
  });
  // Backdrop click and the × close it (app.js handles [data-close] and backdrop clicks; this works without it too).
  dlg.addEventListener('click', function (e) { if (e.target === dlg || e.target.closest('[data-close]')) dlg.close(); });

  tick();
  timer = setInterval(tick, 1000);

  /* ---------- video clip: the same countdown drawn on a canvas and recorded in the browser ---------- */
  var REC_TYPES = ['video/mp4;codecs=avc1.42E01F', 'video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];
  function recType() {
    if (!window.MediaRecorder || !window.HTMLCanvasElement || !HTMLCanvasElement.prototype.captureStream) return null;
    for (var i = 0; i < REC_TYPES.length; i++) if (MediaRecorder.isTypeSupported(REC_TYPES[i])) return REC_TYPES[i];
    return null;
  }
  function ease(x) { x = Math.min(1, Math.max(0, x)); return 1 - Math.pow(1 - x, 3); }
  // Centered text with letter spacing (the spacing also trails the last letter, so shift by half of it).
  function text(ctx, s, x, y, spacing) {
    if ('letterSpacing' in ctx) { ctx.letterSpacing = spacing + 'px'; x += spacing / 2; }
    ctx.fillText(s, x, y);
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  }
  var CLIP_UNITS = [['d', 'DAYS'], ['h', 'HOURS'], ['m', 'MINUTES'], ['s', 'SECONDS']];
  // el: ms since the clip started; last: per unit, the value shown and when it last changed.
  function drawFrame(ctx, W, H, el, last) {
    var t = left();
    ctx.globalAlpha = 1; ctx.filter = 'none'; ctx.shadowBlur = 0;
    ctx.fillStyle = '#020a18'; ctx.fillRect(0, 0, W, H);
    var g = ctx.createRadialGradient(W / 2, -H * 0.2, 0, W / 2, -H * 0.2, W * 0.75);
    g.addColorStop(0, 'rgba(255,57,119,0.36)'); g.addColorStop(1, 'rgba(255,57,119,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    var g2 = ctx.createRadialGradient(W / 2, H * 1.25, 0, W / 2, H * 1.25, W * 0.6);
    g2.addColorStop(0, 'rgba(122,253,253,0.2)'); g2.addColorStop(1, 'rgba(122,253,253,0)');
    ctx.fillStyle = g2; ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';

    ctx.globalAlpha = ease(el / 600);
    ctx.fillStyle = '#93A6C4'; ctx.font = '700 22px "Barlow Condensed", "Arial Narrow", sans-serif';
    text(ctx, '@MOTIONGAME_ · COUNTDOWN', W / 2, 118, 7);

    var dp = ease(el / 1200);
    ctx.globalAlpha = dp; ctx.fillStyle = '#FF3977'; ctx.font = '400 96px Anton, Impact, sans-serif';
    ctx.shadowColor = 'rgba(255,57,119,0.55)'; ctx.shadowBlur = 40;
    text(ctx, '11.30.2026', W / 2, 232, 96 * (0.6 - 0.52 * dp));
    ctx.shadowBlur = 0;

    var gap = 278, size = 210, y = 488;
    CLIP_UNITS.forEach(function (u, i) {
      var x = W / 2 + (i - 1.5) * gap, v = pad(t[u[0]]), L = last[u[0]] || (last[u[0]] = { v: v, at: -1e9 });
      if (L.v !== v) { L.v = v; L.at = el; }
      var p = ease((el - 150 - i * 130) / 900), k = ease((el - L.at) / 450);
      if (i) { // blinking separator before this unit
        ctx.globalAlpha = Math.min(1, el / 900) * (Math.floor(el / 500) % 2 ? 0.25 : 0.75);
        ctx.fillStyle = '#FF3977'; ctx.font = '400 150px Anton, Impact, sans-serif';
        ctx.fillText(':', x - gap / 2, y - 22);
      }
      ctx.save();
      ctx.globalAlpha = p * (0.3 + 0.7 * k);
      ctx.translate(x, y - size * 0.38 - size * 0.16 * (1 - k));
      ctx.scale(1.7 - 0.7 * p, 1.7 - 0.7 * p);
      if (p < 1) ctx.filter = 'blur(' + (14 * (1 - p)).toFixed(1) + 'px)';
      ctx.fillStyle = '#FFFFFF'; ctx.font = '400 ' + size + 'px Anton, Impact, sans-serif';
      ctx.shadowColor = 'rgba(122,253,253,0.4)'; ctx.shadowBlur = 44;
      ctx.fillText(v, 0, size * 0.38);
      ctx.restore();
      ctx.globalAlpha = p; ctx.fillStyle = '#93A6C4'; ctx.font = '700 22px "Barlow Condensed", "Arial Narrow", sans-serif';
      text(ctx, u[1], x, y + 48, 6);
    });

    ctx.globalAlpha = ease((el - 900) / 600);
    ctx.fillStyle = '#93A6C4'; ctx.font = '400 22px Barlow, system-ui, sans-serif';
    text(ctx, 'Date only, no time announced · counting to 00:00 UTC, 30 November', W / 2, 626, 0);
    ctx.fillStyle = '#7AFDFD'; ctx.font = '700 18px "Barlow Condensed", "Arial Narrow", sans-serif';
    text(ctx, 'MOTION-SCOUT.VERCEL.APP', W / 2, 676, 4);
    ctx.globalAlpha = 1;
  }

  var clipBox = dlg.querySelector('.cd-clip'), clipStatus = dlg.querySelector('.cd-clip-status'), clipBusy = false;
  var REC = recType();
  if (REC) clipBox.hidden = false;
  function setBusy(b) { clipBusy = b; [].forEach.call(dlg.querySelectorAll('.cd-clip-btn'), function (x) { x.disabled = b; }); }
  function recordClip(sec) {
    if (clipBusy || !REC) return;
    setBusy(true);
    clipStatus.textContent = 'Getting ready…';
    var W = 1280, H = 720, cv = document.createElement('canvas');
    cv.width = W; cv.height = H; cv.className = 'cd-rec-canvas';
    document.body.appendChild(cv);
    var ctx = cv.getContext('2d');
    var fonts = document.fonts && document.fonts.load
      ? Promise.all([document.fonts.load('400 100px Anton'), document.fonts.load('700 20px "Barlow Condensed"'), document.fonts.load('400 20px Barlow')])
      : Promise.resolve();
    fonts.catch(function () { /* draw with fallback fonts */ }).then(function () {
      var stream = cv.captureStream(30), chunks = [], last = {}, raf, start;
      var rec = new MediaRecorder(stream, { mimeType: REC, videoBitsPerSecond: 8000000 });
      rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
      rec.onerror = function () { finish(null); };
      rec.onstop = function () { finish(new Blob(chunks, { type: REC.split(';')[0] })); };
      function finish(blob) {
        clearInterval(raf);
        stream.getTracks().forEach(function (tr) { tr.stop(); });
        cv.remove();
        setBusy(false);
        if (!blob || !blob.size) { clipStatus.textContent = 'Couldn’t record the clip. Please try again.'; return; }
        var mp4 = /mp4/.test(REC), a = document.createElement('a'), url = URL.createObjectURL(blob);
        a.href = url; a.download = 'motion-countdown-' + sec + 's.' + (mp4 ? 'mp4' : 'webm');
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
        clipStatus.textContent = mp4 ? 'Saved ' + a.download + '.' : 'Saved ' + a.download + '. X needs MP4: record it in Chrome, Edge or Safari for an MP4 file.';
      }
      // A 30 fps timer, not requestAnimationFrame: it keeps drawing even if the page is briefly not painted.
      function frame() {
        var el = performance.now() - start;
        drawFrame(ctx, W, H, el, last);
        clipStatus.textContent = 'Recording… ' + Math.min(sec, Math.floor(el / 1000) + 1) + ' / ' + sec + ' s. Keep this tab open.';
        if (el >= sec * 1000) { clearInterval(raf); rec.stop(); }
      }
      start = performance.now();
      drawFrame(ctx, W, H, 0, last);
      rec.start(250);
      raf = setInterval(frame, 1000 / 30);
    });
  }
  dlg.addEventListener('click', function (e) {
    var b = e.target.closest('[data-clip]');
    if (b) recordClip(+b.dataset.clip);
  });
})();
