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
    '<p class="cd-local">00:00 UTC on 30 November · ' + local + ' your time</p>' +
    '<a class="cd-link" href="https://x.com/motiongame_" target="_blank" rel="noopener">Follow @motiongame_ on X</a>';

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
})();
