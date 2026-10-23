/* switcher.js — a small toggle for flipping between the site's designs: Dots, Rack and 3D.
   It keeps your place: the section you're reading opens in the design you switch to.
   It floats in a corner on wider screens; on phones it sits at the end of the footer instead.
   Set it per page with data attributes on the script tag: data-corner="bl|br|tl|tr", data-x, data-y (px), and
   data-phone (px): the widest screen that gets the design's phone layout. */
(() => {
    'use strict';
    // a scatter of points, then Lucide's server and box (ISC licence)
    const ICON = {
        dots: '<circle cx="12" cy="12" r="2.6"/><circle cx="12" cy="4.4" r="1.7"/><circle cx="12" cy="19.6" r="1.7"/><circle cx="4.4" cy="12" r="1.7"/><circle cx="19.6" cy="12" r="1.7"/><circle cx="6.4" cy="6.4" r="1.15"/><circle cx="17.6" cy="6.4" r="1.15"/><circle cx="6.4" cy="17.6" r="1.15"/><circle cx="17.6" cy="17.6" r="1.15"/>',
        rack: '<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><path d="M6 6h.01M6 18h.01"/></g>',
        cube: '<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></g>',
    };
    const DESIGNS = [
        { file: 'index.html', name: 'Dots', icon: ICON.dots },
        { file: 'rack.html', name: 'Rack', icon: ICON.rack },
        { file: 'island.html', name: '3D', icon: ICON.cube },
    ];
    const script = document.currentScript;
    // Cloudflare serves rack.html at /rack too, so match with or without the extension
    const here = (location.pathname.split('/').pop() || 'index').toLowerCase().replace(/\.html$/, '');
    const at = Math.max(0, DESIGNS.findIndex((d) => d.file.replace(/\.html$/, '') === here));
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

    const opt = (k, fallback) => (script && script.dataset[k]) || fallback;
    const corner = opt('corner', 'bl');
    const offX = parseFloat(opt('x', '14'));
    const offY = parseFloat(opt('y', '14'));
    const phone = `(max-width: ${parseFloat(opt('phone', '959.98'))}px)`;

    // the section you're reading: the last one whose top has passed a third of the way down the screen
    function place() {
        let id = '';
        const line = window.innerHeight * 0.35;
        document.querySelectorAll('main section[id]').forEach((s) => { if (s.getBoundingClientRect().top <= line) id = s.id; });
        return id && id !== 'home' ? `#${id}` : '';
    }

    // the toggle itself: one link per design and a thumb that slides to the one you pick
    const TOGGLE = `
<nav class="seg" aria-label="Design" style="--n:${DESIGNS.length};--i:${at}">
    <span class="thumb" aria-hidden="true"></span>
    ${DESIGNS.map((d, k) => `<a href="${d.file}"${k === at ? ' class="on" aria-current="page"' : ''}><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${d.icon}</svg><span class="lbl">${d.name}</span></a>`).join('')}
</nav>`;
    const BASE = `
    .seg { position: relative; display: inline-grid; grid-auto-flow: column; grid-auto-columns: 1fr; padding: 3px; border-radius: 999px; }
    .thumb { position: absolute; top: 3px; bottom: 3px; left: 3px; width: calc((100% - 6px) / var(--n)); border-radius: 999px; transform: translateX(calc(var(--i) * 100%)); }
    a { position: relative; display: flex; align-items: center; justify-content: center; gap: 7px; padding: 0 13px; border-radius: 999px;
        color: inherit; text-decoration: none; font-weight: 600; white-space: nowrap; -webkit-tap-highlight-color: transparent; }
    a:focus-visible { outline: 2px solid #8fb4ff; outline-offset: 1px; }
    svg { width: 16px; height: 16px; flex: none; }
    @media (prefers-reduced-motion: no-preference) {
        .thumb { transition: transform .22s cubic-bezier(.3, .7, .3, 1); }
        a { transition: color .22s, opacity .22s; }
    }
    @media print { :host { display: none !important; } }`;

    function mount(css, html) {
        const host = document.createElement('div');
        host.setAttribute('data-design-switcher', '');
        const root = host.attachShadow({ mode: 'open' });
        root.innerHTML = `<style>${BASE}${css}</style>${html}`;
        const seg = root.querySelector('.seg');
        const links = [...root.querySelectorAll('a')];
        const select = (k) => {
            seg.style.setProperty('--i', k);
            links.forEach((a, j) => a.classList.toggle('on', j === k));
        };
        links.forEach((a, k) => a.addEventListener('click', (e) => {
            if (e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;   // a new tab or window: the browser's
            e.preventDefault();
            if (k === at) return;
            select(k);
            // the thumb gets to its new place, then the page follows
            const go = () => { location.href = DESIGNS[k].file + place(); };
            if (reduced) go(); else setTimeout(go, 200);
        }));
        // the Back button can bring this page back exactly as it was left, mid-switch
        window.addEventListener('pageshow', (e) => { if (e.persisted) select(at); });
        return host;
    }

    // ---------- wider screens: floating in a corner ----------
    const v = corner[0] === 't' ? 'top' : 'bottom';
    const h = corner[1] === 'r' ? 'right' : 'left';
    const foot = document.querySelector('.site-foot .copy');
    const floating = mount(`
    :host { all: initial; }
    .float { position: fixed; ${v}: calc(${offY}px + env(safe-area-inset-${v}, 0px)); ${h}: ${offX}px; z-index: 2147483000;
             font: 600 13px/1 system-ui, -apple-system, "Segoe UI", sans-serif; color: #9aa0ad; -webkit-font-smoothing: antialiased; }
    ${foot ? `@media ${phone} { .float { display: none; } }` : ''}
    .seg { background: #15171c; box-shadow: 0 0 0 1px rgba(255,255,255,.14), 0 6px 18px -6px rgba(0,0,0,.55); }
    .thumb { background: #f4f5f7; }
    a { height: 30px; }
    a:hover { color: #f4f5f7; }
    a.on { color: #15171c; }
    /* with a mouse there's room for a tip, so each design is just its icon until you point at it */
    @media (hover: hover) and (pointer: fine) {
        a { width: 34px; padding: 0; }
        .lbl { position: absolute; ${v}: calc(100% + 10px); left: 50%; translate: -50% 0; padding: 6px 9px; border-radius: 7px;
               color: #f4f5f7; background: #15171c; box-shadow: 0 0 0 1px rgba(255,255,255,.14), 0 6px 18px -6px rgba(0,0,0,.55);
               opacity: 0; pointer-events: none; transition: opacity .12s; }
        a:hover .lbl, a:focus-visible .lbl { opacity: 1; }
    }`, `<div class="float">${TOGGLE}</div>`);
    document.body.appendChild(floating);

    // ---------- phones: at the end of the footer, in the design's own type and colours ----------
    if (foot) {
        foot.appendChild(mount(`
    :host { display: block; margin-top: 22px; }
    @media not all and ${phone} { :host { display: none; } }
    .row { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 14px; }
    .row > span { font-size: 14px; opacity: .7; }
    .seg { background: color-mix(in srgb, currentColor 6%, transparent); box-shadow: inset 0 0 0 1px color-mix(in srgb, currentColor 18%, transparent); }
    .thumb { background: color-mix(in srgb, currentColor 16%, transparent); box-shadow: inset 0 0 0 1px color-mix(in srgb, currentColor 24%, transparent); }
    a { height: 40px; padding: 0 15px; font-size: 15px; opacity: .68; }
    a.on { opacity: 1; }`, `<div class="row"><span aria-hidden="true">Design</span>${TOGGLE}</div>`));
    }
})();
