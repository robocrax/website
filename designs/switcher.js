/* switcher.js — the small floating control for flipping between the site's designs.
   It keeps your place: the section you're reading opens in the design you switch to.
   Position it per page with data attributes on the script tag: data-corner="bl|br|tl|tr", data-x, data-y (px). */
(() => {
    'use strict';
    const DESIGNS = [
        { file: 'index.html', name: 'Signal', note: 'Particle sculptures' },
        { file: 'craft.html', name: 'Craft', note: 'A ruler down the right' },
        { file: 'rack.html', name: 'Rack', note: 'The 3D server rack' },
        { file: 'island.html', name: 'Island', note: 'A low-poly world' },
    ];
    const script = document.currentScript;
    // GitHub Pages serves craft.html at /craft too, so match with or without the extension
    const here = (location.pathname.split('/').pop() || 'index').toLowerCase().replace(/\.html$/, '');
    const active = DESIGNS.find((d) => d.file.replace(/\.html$/, '') === here) || DESIGNS[0];

    const corner = (script && script.dataset.corner) || 'bl';
    const offX = parseFloat((script && script.dataset.x) || '14');
    const offY = parseFloat((script && script.dataset.y) || '14');

    // the section you're reading: the last one whose top has passed a third of the way down the screen
    function place() {
        let id = '';
        const line = window.innerHeight * 0.35;
        document.querySelectorAll('main section[id]').forEach((s) => { if (s.getBoundingClientRect().top <= line) id = s.id; });
        return id && id !== 'home' ? `#${id}` : '';
    }

    const host = document.createElement('div');
    host.setAttribute('data-design-switcher', '');
    const root = host.attachShadow({ mode: 'open' });
    const v = corner[0] === 't' ? 'top' : 'bottom';
    const h = corner[1] === 'r' ? 'right' : 'left';
    root.innerHTML = `
<style>
    :host { all: initial; }
    .sw { position: fixed; ${v}: calc(${offY}px + env(safe-area-inset-${v}, 0px)); ${h}: ${offX}px; z-index: 2147483000;
          display: flex; flex-direction: ${v === 'bottom' ? 'column-reverse' : 'column'}; align-items: ${h === 'right' ? 'flex-end' : 'flex-start'}; gap: 8px;
          font: 500 13px/1.25 system-ui, -apple-system, "Segoe UI", sans-serif; color: #f4f5f7; -webkit-font-smoothing: antialiased; }
    button { display: inline-flex; align-items: center; gap: 8px; height: 34px; padding: 0 13px 0 10px; border: 0; border-radius: 17px; cursor: pointer;
             font: inherit; font-weight: 600; color: inherit; background: #15171c; box-shadow: 0 0 0 1px rgba(255,255,255,.14), 0 6px 18px -6px rgba(0,0,0,.55); }
    button:hover { background: #23262e; }
    button:focus-visible, a:focus-visible { outline: 2px solid #8fb4ff; outline-offset: 2px; }
    .dots { display: inline-grid; grid-template-columns: repeat(2, 6px); gap: 2px; }
    .dots i { width: 6px; height: 6px; border-radius: 1.5px; }
    .menu { min-width: 236px; padding: 6px; border-radius: 14px; background: #15171c; box-shadow: 0 0 0 1px rgba(255,255,255,.14), 0 18px 40px -12px rgba(0,0,0,.6); }
    .menu[hidden] { display: none; }
    .ttl { margin: 6px 10px 6px; font-size: 12px; font-weight: 500; color: #9aa0ad; }
    a { display: grid; grid-template-columns: 1fr auto; gap: 1px 10px; padding: 8px 10px; border-radius: 9px; color: inherit; text-decoration: none; }
    a:hover { background: #23262e; }
    a b { font-weight: 600; }
    a span { grid-column: 1; font-size: 12px; color: #9aa0ad; }
    a em { grid-row: 1 / span 2; grid-column: 2; align-self: center; font-style: normal; font-size: 11px; color: #15171c; background: #8fb4ff; padding: 2px 7px; border-radius: 9px; }
    @media (prefers-reduced-motion: no-preference) { .menu:not([hidden]) { animation: pop .14s ease-out; } }
    @keyframes pop { from { opacity: 0; transform: translateY(${v === 'bottom' ? 6 : -6}px); } to { opacity: 1; transform: none; } }
    @media print { .sw { display: none; } }
</style>
<div class="sw">
    <button type="button" aria-expanded="false" aria-controls="m" title="Switch design">
        <span class="dots" aria-hidden="true"><i style="background:#E94335"></i><i style="background:#FABB05"></i><i style="background:#34A851"></i><i style="background:#4285F4"></i></span>
        <span>Design: ${active.name}</span>
    </button>
    <div class="menu" id="m" hidden>
        <p class="ttl">Switch design</p>
        ${DESIGNS.map((d) => `<a href="${d.file}" data-file="${d.file}"${d === active ? ' aria-current="page"' : ''}><b>${d.name}</b><span>${d.note}</span>${d === active ? '<em>Viewing</em>' : ''}</a>`).join('')}
    </div>
</div>`;

    const btn = root.querySelector('button');
    const menu = root.querySelector('.menu');
    const setOpen = (on) => {
        menu.hidden = !on;
        btn.setAttribute('aria-expanded', on ? 'true' : 'false');
        if (on) (menu.querySelector('a[aria-current]') || menu.querySelector('a')).focus();
    };
    btn.addEventListener('click', () => setOpen(menu.hidden));
    root.querySelectorAll('a').forEach((a) => a.addEventListener('click', (e) => {
        e.preventDefault();
        const file = a.dataset.file;
        if (file === active.file) { setOpen(false); return; }
        location.href = file + place();
    }));
    // close on Escape, or on any click outside
    root.addEventListener('keydown', (e) => { if (e.key === 'Escape') { setOpen(false); btn.focus(); } });
    document.addEventListener('pointerdown', (e) => { if (!menu.hidden && !e.composedPath().includes(host)) setOpen(false); });

    const mount = () => document.body.appendChild(host);
    if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);
})();
