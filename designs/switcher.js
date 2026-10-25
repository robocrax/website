/* switcher.js — a small toggle for flipping between the site's designs: Dots, Rack and Bento.
   The design you switch to always opens at the top, so it starts from the beginning. On a page that isn't in the
   toggle, no design is lit.
   It floats in a corner on wider screens; on phones it sits at the end of the footer instead.
   Set it per page with data attributes on the script tag: data-corner="bl|br|tl|tr", data-x, data-y (px), and
   data-phone (px): the widest screen that gets the design's phone layout. */
(() => {
    'use strict';
    // a scatter of points, Lucide's server (ISC licence) and the Apple logo (Simple Icons, CC0) for Bento
    const ICON = {
        dots: '<circle cx="12" cy="12" r="2.6"/><circle cx="12" cy="4.4" r="1.7"/><circle cx="12" cy="19.6" r="1.7"/><circle cx="4.4" cy="12" r="1.7"/><circle cx="19.6" cy="12" r="1.7"/><circle cx="6.4" cy="6.4" r="1.15"/><circle cx="17.6" cy="6.4" r="1.15"/><circle cx="6.4" cy="17.6" r="1.15"/><circle cx="17.6" cy="17.6" r="1.15"/>',
        rack: '<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><path d="M6 6h.01M6 18h.01"/></g>',
        apple: '<path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701"/>',
    };
    const DESIGNS = [
        { file: 'index.html', name: 'Dots', icon: ICON.dots },
        { file: 'rack.html', name: 'Rack', icon: ICON.rack },
        { file: 'bento.html', name: 'Bento', icon: ICON.apple },
    ];
    const script = document.currentScript;
    // Cloudflare serves rack.html at /rack too, so match with or without the extension
    const here = (location.pathname.split('/').pop() || 'index').toLowerCase().replace(/\.html$/, '');
    const at = DESIGNS.findIndex((d) => d.file.replace(/\.html$/, '') === here);   // -1 on a page that isn't in the toggle
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

    const opt = (k, fallback) => (script && script.dataset[k]) || fallback;
    const corner = opt('corner', 'bl');
    const offX = parseFloat(opt('x', '14'));
    const offY = parseFloat(opt('y', '14'));
    const phone = `(max-width: ${parseFloat(opt('phone', '959.98'))}px)`;

    // the toggle itself: one link per design and a thumb that slides to the one you pick
    const TOGGLE = `
<nav class="seg${at < 0 ? ' none' : ''}" aria-label="Design" style="--n:${DESIGNS.length};--i:${Math.max(0, at)}">
    <span class="thumb" aria-hidden="true"></span>
    ${DESIGNS.map((d, k) => `<a href="${d.file}"${k === at ? ' class="on" aria-current="page"' : ''}><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${d.icon}</svg><span class="lbl">${d.name}</span></a>`).join('')}
</nav>`;
    const BASE = `
    .seg { position: relative; display: inline-grid; grid-auto-flow: column; grid-auto-columns: 1fr; padding: 3px; border-radius: 999px; }
    .thumb { position: absolute; top: 3px; bottom: 3px; left: 3px; width: calc((100% - 6px) / var(--n)); border-radius: 999px; transform: translateX(calc(var(--i) * 100%)); }
    a { position: relative; display: flex; align-items: center; justify-content: center; gap: 7px; padding: 0 13px; border-radius: 999px;
        color: inherit; text-decoration: none; font-weight: 600; white-space: nowrap; -webkit-tap-highlight-color: transparent; }
    a:focus-visible { outline: 2px solid #8fb4ff; outline-offset: 1px; }
    .none .thumb { display: none; }
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
            seg.classList.toggle('none', k < 0);
            seg.style.setProperty('--i', Math.max(0, k));
            links.forEach((a, j) => a.classList.toggle('on', j === k));
        };
        links.forEach((a, k) => a.addEventListener('click', (e) => {
            if (e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;   // a new tab or window: the browser's
            e.preventDefault();
            if (k === at) return;
            select(k);
            // the thumb gets to its new place, then the page follows
            const go = () => { location.href = DESIGNS[k].file; };
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
