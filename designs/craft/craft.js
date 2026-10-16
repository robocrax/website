/* craft.js — the Craft design's moving parts.
   Every section gets a sticky "NN / NAME" bar. On a desktop the right edge carries a ruler the length of the page:
   it scrolls with the page while the blue playhead moves down the screen, so the two always meet at the percentage
   you're at. Hover it and it becomes a map of the whole page with the chapters laid out along it; click or drag to go
   there. The chapters themselves are stacked top right, one span per letter, so a new chapter can roll up the
   ruler on its side and settle into place. The loop runs only while something is moving. */
(() => {
    'use strict';
    const Site = window.Site;
    if (!Site) return;
    const scenes = Site.scenes;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const desktopMQ = matchMedia('(min-width: 1100px)');

    const CHAPTERS = [
        { name: 'Intro', ids: ['home'] },
        { name: 'Work', ids: ['portfolio'] },
        { name: 'Services', ids: ['services', 'wordpress', 'it-support', 'automations', 'how'] },
        { name: 'Tools', ids: ['tools', 'respond', 'nzquiz', 'atem', 'dashboards', 'heartbeats', 'magento'] },
        { name: 'Jellyfin', ids: ['jellyfin', 'tv-setup'] },
        { name: 'Contact', ids: ['contact'] },
    ];
    const chapterOf = (id) => Math.max(0, CHAPTERS.findIndex((c) => c.ids.includes(id)));

    // ---------- the sticky bar at the top of every section ----------
    scenes.forEach((s, i) => {
        const bar = document.createElement('div');
        bar.className = 'eyebrow';
        bar.setAttribute('aria-hidden', 'true');
        const name = (s.dataset.title || '').split(' | ')[0] || s.dataset.marker || '';
        const left = document.createElement('span');
        left.innerHTML = `<b>${String(i + 1).padStart(2, '0')}</b><i>/</i>`;
        left.append(name);
        const right = document.createElement('span');
        right.textContent = s.id === 'home' ? 'Auckland, New Zealand' : CHAPTERS[chapterOf(s.id)].name;
        bar.append(left, right);
        s.prepend(bar);
    });
    Site.measure();

    // ---------- the right-hand scroller ----------
    const rail = document.getElementById('rail');
    const ticksEl = document.getElementById('rail-ticks');
    const hoverEl = document.getElementById('rail-hover');
    const headEl = document.getElementById('rail-head');
    const odo = document.getElementById('odo');
    const nav = document.getElementById('chapters');
    const root = document.documentElement;
    if (!rail || !nav) return;

    // the ruler: a tick for every per cent, a label every five
    const ticks = [];
    for (let k = 0; k <= 100; k++) {
        const t = document.createElement('div');
        t.className = 'tick' + (k % 5 === 0 ? ' major' : '') + (k % 10 === 0 ? ' ten' : '');
        if (k % 5 === 0) { const l = document.createElement('span'); l.textContent = k; t.appendChild(l); }
        ticksEl.appendChild(t);
        ticks.push(t);
    }
    // the odometer: a reel of digits for each place
    const reels = [0, 1, 2].map(() => {
        const r = document.createElement('span');
        r.className = 'reel';
        const strip = document.createElement('i');
        for (let d = 0; d <= 9; d++) { const b = document.createElement('b'); b.textContent = d; strip.appendChild(b); }
        r.appendChild(strip);
        odo.appendChild(r);
        return strip;
    });
    odo.append('%');
    let shownPct = -1;
    function setOdo(pct) {
        if (pct === shownPct) return;
        shownPct = pct;
        const digits = String(pct).padStart(3, '0').split('').map(Number);
        reels.forEach((strip, i) => { strip.style.transform = `translateY(${-digits[i] * 9}px)`; });
        rail.setAttribute('aria-valuenow', String(pct));
    }

    // the chapters: a link for each, laid over its letters, and one span per letter
    const letters = [];
    CHAPTERS.forEach((c, ci) => {
        const a = document.createElement('a');
        a.href = `#${c.ids[0]}`;
        a.className = 'ch-link';
        a.innerHTML = `<span class="sr-only">${c.name}</span>`;
        a.setAttribute('aria-label', `Jump to ${c.name}`);
        nav.appendChild(a);
        c.link = a;
        c.letters = [...c.name.toUpperCase()].map((ch, i) => {
            const el = document.createElement('span');
            el.className = 'ch-l';
            el.textContent = ch;
            el.setAttribute('aria-hidden', 'true');
            nav.appendChild(el);
            const L = { el, ci, i, w: 20, x: innerWidth + 200, y: innerHeight - 40, r: 0, s: .47, tx: 0, ty: 0, tr: 0, ts: .47, wait: 0, col: '' };
            letters.push(L);
            return L;
        });
    });
    function measureLetters() {
        letters.forEach((L) => { L.w = L.el.offsetWidth || 20; });
        CHAPTERS.forEach((c) => { c.width = c.letters.reduce((sum, L) => sum + L.w, 0); });
    }

    // ---------- state ----------
    let on = false, W = 0, H = 0, headH = 48, L = 1, cur = 0, prevCur = 0;
    let m = 0, mTarget = 0;          // 0: the ruler at page scale, 1: the whole page in view (the map)
    let hovering = false, dragging = false, dragMoved = false, hoverY = 0, leaveTimer = 0;
    let rollUntil = 0, rollChapter = -1;
    let raf = 0, last = 0;

    function sizes() {
        W = innerWidth;
        headH = (document.querySelector('.site-head') || {}).offsetHeight || 48;
        H = Math.max(1, innerHeight - headH);
        L = Site.maxScroll + H;
        CHAPTERS.forEach((c) => {
            const i = scenes.findIndex((s) => s.id === c.ids[0]);
            c.p = Math.min(1, Math.max(0, (Site.tops[i] || 0) / Site.maxScroll));
        });
    }

    // where each letter should be: the stack, the map, or rolling up the ruler on its side
    const SMALL = .47, R_EDGE = () => W - 60;
    function placeLine(c, xRight, yMid, s, rot, now, stagger) {
        let acc = 0;
        const total = c.width * s;
        c.letters.forEach((Lt, i) => {
            if (rot) {
                // on its side, reading upward, centred on yMid
                Lt.tx = xRight;
                Lt.ty = yMid + total / 2 - (acc + Lt.w / 2) * s;
            } else {
                Lt.tx = xRight - total + (acc + Lt.w / 2) * s;
                Lt.ty = yMid;
            }
            Lt.tr = rot;
            Lt.ts = s;
            if (stagger) Lt.wait = now + i * 24;
            acc += Lt.w;
        });
        return total;
    }
    function layout(now, stagger = false) {
        const R = R_EDGE();
        const n = CHAPTERS.length;
        if (m > .5 || mTarget > .5) {
            // the map: every chapter beside the ruler, where it starts on the page
            let lastY = -1e9;
            CHAPTERS.forEach((c, ci) => {
                let y = headH + c.p * H;
                y = Math.max(headH + 14, Math.min(innerHeight - 14, y));
                if (y - lastY < 22) y = lastY + 22;
                lastY = y;
                const total = placeLine(c, R - 8, y, SMALL, 0, now, stagger);
                c.box = [R - 8 - total, y - 10, total, 20];
                c.state = ci === cur ? 'map-cur' : 'map';
            });
            return;
        }
        // the stack: chapters you've passed at the top, this one large, the rest waiting at the bottom
        const top = headH + 27;
        CHAPTERS.forEach((c, ci) => {
            let y, s = SMALL, rot = 0, x = R;
            if (ci < cur) { y = top + ci * 20; c.state = 'past'; }
            else if (ci > cur) { y = innerHeight - 37 - (n - 1 - ci) * 20; c.state = 'next'; }
            else {
                y = top + cur * 20 + 25; s = 1; c.state = 'cur';
                if (now < rollUntil && rollChapter === ci) {
                    // on the way in: up the ruler, on its side
                    x = W - 30; rot = -90; s = .55;
                    y = Math.max(headH + 120, Math.min(innerHeight - 120, headH + (Site.maxScroll ? scrollY / Site.maxScroll : 0) * H + 120));
                }
            }
            const total = placeLine(c, x, y, s, rot, now, stagger && ci === cur);
            c.box = rot ? [x - 12, y - total / 2, 24, total] : [x - total, y - 17 * s, total, 34 * s];
        });
    }
    function placeLinks() {
        CHAPTERS.forEach((c) => {
            const [x, y, w, h] = c.box;
            const st = c.link.style;
            st.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
            st.width = `${w.toFixed(1)}px`;
            st.height = `${h.toFixed(1)}px`;
        });
    }
    const COLORS = { past: 'rgba(16,16,20,.4)', next: 'rgba(16,16,20,.4)', cur: '#000', map: 'rgba(16,16,20,.72)', 'map-cur': '#1E5BD8' };
    function paintColors() {
        CHAPTERS.forEach((c) => {
            const col = COLORS[c.state] || '#000';
            c.letters.forEach((Lt) => { if (Lt.col !== col) { Lt.col = col; Lt.el.style.color = col; } });
        });
    }

    // ---------- the frame ----------
    function frame(now) {
        raf = 0;
        const dt = Math.min(.05, (now - last) / 1000 || .016);
        last = now;
        // ease the ruler between page scale and the map
        m += (mTarget - m) * (reduced ? 1 : 1 - Math.exp(-dt * 9));
        if (Math.abs(mTarget - m) < .002) m = mTarget;
        const s = scrollY;
        const p = Site.maxScroll ? Math.min(1, Math.max(0, s / Site.maxScroll)) : 0;
        // ticks: k per cent of the way down the ruler, at page scale or squeezed into view
        for (let k = 0; k <= 100; k++) {
            const y = (1 - m) * (k / 100 * L - s) + m * (k / 100 * H);
            const t = ticks[k];
            const v = y > -12 && y < H + 12;
            if (t._v !== v) { t._v = v; t.style.visibility = v ? '' : 'hidden'; }
            if (v) t.style.transform = `translate3d(0, ${y.toFixed(1)}px, 0)`;
        }
        headEl.style.transform = `translate3d(0, ${(p * H).toFixed(1)}px, 0)`;
        setOdo(Math.round(p * 100));
        if (hovering || dragging) {
            hoverEl.style.transform = `translate3d(0, ${hoverY.toFixed(1)}px, 0)`;
            hoverEl.firstChild.textContent = `${Math.round(pctAt(hoverY) * 100)}%`;
        }

        // the letters
        if (rollUntil && now >= rollUntil) { rollUntil = 0; layout(now, true); placeLinks(); }
        layout(now, false);
        paintColors();
        let moving = Math.abs(mTarget - m) > .002 || rollUntil > 0;
        const k = reduced ? 1 : 1 - Math.exp(-dt * 11);
        letters.forEach((Lt) => {
            if (now < Lt.wait) { moving = true; return; }
            const dx = Lt.tx - Lt.x, dy = Lt.ty - Lt.y, dr = Lt.tr - Lt.r, ds = Lt.ts - Lt.s;
            if (Math.abs(dx) + Math.abs(dy) + Math.abs(dr) + Math.abs(ds) * 40 < .05) return;
            moving = true;
            Lt.x += dx * k; Lt.y += dy * k; Lt.r += dr * k; Lt.s += ds * k;
            Lt.el.style.transform = `translate3d(${Lt.x.toFixed(1)}px, ${Lt.y.toFixed(1)}px, 0) translate(-50%, -50%) rotate(${Lt.r.toFixed(1)}deg) scale(${Lt.s.toFixed(3)})`;
        });
        if (moving || hovering || dragging) raf = requestAnimationFrame(frame);
    }
    function wake() { if (on && !raf) { last = performance.now(); raf = requestAnimationFrame(frame); } }

    // the per cent under a point on the rail, at the ruler's current scale
    function pctAt(y) {
        const q = (y + (1 - m) * scrollY) / ((1 - m) * L + m * H);
        return Math.min(1, Math.max(0, q));
    }
    function go(q, smooth) {
        window.scrollTo({ top: q * Site.maxScroll, behavior: smooth && !reduced ? 'smooth' : 'instant' });
    }

    // ---------- hover, click and drag ----------
    rail.addEventListener('pointerenter', () => {
        clearTimeout(leaveTimer);
        hovering = true;
        mTarget = 1;
        rail.classList.add('hovering', 'map');
        root.classList.add('map-on');
        layout(performance.now(), true);
        placeLinks();
        wake();
    });
    const leave = () => {
        if (dragging) return;
        clearTimeout(leaveTimer);
        leaveTimer = setTimeout(() => {
            if (dragging || nav.matches(':hover')) return;
            hovering = false;
            mTarget = 0;
            rail.classList.remove('hovering', 'map');
            root.classList.remove('map-on');
            layout(performance.now(), true);
            placeLinks();
            wake();
        }, 260);
    };
    rail.addEventListener('pointerleave', leave);
    nav.addEventListener('pointerleave', leave);
    nav.addEventListener('pointerenter', () => clearTimeout(leaveTimer));
    rail.addEventListener('pointermove', (e) => {
        hoverY = e.clientY - headH;
        if (dragging) {
            if (Math.abs(e.clientY - dragY0) > 3) dragMoved = true;
            if (dragMoved) go(pctAt(hoverY), false);
        }
        wake();
    });
    let dragY0 = 0;
    rail.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        dragging = true;
        dragMoved = false;
        dragY0 = e.clientY;
        hoverY = e.clientY - headH;
        rail.setPointerCapture(e.pointerId);
        e.preventDefault();
        wake();
    });
    const endDrag = (e) => {
        if (!dragging) return;
        dragging = false;
        if (!dragMoved) go(pctAt(e.clientY - headH), true);
        if (!rail.matches(':hover')) leave();
        wake();
    };
    rail.addEventListener('pointerup', endDrag);
    rail.addEventListener('pointercancel', () => { dragging = false; leave(); });

    // following a chapter link: scroll there, and drop back out of the map
    nav.addEventListener('click', (e) => {
        const a = e.target.closest('a');
        if (!a) return;
        e.preventDefault();
        const target = document.getElementById(a.hash.slice(1));
        if (target) target.scrollIntoView({ behavior: reduced ? 'instant' : 'smooth', block: 'start' });
        history.replaceState(null, '', a.hash);
        hovering = false;
        mTarget = 0;
        rail.classList.remove('hovering', 'map');
        root.classList.remove('map-on');
        layout(performance.now(), true);
        placeLinks();
        wake();
    });

    // ---------- the page tells us where we are ----------
    function setChapter(ci) {
        if (ci === cur) return;
        prevCur = cur;
        cur = ci;
        const now = performance.now();
        // a chapter arriving from below rolls up the ruler first; going back up it simply drops into place
        if (!reduced && ci > prevCur && mTarget === 0) { rollChapter = ci; rollUntil = now + 520; }
        else { rollUntil = 0; }
        layout(now, true);
        placeLinks();
        wake();
    }
    window.addEventListener('site:section', (e) => setChapter(chapterOf(e.detail.id)));
    window.addEventListener('site:frame', wake);
    window.addEventListener('site:measure', () => { if (on) { sizes(); layout(performance.now()); placeLinks(); wake(); } });

    // ---------- on for desktops only ----------
    function enable(v) {
        on = v;
        rail.hidden = !v;
        nav.hidden = !v;
        root.classList.toggle('has-rail', v);
        if (!v) { cancelAnimationFrame(raf); raf = 0; return; }
        measureLetters();
        sizes();
        cur = chapterOf(scenes[Math.max(0, Site.index)].id);
        layout(performance.now());
        // start every letter where it belongs, without flying in from offscreen
        letters.forEach((Lt) => { Lt.x = Lt.tx; Lt.y = Lt.ty; Lt.r = Lt.tr; Lt.s = Lt.ts; Lt.wait = 0; Lt.el.style.transform = `translate3d(${Lt.x}px, ${Lt.y}px, 0) translate(-50%, -50%) scale(${Lt.s})`; });
        placeLinks();
        wake();
    }
    desktopMQ.addEventListener('change', (e) => enable(e.matches));
    window.addEventListener('resize', () => { if (on) { sizes(); layout(performance.now()); placeLinks(); wake(); } });
    if (document.fonts) document.fonts.ready.then(() => { if (on) { measureLetters(); layout(performance.now()); placeLinks(); wake(); } });
    enable(desktopMQ.matches);
})();
