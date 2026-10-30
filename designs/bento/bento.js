/* bento.js — the Bento design's motion and its island, after the bento transitions in Apple's keynotes.
   Every box opens on its main card, zoomed in to fill the screen. Scroll, and the card shrinks into its place
   in the box while the other cards slide in from beyond it, each from its own side. Scroll again, and the whole
   box slides up and away as the next box's main card, zoomed in, comes up with it; the next scroll zooms that
   one out. The page opens on the first box's main card, so the first scroll zooms out the intro. It all follows
   the scroll, so it plays backwards too; with a mouse or trackpad, a scroll that stops partway finishes in the
   direction you were going, so one notch of the wheel is one step. On phones the cards below the first screen rise in as you reach them.
   The island at the top is the site's progress bar: one dot per box, with a gap between chapters (on phones, one
   dot per chapter). The box you're in is a bar that fills as you read it, and the ones you've read light up in
   their chapter's LED colour, as on the rack. "Message me" sits beside it; opening it shows a map of every
   chapter. site.js does the rest: which box is current, the page title, swapping "Message me" for "Request access"
   around Jellyfin, and the request form. */
(() => {
    'use strict';
    const root = document.documentElement;
    const secs = [...document.querySelectorAll('main > .bs')];
    if (!secs.length) return;
    const wide = matchMedia('(min-width: 1024px)');
    const mouse = matchMedia('(hover: hover) and (pointer: fine)');
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');

    // a box is current once it covers half the screen
    if (window.Site) window.Site.probe = () => window.innerHeight * 0.5;

    // ---------- where everything sits, before any motion is applied ----------
    // Each section is its box, then a stretch of scrolling (its ::after) during which the box holds still under the
    // island while its main card zooms out: a box's zoom runs from its top to top + z.
    let V = window.innerHeight, W = root.clientWidth, boxes = [];
    const docTop = (el) => { let y = 0; for (let e = el; e; e = e.offsetParent) y += e.offsetTop; return y; };
    const inSlide = (el, slide) => {
        let x = 0, y = 0;
        for (let e = el; e && e !== slide; e = e.offsetParent) { x += e.offsetLeft; y += e.offsetTop; }
        return { x, y };
    };
    function measure() {
        V = window.innerHeight;
        W = root.clientWidth;
        root.classList.toggle('deck', wide.matches && mouse.matches && V >= 600);
        const R = parseFloat(getComputedStyle(root).getPropertyValue('--r')) || 28;
        boxes = secs.map((sec) => {
            const slide = sec.querySelector('.slide');
            const h = slide.offsetHeight;
            const all = [...slide.querySelectorAll('.tile')];
            // the main card: the box's opening tile, or the one that stands out in a box of websites
            const el = all.find((t) => t.matches('.t-hero, .t-head, .t-feature, .t-more')) || all[0];
            el.classList.remove('zooming');
            const L = { el, ...inSlide(el, slide), w: el.offsetWidth, h: el.offsetHeight, R, s: null };
            // zoomed in, its words are as big as fits on the screen under the island, and never smaller than they are
            const top = parseFloat(getComputedStyle(slide).paddingTop) || 76, side = Math.max(16, W * 0.05);
            L.big = Math.max(1, Math.min(1.7, (W - 2 * side) / L.w, (V - top - side * 0.6) / L.h));
            L.bx = (W - L.w * L.big) / 2;
            L.by = top + (V - top - side * 0.6 - L.h * L.big) / 2;
            // its background is drawn on a card of its own, which can fill the screen while the words keep their shape
            let bg = slide.querySelector(':scope > .zoom-bg');
            if (!bg) {
                bg = document.createElement('div');
                bg.className = 'zoom-bg';
                bg.setAttribute('aria-hidden', 'true');
                slide.prepend(bg);
            }
            const cs = getComputedStyle(el);
            Object.assign(bg.style, { left: `${L.x}px`, top: `${L.y}px`, width: `${L.w}px`, height: `${L.h}px`, backgroundColor: cs.backgroundColor, backgroundImage: cs.backgroundImage });
            L.bg = bg;
            const cx = L.x + L.w / 2, cy = L.y + L.h / 2;
            const others = all.filter((t) => t !== el).map((t) => {
                const at = inSlide(t, slide), w = t.offsetWidth, th = t.offsetHeight;
                // the cards on screen when the zoom ends slide in from beyond the main card;
                // on a phone, the ones further down rise in as you scroll to them
                const zoomIn = at.y < V * 0.85;
                let dx = at.x + w / 2 - cx, dy = at.y + th / 2 - cy;
                const d = Math.hypot(dx, dy) || 1;
                dx /= d; dy /= d;
                return { el: t, y: at.y, h: th, dx, dy, d, zoomIn, rank: 0, s: null };
            });
            // the nearest cards land first
            const near = others.filter((t) => t.zoomIn).sort((a, b) => a.d - b.d);
            near.forEach((t, k) => { t.rank = near.length > 1 ? k / (near.length - 1) : 0; });
            // s: null, so the next frame writes every style afresh, whatever an earlier measure left
            return { sec, slide, top: docTop(sec), h, z: sec.offsetHeight - h, lead: L, others };
        });
        frame();
    }

    // ---------- every frame: only the boxes on screen, and only what changed ----------
    const clamp = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
    const out = (t) => 1 - (1 - t) * (1 - t) * (1 - t);
    const inOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
    const lerp = (a, b, t) => a + (b - a) * t;
    let index = -1;
    function frame() {
        const y = window.scrollY;
        for (let i = 0; i < boxes.length; i++) {
            const b = boxes[i];
            if (b.top - y > V || b.top + b.z + b.h - y < 0) continue;
            // how far this box's zoom has gone
            const p = b.z > 0 ? clamp((y - b.top) / b.z) : 1;

            // the main card shrinks first...
            const L = b.lead, zc = inOut(clamp(p / 0.72));
            const ls = zc >= 1 ? '' : zc.toFixed(4);
            if (ls !== L.s) {
                L.s = ls;
                if (zc >= 1) {
                    L.el.style.transform = '';
                    L.el.classList.remove('zooming');
                    L.bg.style.display = 'none';
                } else {
                    // the words: one scale, so they keep their shape, from the middle of the screen to their place
                    L.el.classList.add('zooming');
                    L.el.style.transform = `translate(${lerp(L.bx - L.x, 0, zc).toFixed(1)}px, ${lerp(L.by - L.y, 0, zc).toFixed(1)}px) scale(${lerp(L.big, 1, zc).toFixed(4)})`;
                    // the card behind them: from the whole screen to its tile, with round corners all the way
                    const sx = lerp(W, L.w, zc) / L.w, sy = lerp(V, L.h, zc) / L.h;
                    L.bg.style.display = '';
                    L.bg.style.transform = `translate(${lerp(-L.x, 0, zc).toFixed(1)}px, ${lerp(-L.y, 0, zc).toFixed(1)}px) scale(${sx.toFixed(4)}, ${sy.toFixed(4)})`;
                    L.bg.style.borderRadius = `${(L.R / sx).toFixed(2)}px / ${(L.R / sy).toFixed(2)}px`;
                }
            }

            // ...then the others slide in from beyond it, the nearest first
            const vt = b.top - y, far = Math.max(W, V) * 0.6;
            for (const t of b.others) {
                const q = t.zoomIn
                    ? out(clamp((p - 0.3 - 0.22 * t.rank) / 0.48))
                    : out(clamp((V - (vt + t.y)) / Math.max(1, Math.min(t.h, V * 0.6))));
                const s = q >= 1 ? '' : q.toFixed(4);
                if (s === t.s) continue;
                t.s = s;
                if (q >= 1) {
                    t.el.style.transform = '';
                    t.el.style.opacity = '';
                    t.el.classList.remove('away', 'moving');
                    continue;
                }
                t.el.classList.add('moving');
                const off = (1 - q) * (t.zoomIn ? far : 44);
                const ox = t.zoomIn ? t.dx * off : 0, oy = t.zoomIn ? t.dy * off : off;
                t.el.style.transform = `translate(${ox.toFixed(1)}px, ${oy.toFixed(1)}px) scale(${(0.92 + 0.08 * q).toFixed(4)})`;
                t.el.style.opacity = q.toFixed(3);
                t.el.classList.toggle('away', q < 0.5);
            }
        }
        island(y);
    }

    // ---------- with a mouse: a move left partway is finished, the way you were scrolling ----------
    let lastY = window.scrollY, dir = 0, settleTimer = 0;
    const go = (top) => window.scrollTo({ top, behavior: 'smooth' });
    function settle() {
        if (glider || !root.classList.contains('deck') || reduced.matches) return;
        const y = window.scrollY;
        for (let i = 0; i < boxes.length; i++) {
            const b = boxes[i], n = boxes[i + 1];
            // a main card partway through zooming out
            if (b.z > 0 && y > b.top + 1 && y < b.top + b.z - 1) {
                const p = (y - b.top) / b.z;
                go((dir > 0 ? p > 0.04 : p > 0.96) ? b.top + b.z : b.top);
                return;
            }
            // the next box partway up the screen
            const t = n ? n.top - y : 0;
            if (n && t > 1 && t < V - 1) {
                const p = 1 - t / V;
                go((dir > 0 ? p > 0.04 : p > 0.96) ? n.top : n.top - V);
                return;
            }
        }
    }

    // ---------- the keys: a glide from stop to stop, drawn here so the page and its cards move in the same frame ----------
    // The browser's own smooth scroll won't do: Windows with animation effects off turns it off, and that setting also
    // reports reduced motion, so a key press would jump. A glide is a cubic from where the page is, at the speed it's
    // going, so a second press joins on without a jolt. The zoom has an ease of its own, so a glide along it keeps some
    // speed at both ends; two full eases would multiply into a snap in the middle.
    const GLIDE = 950, GLIDE_ZOOM = 1050, FLOW = 260;
    let glider = null;
    function stopGlide() {
        if (!glider) return;
        cancelAnimationFrame(glider.raf);
        glider = null;
    }
    function glide(to) {
        const from = window.scrollY, d = to - from, v = glider ? glider.v : null;
        const zoom = boxes.some((b) => b.z && Math.min(from, to) >= b.top - 2 && Math.max(from, to) <= b.top + b.z + 2);
        const ms = zoom ? GLIDE_ZOOM : GLIDE, end = zoom ? d * 0.7 : 0, start = v === null ? end : v * ms;
        stopGlide();
        const g = glider = { to, ms, t0: performance.now(), v: 0, raf: 0 };
        const tick = (now) => {
            const s = clamp((now - g.t0) / ms), s2 = s * s, s3 = s2 * s;
            g.v = (d * (6 * s - 6 * s2) + start * (3 * s2 - 4 * s + 1) + end * (3 * s2 - 2 * s)) / ms;
            window.scrollTo({ top: from + d * (3 * s2 - 2 * s3) + start * (s3 - 2 * s2 + s) + end * (s3 - s2), behavior: 'instant' });
            frame();
            if (s < 1) g.raf = requestAnimationFrame(tick);
            else glider = null;
        };
        g.raf = requestAnimationFrame(tick);
    }
    ['wheel', 'touchstart', 'pointerdown'].forEach((ev) => window.addEventListener(ev, stopGlide, { passive: true }));

    // the arrow keys, Page Down, Page Up and the space bar step from stop to stop: each big card, each box open, a tall
    // box's foot. Held down, the next step joins on just before this one ends, so the page flows on through the stops
    document.addEventListener('keydown', (e) => {
        if (!root.classList.contains('deck') || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
        const space = e.key === ' ', arrow = e.key === 'ArrowDown' || e.key === 'ArrowUp';
        if (arrow && e.shiftKey) return;
        const down = e.key === 'PageDown' || e.key === 'ArrowDown' || (space && !e.shiftKey);
        const up = e.key === 'PageUp' || e.key === 'ArrowUp' || (space && e.shiftKey);
        if (!down && !up) { if (e.key !== 'Shift') stopGlide(); return; }
        const t = e.target;
        if (t.closest && t.closest(space ? 'input, textarea, select, button, summary, [contenteditable]' : 'input, textarea, select, [contenteditable]')) return;
        const modal = document.getElementById('invite-modal');
        if (modal && !modal.hidden) return;
        if (e.repeat && glider && performance.now() - glider.t0 < glider.ms - FLOW) { e.preventDefault(); return; }
        const stops = [];
        boxes.forEach((b) => { if (b.z) stops.push(b.top); stops.push(b.top + b.z); if (b.h > V) stops.push(b.top + b.z + b.h - V); });
        const y = window.scrollY;
        // pressed again the way it's going, the step after the one it's heading for; the other way, back from here
        const from = glider && (glider.to > y) === down ? glider.to : y;
        const to = down ? stops.find((s) => s > from + 2) : stops.reverse().find((s) => s < from - 2);
        if (to == null) { if (glider) e.preventDefault(); return; }
        e.preventDefault();
        glide(to);
    });

    let ticking = false;
    window.addEventListener('scroll', () => {
        const y = window.scrollY;
        if (y !== lastY) { dir = y > lastY ? 1 : -1; lastY = y; }
        clearTimeout(settleTimer);
        settleTimer = setTimeout(settle, 140);
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(() => { ticking = false; frame(); });
    }, { passive: true });
    window.addEventListener('resize', measure);
    window.addEventListener('load', measure);
    if (document.fonts) document.fonts.ready.then(measure);
    // images and the request form change heights as they load
    if ('ResizeObserver' in window) {
        const ro = new ResizeObserver(() => measure());
        secs.forEach((s) => ro.observe(s.querySelector('.slide')));
    }

    // ---------- keyboard: a link in a box that hasn't opened yet opens that box ----------
    document.addEventListener('focusin', (e) => {
        const sec = e.target.closest && e.target.closest('main > .bs');
        if (!sec) return;
        const b = boxes.find((bx) => bx.sec === sec);
        if (!b) return;
        requestAnimationFrame(() => {
            let top = 0;
            for (let el = e.target; el && el !== b.slide; el = el.offsetParent) top += el.offsetTop;
            // it shows once its box has zoomed out and it's on screen below the island
            const open = b.top + b.z, foot = open + Math.max(0, b.h - V), y = window.scrollY;
            const at = open - y + top, tall = Math.min(e.target.offsetHeight, V - 100);
            if (y >= open - 1 && y <= foot + 1 && at >= 70 && at + tall <= V) return;
            // the box open, scrolled far enough down it to show the link
            window.scrollTo({ top: open + Math.min(Math.max(0, top - V * 0.35), Math.max(0, b.h - V)), behavior: 'instant' });
        });
    });

    // ---------- the island ----------
    const dotsEl = document.getElementById('i-dots');
    const chaptersEl = document.getElementById('i-chapters');
    const nameEl = document.getElementById('i-name');
    const toggle = document.getElementById('i-track');
    const mapEl = document.getElementById('i-map');
    const islandEl = document.getElementById('island');
    const LED = { Hosting: 'g', 'IT support': 'g', Automation: 'g', Tools: 'b', Jellyfin: 'a', 'TV setup': 'a' };
    const label = (s) => {
        const parts = (s.dataset.title || '').split(' | ').filter((p) => p !== 'RoboCrax');
        return parts[0] || s.dataset.marker;
    };
    // chapters: boxes in a row that share a marker
    const chapters = [];
    secs.forEach((s, i) => {
        const name = s.dataset.marker, last = chapters[chapters.length - 1];
        if (last && last.name === name) last.idx.push(i); else chapters.push({ name, idx: [i] });
    });
    const chapterOf = [];
    chapters.forEach((c, k) => c.idx.forEach((i) => { chapterOf[i] = k; }));

    const dots = secs.map((s, i) => {
        const d = document.createElement('i');
        const c = chapters[chapterOf[i]];
        if (c.idx[0] === i) d.className = 'ch';
        if (LED[c.name]) d.dataset.led = LED[c.name];
        dotsEl.appendChild(d);
        return d;
    });
    const chapterDots = chapters.map((c) => {
        const d = document.createElement('i');
        if (LED[c.name]) d.dataset.led = LED[c.name];
        chaptersEl.appendChild(d);
        return d;
    });

    // the map: a tile per chapter; a chapter with several different boxes lists them
    const ol = document.createElement('ol');
    const mapLinks = [];
    chapters.forEach((c) => {
        const li = document.createElement('li');
        li.className = 'i-ch';
        if (LED[c.name]) li.dataset.led = LED[c.name];
        const titles = [];
        c.idx.forEach((i) => { if (!titles.some((t) => t.text === label(secs[i]))) titles.push({ i, text: label(secs[i]) }); });
        if (titles.length > 1) {
            li.classList.add(titles.length > 3 ? 'tall' : 'wide');
            const b = document.createElement('b');
            b.textContent = c.name;
            const ul = document.createElement('ul');
            titles.forEach((t) => {
                const item = document.createElement('li');
                const a = document.createElement('a');
                a.href = `#${secs[t.i].id}`;
                a.textContent = t.text;
                item.appendChild(a);
                ul.appendChild(item);
                mapLinks.push({ a, idx: c.idx.filter((j) => label(secs[j]) === t.text) });
            });
            li.append(b, ul);
        } else {
            const a = document.createElement('a');
            a.className = 'ch-link';
            a.href = `#${secs[c.idx[0]].id}`;
            const b = document.createElement('b');
            b.textContent = c.name;
            a.appendChild(b);
            if (titles[0].text.toLowerCase() !== c.name.toLowerCase()) {
                const span = document.createElement('span');
                span.textContent = titles[0].text;
                a.appendChild(span);
            }
            li.appendChild(a);
            mapLinks.push({ a, idx: c.idx });
        }
        c.li = li;
        ol.appendChild(li);
    });
    mapEl.appendChild(ol);

    function setIndex(i) {
        if (i === index) return;
        index = i;
        dots.forEach((d, k) => { d.classList.toggle('done', k < i); d.classList.toggle('on', k === i); });
        chapterDots.forEach((d, k) => { d.classList.toggle('done', k < chapterOf[i]); d.classList.toggle('on', k === chapterOf[i]); });
        const name = chapters[chapterOf[i]].name;
        if (nameEl.textContent !== name) {
            nameEl.textContent = name;
            nameEl.classList.remove('swap');
            void nameEl.offsetWidth;
            nameEl.classList.add('swap');
        }
        toggle.setAttribute('aria-label', `Sections: ${name}, ${i + 1} of ${secs.length}`);
        chapters.forEach((c, k) => c.li.classList.toggle('here', k === chapterOf[i]));
        mapLinks.forEach(({ a, idx }) => { if (idx.includes(i)) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current'); });
    }
    // how far through, from when the first of `from` becomes current to when the one after `to` does
    const through = (probe, from, to) => {
        const a = boxes[from].top, b = boxes[to + 1] ? boxes[to + 1].top : root.scrollHeight - V * 0.5;
        return clamp((probe - a) / Math.max(1, b - a)).toFixed(3);
    };
    let lastF = '', lastC = '';
    function island(y) {
        const probe = y + V * 0.5;
        let i = 0;
        for (let k = 0; k < boxes.length; k++) if (boxes[k].top <= probe) i = k;
        setIndex(i);
        const f = through(probe, i, i);
        if (f !== lastF) { lastF = f; dots[i].style.setProperty('--f', f); }
        const c = chapters[chapterOf[i]];
        const fc = through(probe, c.idx[0], c.idx[c.idx.length - 1]);
        if (fc !== lastC) { lastC = fc; chapterDots[chapterOf[i]].style.setProperty('--f', fc); }
    }

    function setMap(open) {
        mapEl.hidden = !open;
        toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        islandEl.classList.toggle('open', open);
    }
    toggle.addEventListener('click', () => setMap(mapEl.hidden));
    mapEl.addEventListener('click', (e) => { if (e.target.closest('a')) setMap(false); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !mapEl.hidden) { setMap(false); toggle.focus(); } });
    document.addEventListener('pointerdown', (e) => { if (!mapEl.hidden && !islandEl.contains(e.target)) setMap(false); });
    islandEl.addEventListener('focusout', (e) => { if (!mapEl.hidden && e.relatedTarget && !islandEl.contains(e.relatedTarget)) setMap(false); });
    window.addEventListener('site:modal', () => setMap(false));

    measure();
})();
