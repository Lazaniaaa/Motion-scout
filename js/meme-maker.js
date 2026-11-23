/* Motion Scout · meme maker
   Pick a template (or your own picture), add text, then download it or post it on X.
   Templates are the popular blanks from imgflip's public API, loaded straight from imgflip (CORS-enabled),
   so the finished picture is drawn on a canvas in the browser and never touches a server. */
(function (root) {
  'use strict';
  var MS = (root.MotionScout = root.MotionScout || {});
  var IMG = 'https://i.imgflip.com/';
  var FONT = "Anton, Impact, 'Arial Narrow Bold', sans-serif";
  var POST_TEXT = 'My Motion meme 🖼️\n\n@motiongame_\nMade on motion-scout.vercel.app/#memes';

  // Text boxes: [centre x, centre y, width], as fractions of the picture.
  var TB = [[0.5, 0.1, 0.94], [0.5, 0.9, 0.94]];
  var LEFT4 = [[0.25, 0.125, 0.46], [0.25, 0.375, 0.46], [0.25, 0.625, 0.46], [0.25, 0.875, 0.46]];
  var PAIR = [[0.25, 0.1, 0.46], [0.75, 0.1, 0.46]];
  var TEMPLATES = [
    ['30b1gx.jpg', 'Drake Hotline Bling', 1200, 1200, [[0.75, 0.25, 0.46], [0.75, 0.75, 0.46]]],
    ['1g8my4.jpg', 'Two Buttons', 600, 908, [[0.29, 0.13, 0.3], [0.62, 0.09, 0.3], [0.5, 0.9, 0.9]]],
    ['1ur9b0.jpg', 'Distracted Boyfriend', 1200, 800, [[0.3, 0.8, 0.34], [0.6, 0.55, 0.26], [0.84, 0.72, 0.28]]],
    ['3oevdk.jpg', 'Once Again Asking', 750, 750, TB],
    ['3lmzyx.jpg', 'UNO Draw 25 Cards', 500, 494, [[0.27, 0.36, 0.3], [0.72, 0.1, 0.5]]],
    ['46e43q.png', 'Always Has Been', 960, 540, [[0.33, 0.25, 0.4], [0.72, 0.12, 0.45]]],
    ['22bdq6.jpg', 'Left Exit 12 Off Ramp', 804, 767, [[0.37, 0.18, 0.22], [0.63, 0.18, 0.22], [0.55, 0.82, 0.4]]],
    ['5c7lwq.png', 'Anakin Padme 4 Panel', 768, 768, [[0.25, 0.43, 0.46], [0.75, 0.43, 0.46], [0.75, 0.93, 0.46]]],
    ['26jxvz.jpg', 'Gru’s Plan', 700, 449, [[0.37, 0.3, 0.18], [0.87, 0.3, 0.18], [0.37, 0.78, 0.18], [0.87, 0.78, 0.18]]],
    ['28j0te.jpg', 'Epic Handshake', 900, 645, [[0.2, 0.7, 0.34], [0.8, 0.7, 0.34], [0.5, 0.3, 0.3]]],
    ['23ls.jpg', 'Disaster Girl', 500, 375, TB],
    ['2fm6x.jpg', 'Waiting Skeleton', 298, 403, TB],
    ['1c1uej.jpg', 'Sad Pablo Escobar', 720, 709, [[0.25, 0.43, 0.46], [0.75, 0.43, 0.46], [0.5, 0.92, 0.9]]],
    ['24y43o.jpg', 'Change My Mind', 482, 361, [[0.6, 0.73, 0.34], [0.5, 0.09, 0.9]]],
    ['54hjww.jpg', 'Trade Offer', 607, 794, [[0.27, 0.33, 0.4], [0.73, 0.33, 0.4]]],
    ['21uy0f.jpg', 'Y’all Got Any More Of That', 600, 471, TB],
    ['345v97.jpg', 'Woman Yelling At Cat', 680, 438, PAIR],
    ['9ehk.jpg', 'Batman Slapping Robin', 400, 387, PAIR],
    ['1otk96.jpg', 'Mocking Spongebob', 502, 353, TB],
    ['26am.jpg', 'Ancient Aliens', 500, 437, TB],
    ['1bij.jpg', 'One Does Not Simply', 568, 335, TB],
    ['1o00in.jpg', 'Is This A Pigeon', 1587, 1425, [[0.28, 0.42, 0.4], [0.78, 0.22, 0.36], [0.5, 0.9, 0.94]]],
    ['2za3u1.jpg', 'They’re The Same Picture', 1363, 1524, [[0.27, 0.27, 0.34], [0.73, 0.27, 0.34]]],
    ['8d317n.png', 'Absolute Cinema', 936, 725, TB],
    ['43a45p.png', 'Buff Doge vs. Cheems', 937, 720, [[0.25, 0.1, 0.46], [0.75, 0.1, 0.46], [0.25, 0.9, 0.46], [0.75, 0.9, 0.46]]],
    ['1jwhww.jpg', 'Expanding Brain', 857, 1202, LEFT4],
    ['wxica.jpg', 'This Is Fine', 580, 282, TB],
    ['2ybua0.png', 'Tuxedo Winnie The Pooh', 800, 582, [[0.68, 0.25, 0.6], [0.68, 0.75, 0.6]]],
    ['4pn1an.png', 'They Don’t Know', 671, 673, TB],
    ['gk5el.jpg', 'Hide the Pain Harold', 480, 601, TB],
    ['1h7in3.jpg', 'Roll Safe Think About It', 702, 395, TB],
    ['8tw3vb.png', 'Bell Curve', 675, 499, [[0.15, 0.62, 0.26], [0.5, 0.2, 0.34], [0.85, 0.62, 0.26]]],
    ['2gnnjh.jpg', 'Monkey Puppet', 923, 768, TB],
    ['38el31.jpg', 'Clown Applying Makeup', 750, 798, LEFT4],
    ['5v6gwj.jpg', 'Two Guys On A Bus', 762, 675, TB],
    ['3eqjd8.jpg', 'Spider-Man Triple', 600, 551, [[0.17, 0.55, 0.32], [0.5, 0.55, 0.32], [0.83, 0.55, 0.32]]],
    ['1e7ql7.jpg', 'Evil Kermit', 700, 325, PAIR],
    ['2oo7h0.jpg', 'Domino Effect', 820, 565, [[0.3, 0.82, 0.3], [0.75, 0.4, 0.4]]],
    ['3qqcim.png', 'Panik Kalm Panik', 640, 881, [[0.25, 0.17, 0.46], [0.25, 0.5, 0.46], [0.25, 0.83, 0.46]]],
    ['3kwur5.jpg', 'All My Homies Hate', 680, 615, TB],
    ['4acd7j.png', 'Laughing Leo', 470, 470, TB],
    ['1bgw.jpg', 'Futurama Fry', 552, 414, TB],
    ['2kbn1e.jpg', 'Surprised Pikachu', 1893, 1893, TB],
    ['1tkjq9.jpg', 'Spider-Man Pointing', 800, 450, PAIR],
    ['1tl71a.jpg', 'I Bet He’s Thinking About Other Women', 1654, 930, [[0.25, 0.12, 0.46], [0.75, 0.12, 0.46]]],
    ['5o32tt.png', 'We Are Not The Same', 700, 1000, [[0.5, 0.28, 0.9], [0.5, 0.61, 0.9], [0.5, 0.94, 0.9]]],
    ['1nck6k.jpg', 'Sleeping Shaq', 640, 631, [[0.25, 0.25, 0.46], [0.25, 0.75, 0.46]]],
    ['39t1o.jpg', 'Leonardo DiCaprio Cheers', 600, 400, TB],
    ['1ihzfe.jpg', 'X, X Everywhere', 2118, 1440, TB]
  ].map(function (t) { return { file: t[0], name: t[1], w: t[2], h: t[3], boxes: t[4] }; });

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  var dlg = null, st = null;

  function tileHtml(t, i) {
    return '<button type="button" class="mk-tile" data-make-meme="' + i + '" title="' + esc(t.name) + '">' +
      '<span class="mk-thumb"><img src="' + IMG + '4/' + t.file.replace(/\.png$/, '.jpg') + '" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer"></span>' +
      '<b>' + esc(t.name) + '</b></button>';
  }
  function gridHtml(q) {
    q = String(q || '').trim().toLowerCase();
    var tiles = TEMPLATES.map(function (t, i) { return t.name.toLowerCase().indexOf(q) < 0 ? '' : tileHtml(t, i); }).join('');
    return (q ? '' : '<button type="button" class="mk-tile mk-upload" data-make-meme="upload"><span class="mk-thumb"><span class="mk-plus" aria-hidden="true">+</span></span><b>Your own picture</b></button>') +
      (tiles || '<p class="muted mk-none">No template matches “' + esc(q) + '”.</p>');
  }
  function head(title, back) {
    return '<div class="modal-head">' + (back ? '<button type="button" class="mk-back" data-mk="' + back + '" aria-label="Back">←</button>' : '') +
      '<h2 id="maker-title">' + esc(title) + '</h2><button type="button" class="modal-x" data-close aria-label="Close">✕</button></div>';
  }

  /* ---------- 1. pick a template ---------- */
  function pick() {
    st = null;
    dlg.innerHTML = head('Meme maker') + '<div class="modal-body">' +
      '<p class="muted mk-intro">Pick a template or use your own picture, add your text, then post it on X with @motiongame_.</p>' +
      '<input type="search" class="mk-search" id="mk-search" placeholder="Search ' + TEMPLATES.length + ' templates" aria-label="Search templates" autocomplete="off" spellcheck="false">' +
      '<div class="mk-grid" id="mk-grid">' + gridHtml('') + '</div>' +
      '<input type="file" id="mk-file" accept="image/png,image/jpeg,image/webp,image/gif" hidden></div>';
  }

  /* ---------- 2. add text ---------- */
  function edit(t, keep) {
    if (!keep) {
      st = { t: t, img: null, caps: true, dark: false, active: -1, drag: null,
        boxes: t.boxes.map(function (b) { return { text: '', x: b[0], y: b[1], w: b[2], size: 1 }; }) };
    }
    dlg.innerHTML = head(t.name, 'pick') +
      '<div class="modal-body mk-edit">' +
        '<div class="mk-stage"><canvas id="mk-canvas" role="img" aria-label="Your meme. Drag a text to move it."></canvas><p class="muted mk-load" id="mk-load">Loading the picture…</p></div>' +
        '<div class="mk-side">' +
          '<div id="mk-fields"></div>' +
          '<button type="button" class="link-btn mk-add" data-mk="add">+ Add text</button>' +
          '<div class="mk-opts">' +
            '<div class="seg" role="group" aria-label="Text color"><button type="button" class="seg-btn" data-mk="light">White text</button><button type="button" class="seg-btn" data-mk="dark">Black text</button></div>' +
            '<label class="mk-caps"><input type="checkbox" id="mk-caps"' + (st.caps ? ' checked' : '') + '> ALL CAPS</label>' +
          '</div>' +
          '<p class="muted mk-tip">Drag a text on the picture to move it. The slider sets its size.</p>' +
        '</div>' +
      '</div>' +
      '<div class="cfg-actions"><button type="button" class="btn" data-mk="download"><span>Download</span></button>' +
        '<button type="button" class="btn btn-pink" data-mk="share"><span>Post on X</span></button></div>';
    renderFields();
    syncOpts();
    if (st.img) { setupCanvas(); return; }
    var img = new Image();
    if (!t.own) img.crossOrigin = 'anonymous';
    img.referrerPolicy = 'no-referrer';
    img.onload = function () {
      if (!st || st.t !== t) return;
      st.img = img;
      var go = function () { if (st && st.t === t) setupCanvas(); };
      if (document.fonts && document.fonts.load) document.fonts.load('64px Anton').then(go, go); else go();
    };
    img.onerror = function () { if ($('mk-load')) $('mk-load').textContent = 'Couldn’t load this picture. Go back and try another one.'; };
    img.src = t.src || IMG + t.file;
  }
  function setupCanvas() {
    var c = $('mk-canvas'), nw = st.img.naturalWidth, nh = st.img.naturalHeight;
    var W = clamp(nw, 640, 1080), H = Math.round(W * nh / nw);
    if (H > 1350) { W = Math.round(W * 1350 / H); H = 1350; }
    c.width = W; c.height = H;
    $('mk-load').hidden = true;
    c.classList.add('ready');
    draw(true);
  }
  function renderFields() {
    $('mk-fields').innerHTML = st.boxes.map(function (b, i) {
      return '<div class="mk-field' + (i === st.active ? ' is-active' : '') + '">' +
        '<textarea rows="2" maxlength="200" placeholder="Text ' + (i + 1) + '" aria-label="Text ' + (i + 1) + '" data-mk-text="' + i + '">' + esc(b.text) + '</textarea>' +
        '<div class="mk-row"><input type="range" min="0.4" max="2" step="0.05" value="' + b.size + '" aria-label="Size of text ' + (i + 1) + '" data-mk-size="' + i + '">' +
        '<button type="button" class="mk-del" data-mk-del="' + i + '" aria-label="Remove text ' + (i + 1) + '" title="Remove">✕</button></div></div>';
    }).join('');
  }
  function syncOpts() {
    Array.prototype.forEach.call(dlg.querySelectorAll('[data-mk="light"],[data-mk="dark"]'), function (b) {
      var on = (b.getAttribute('data-mk') === 'dark') === st.dark;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on);
    });
  }
  function setActive(i) {
    st.active = i;
    Array.prototype.forEach.call($('mk-fields').children, function (f, k) { f.classList.toggle('is-active', k === i); });
  }

  function wrap(x, text, maxW) {
    var out = [];
    text.split('\n').forEach(function (para) {
      var words = para.split(/\s+/).filter(Boolean), line = '';
      if (!words.length) { out.push(''); return; }
      words.forEach(function (w) {
        var t = line ? line + ' ' + w : w;
        if (line && x.measureText(t).width > maxW) { out.push(line); line = w; } else line = t;
      });
      out.push(line);
    });
    return out;
  }
  // Fit the text in its box: wrap at the box width and shrink until no word sticks out.
  function layout(x, text, b, W, H) {
    var maxW = b.w * W, fs = Math.min(W, H) * 0.09 * b.size, lines = [text];
    for (var n = 0; n < 50 && fs > 10; n++) {
      x.font = fs + 'px ' + FONT;
      lines = wrap(x, text, maxW);
      var wide = lines.some(function (l) { return x.measureText(l).width > maxW; });
      if (!wide && lines.length * fs * 1.1 <= H * 0.5) break;
      fs *= 0.93;
    }
    x.font = fs + 'px ' + FONT;
    var lh = fs * 1.1, h = lines.length * lh, top = clamp(b.y * H - h / 2, 4, Math.max(4, H - h - 4));
    var w = Math.max.apply(null, lines.map(function (l) { return x.measureText(l).width; }).concat([20]));
    return { lines: lines, fs: fs, lh: lh, top: top, bb: [b.x * W - w / 2 - 10, top - 6, w + 20, h + 12] };
  }
  function draw(guides) {
    var c = $('mk-canvas');
    if (!c || !st || !st.img) return;
    var x = c.getContext('2d'), W = c.width, H = c.height;
    x.clearRect(0, 0, W, H);
    x.drawImage(st.img, 0, 0, W, H);
    st.boxes.forEach(function (b, i) {
      var txt = b.text.trim(), empty = !txt;
      if (empty && !guides) { b.bb = null; return; }
      var s = empty ? 'Text ' + (i + 1) : txt;
      if (st.caps) s = s.toUpperCase();
      var L = layout(x, s, b, W, H);
      b.bb = L.bb;
      x.save();
      if (empty) x.globalAlpha = 0.5;
      x.textAlign = 'center'; x.textBaseline = 'middle'; x.lineJoin = 'round'; x.miterLimit = 2;
      x.lineWidth = Math.max(2, L.fs * 0.15);
      x.strokeStyle = st.dark ? '#fff' : '#000';
      x.fillStyle = st.dark ? '#000' : '#fff';
      L.lines.forEach(function (ln, k) {
        var y = L.top + L.lh * (k + 0.55);
        x.strokeText(ln, b.x * W, y);
        x.fillText(ln, b.x * W, y);
      });
      x.restore();
      if (guides && (i === st.active || empty)) {
        x.save();
        x.setLineDash([10, 7]);
        x.lineWidth = Math.max(2, W / 400);
        x.strokeStyle = i === st.active ? '#7AFDFD' : 'rgba(255,255,255,0.7)';
        x.strokeRect(L.bb[0], L.bb[1], L.bb[2], L.bb[3]);
        x.restore();
      }
    });
  }
  function canvasPoint(e) {
    var c = $('mk-canvas'), r = c.getBoundingClientRect();
    return { x: (e.clientX - r.left) * c.width / r.width, y: (e.clientY - r.top) * c.height / r.height };
  }
  function hitBox(p) {
    for (var i = st.boxes.length - 1; i >= 0; i--) {
      var bb = st.boxes[i].bb;
      if (bb && p.x >= bb[0] && p.x <= bb[0] + bb[2] && p.y >= bb[1] && p.y <= bb[1] + bb[3]) return i;
    }
    return -1;
  }

  /* ---------- 3. download or post ---------- */
  function toBlob(cb) {
    var c = $('mk-canvas');
    if (!c || !st || !st.img) return;
    if (!st.boxes.some(function (b) { return b.text.trim(); }) && !st.t.own) {
      var f = dlg.querySelector('[data-mk-text]');
      if (f) f.focus();
      return;
    }
    draw(false);
    try {
      c.toBlob(function (blob) {
        draw(true);
        if (!blob) { alert('This picture can’t be saved from the browser. Try another template.'); return; }
        cb(blob);
      }, 'image/png');
    } catch (err) {
      draw(true);
      alert('This picture can’t be saved from the browser. Try another template.');
    }
  }
  function download(blob) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'motion-meme.png';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
  }
  function canCopy() { return !!(navigator.clipboard && navigator.clipboard.write && root.ClipboardItem); }
  function share(blob) {
    st.blob = blob;
    st.file = typeof File === 'function' ? new File([blob], 'motion-meme.png', { type: 'image/png' }) : null;
    var phone = root.matchMedia && root.matchMedia('(pointer: coarse)').matches;
    var native = !!(phone && st.file && navigator.canShare && navigator.canShare({ files: [st.file] }));
    var copy = !native && canCopy();
    if (st.url) URL.revokeObjectURL(st.url);
    st.url = URL.createObjectURL(blob);
    var steps = native
      ? ['Tap <b>Share to X</b> and pick X: the picture and your text go along.', 'Post it.', 'Copy the link to your post and submit it on the Memes page.']
      : ['Tap <b>Open X</b>: your text is already in the post' + (copy ? ' and the picture is copied.' : ', and the picture downloads.'),
         copy ? 'In the post, press <kbd>Ctrl</kbd>+<kbd>V</kbd> (<kbd>⌘</kbd>+<kbd>V</kbd> on a Mac) to add the picture, then post.' : 'Add the downloaded picture to the post, then post.',
         'Copy the link to your post and submit it on the Memes page.'];
    dlg.innerHTML = head('Post it on X', 'back') +
      '<div class="modal-body mk-share">' +
        '<img class="mk-final" src="' + st.url + '" alt="Your meme">' +
        '<div class="mk-side">' +
          '<label class="fb-field"><span>Your post <em>· change anything you like</em></span><textarea id="mk-post" rows="5" maxlength="2000">' + esc(st.post != null ? st.post : POST_TEXT) + '</textarea></label>' +
          '<ol class="meme-steps">' + steps.map(function (s) { return '<li>' + s + '</li>'; }).join('') + '</ol>' +
          '<p class="fb-status" id="mk-status" aria-live="polite"></p>' +
          '<button type="button" class="link-btn" data-mk="submit">Posted it? Add it to the wall →</button>' +
        '</div>' +
      '</div>' +
      '<div class="cfg-actions"><button type="button" class="btn" data-mk="save"><span>Download</span></button>' +
        '<button type="button" class="btn btn-pink" data-mk="' + (native ? 'native' : 'intent') + '"><span>' + (native ? 'Share to X' : 'Open X') + '</span></button></div>';
  }
  function status(text, ok) {
    var s = $('mk-status');
    if (s) { s.className = 'fb-status ' + (ok ? 'ok-text' : 'err-text'); s.textContent = text; }
  }
  function postText() { var p = $('mk-post'); st.post = p ? p.value : POST_TEXT; return st.post; }

  /* ---------- events ---------- */
  function onClick(e) {
    var t = e.target.closest('[data-mk],[data-mk-del],[data-make-meme]');
    if (!t || !dlg.contains(t)) return;
    if (t.hasAttribute('data-make-meme')) {
      var v = t.getAttribute('data-make-meme');
      if (v === 'upload') $('mk-file').click(); else if (TEMPLATES[+v]) edit(TEMPLATES[+v]);
      return;
    }
    if (t.hasAttribute('data-mk-del')) {
      st.boxes.splice(+t.getAttribute('data-mk-del'), 1);
      st.active = -1;
      renderFields();
      draw(true);
      return;
    }
    switch (t.getAttribute('data-mk')) {
      case 'pick': pick(); if ($('mk-search')) $('mk-search').focus(); break;
      case 'back': edit(st.t, true); break;
      case 'add':
        st.boxes.push({ text: '', x: 0.5, y: 0.5, w: 0.8, size: 1 });
        st.active = st.boxes.length - 1;
        renderFields();
        draw(true);
        dlg.querySelector('[data-mk-text="' + st.active + '"]').focus();
        break;
      case 'light': case 'dark': st.dark = t.getAttribute('data-mk') === 'dark'; syncOpts(); draw(true); break;
      case 'download': toBlob(download); break;
      case 'share': toBlob(share); break;
      case 'save': if (st.blob) download(st.blob); break;
      case 'intent': {
        var text = postText(), pic = st.blob;
        if (!pic) break;
        if (canCopy()) {
          navigator.clipboard.write([new root.ClipboardItem({ 'image/png': pic })]).then(function () {
            status('Picture copied. Paste it into your post on X.', true);
          }, function () {
            download(pic);
            status('Couldn’t copy the picture, so it was downloaded. Add it to your post on X.', true);
          });
        } else {
          download(pic);
          status('The picture was downloaded. Add it to your post on X.', true);
        }
        root.open('https://x.com/intent/post?text=' + encodeURIComponent(text), '_blank', 'noopener');
        break;
      }
      case 'native':
        navigator.share({ files: [st.file], text: postText() }).then(function () {
          status('Shared! Once it’s posted, add the link to the wall.', true);
        }, function (err) {
          if (err && err.name !== 'AbortError') status('Sharing didn’t work here. Use Download and add the picture to a post on X.');
        });
        break;
      case 'submit':
        dlg.close();
        if (root.location.hash !== '#memes') root.location.hash = '#memes';
        setTimeout(function () {
          var u = $('meme-url');
          if (u) { u.scrollIntoView({ block: 'center', behavior: 'smooth' }); u.focus({ preventScroll: true }); }
        }, 50);
        break;
    }
  }
  function onInput(e) {
    var t = e.target;
    if (t.id === 'mk-search') { $('mk-grid').innerHTML = gridHtml(t.value); return; }
    if (!st) return;
    if (t.hasAttribute('data-mk-text')) { st.boxes[+t.getAttribute('data-mk-text')].text = t.value; draw(true); }
    else if (t.hasAttribute('data-mk-size')) { st.boxes[+t.getAttribute('data-mk-size')].size = +t.value; draw(true); }
    else if (t.id === 'mk-caps') { st.caps = t.checked; draw(true); }
  }
  function onFocus(e) {
    var t = e.target;
    if (!st || !t.closest) return;
    var f = t.closest('[data-mk-text],[data-mk-size]');
    if (f) { setActive(+(f.getAttribute('data-mk-text') || f.getAttribute('data-mk-size'))); draw(true); }
  }
  function onFile(e) {
    var f = e.target.files && e.target.files[0];
    if (!f || !/^image\//.test(f.type)) return;
    edit({ name: 'Your picture', own: true, src: URL.createObjectURL(f), boxes: TB });
  }
  function onDown(e) {
    if (e.target.id !== 'mk-canvas' || !st || !st.img) return;
    var p = canvasPoint(e), i = hitBox(p);
    setActive(i);
    if (i >= 0) {
      var b = st.boxes[i], c = e.target;
      st.drag = { i: i, dx: p.x - b.x * c.width, dy: p.y - b.y * c.height };
      c.setPointerCapture(e.pointerId);
      e.preventDefault();
    }
    draw(true);
  }
  function onMove(e) {
    if (e.target.id !== 'mk-canvas' || !st || !st.img) return;
    var c = e.target, p = canvasPoint(e);
    if (!st.drag) { c.style.cursor = hitBox(p) >= 0 ? 'move' : 'default'; return; }
    var b = st.boxes[st.drag.i];
    b.x = clamp((p.x - st.drag.dx) / c.width, 0.03, 0.97);
    b.y = clamp((p.y - st.drag.dy) / c.height, 0.02, 0.98);
    draw(true);
  }
  function onUp() { if (st) st.drag = null; }

  function init() {
    dlg = $('maker-dlg');
    if (!dlg) return false;
    if (!dlg._mk) {
      dlg._mk = true;
      dlg.addEventListener('click', onClick);
      dlg.addEventListener('input', onInput);
      dlg.addEventListener('change', function (e) { if (e.target.id === 'mk-file') onFile(e); else onInput(e); });
      dlg.addEventListener('focusin', onFocus);
      dlg.addEventListener('pointerdown', onDown);
      dlg.addEventListener('pointermove', onMove);
      dlg.addEventListener('pointerup', onUp);
      dlg.addEventListener('pointercancel', onUp);
    }
    return true;
  }
  function open(i) {
    if (!init()) return;
    if (i != null && TEMPLATES[i]) edit(TEMPLATES[i]); else pick();
    if (!dlg.open) dlg.showModal();
    if (i === 'upload') $('mk-file').click();
  }
  // Anything with data-make-meme outside the dialog opens it: "" for the template list, a number for that template.
  document.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('[data-make-meme]');
    if (!t || (dlg && dlg.contains(t))) return;
    var v = t.getAttribute('data-make-meme');
    open(v === '' ? null : v === 'upload' ? v : +v);
  });

  MS.MemeMaker = { open: open, gridHtml: gridHtml, count: TEMPLATES.length };
})(typeof window !== 'undefined' ? window : this);
