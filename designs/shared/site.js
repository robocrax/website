/* site.js — what every design preview shares: the analytics hook, which section is current, the Jellyfin
   client picker and the request-access form. Each design's own script draws its stage and listens for
   'site:frame' (every scroll frame: the current section, the next one and how far the page is between them)
   and 'site:section' (when the current section changes). */
(() => {
    'use strict';

    // ---------- analytics hook: if an analytics script (e.g. Umami) is added later, CTA clicks are reported ----------
    function track(name) {
        try { if (window.umami && typeof window.umami.track === 'function') window.umami.track(name); } catch (e) {}
    }
    document.addEventListener('click', (e) => {
        const el = e.target.closest('[data-track]');
        if (el) track(el.dataset.track);
    });

    // ---------- the current section ----------
    const scenes = Array.from(document.querySelectorAll('main [data-stage]'));
    const navRequest = document.getElementById('nav-request-btn');
    const navContact = document.getElementById('nav-contact-btn');
    // header links that stay lit while you read the sections they lead into
    const SUB = {
        services: ['wordpress', 'it-support', 'automations', 'how'],
        tools: ['respond', 'nzquiz', 'atem', 'dashboards', 'heartbeats', 'magento'],
        jellyfin: ['tv-setup'],
    };

    const Site = window.Site = {
        scenes,
        tops: [],
        maxScroll: 1,
        index: -1,
        track,
        // the line down the viewport that decides which section is current; a design may replace it
        probe: () => window.innerHeight * 0.42,
        // how far ahead of the next section the stage starts travelling toward it; a design may replace it
        span: () => window.innerHeight * 0.5,
        measure,
        update,
    };

    function measure() {
        const y = window.scrollY;
        Site.tops = scenes.map((s) => s.getBoundingClientRect().top + y);
        Site.maxScroll = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
        window.dispatchEvent(new Event('site:measure'));
        update();
    }

    let firstActive = true;
    function setActive(i) {
        if (i === Site.index) return;
        Site.index = i;
        const s = scenes[i];
        if (s.dataset.title) document.title = s.dataset.title;

        // "Request access" in the header only around the streaming sections
        const streaming = s.id === 'jellyfin' || s.id === 'tv-setup';
        if (navRequest) navRequest.hidden = !streaming;
        if (navContact) navContact.hidden = streaming;

        document.querySelectorAll('[data-nav]').forEach((a) => {
            const key = a.dataset.nav;
            const current = key === s.id || (SUB[key] || []).includes(s.id);
            if (current) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current');
        });
        window.dispatchEvent(new CustomEvent('site:section', { detail: { index: i, id: s.id, stage: s.dataset.stage, marker: s.dataset.marker } }));
        if (!firstActive) track(`view-${s.id}`);
        firstActive = false;
    }

    let frozen = false;   // while the request form covers the page, the current section stays put
    function update() {
        if (!scenes.length || frozen) return;
        const y = window.scrollY;
        const probe = y + Site.probe();
        const tops = Site.tops;
        let i = 0;
        for (let k = 0; k < scenes.length; k++) if (tops[k] <= probe) i = k;
        setActive(i);
        // the stage travels toward the next section while it comes up
        let t = 0;
        if (i + 1 < scenes.length) t = Math.min(1, Math.max(0, 1 - (tops[i + 1] - probe) / Math.max(1, Site.span())));
        const a = scenes[i].dataset.stage;
        const b = i + 1 < scenes.length ? scenes[i + 1].dataset.stage : a;
        window.dispatchEvent(new CustomEvent('site:frame', {
            detail: { y, i, a, b, t, progress: Math.min(1, Math.max(0, y / Site.maxScroll)) },
        }));
    }

    let ticking = false;
    window.addEventListener('scroll', () => {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(() => { ticking = false; update(); });
    }, { passive: true });
    // a deep link lands on its section even when fonts, images or a design's script change the layout above it,
    // as long as you haven't started scrolling yourself
    let userMoved = false;
    ['wheel', 'touchstart', 'keydown', 'pointerdown'].forEach((ev) => window.addEventListener(ev, () => { userMoved = true; }, { once: true, passive: true }));
    const settle = () => {
        const id = decodeURIComponent(location.hash.slice(1));
        const target = id && document.getElementById(id);
        if (target && !userMoved) target.scrollIntoView({ behavior: 'instant', block: 'start' });
    };
    window.addEventListener('load', settle);
    if (document.fonts) document.fonts.ready.then(settle);

    // a background tab holds animation frames back; catch up as soon as it's visible again
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { ticking = false; update(); } });
    window.addEventListener('resize', measure);
    window.addEventListener('load', measure);
    if (document.fonts) document.fonts.ready.then(measure);
    // images and the request form change the page height as they load
    if ('ResizeObserver' in window) new ResizeObserver(() => measure()).observe(document.body);
    measure();

    // ---------- recommend a Jellyfin client for the visitor's device ----------
    function detectClientPlatform() {
        const ua = navigator.userAgent || navigator.vendor || window.opera;
        let descText, btnText, btnHref;

        if (/android/i.test(ua)) {
            if (/tv|smarttv|googletv|appletv|hbbtv|pov_tv|netcast.tv/i.test(ua)) {
                descText = 'Detected: <strong>Android TV / Smart TV</strong>. We recommend <strong>Fladder</strong> for native TV navigation.';
                btnHref = 'https://play.google.com/store/apps/details?id=nl.jknaapen.fladder';
                btnText = 'Get Fladder on Google Play';
            } else {
                descText = 'Detected: <strong>Android Mobile / Tablet</strong>. We recommend <strong>Findroid</strong> for modern playback.';
                btnHref = 'https://play.google.com/store/apps/details?id=dev.jdtech.jellyfin';
                btnText = 'Get Findroid on Google Play';
            }
        } else if (/iPad|iPhone|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) {
            descText = 'Detected: <strong>Apple iOS / iPadOS</strong>. We recommend the official <strong>Jellyfin Mobile</strong> client.';
            btnHref = 'https://apps.apple.com/us/app/jellyfin-mobile/id1480192618';
            btnText = 'Get Jellyfin on the App Store';
        } else if (/Macintosh|Mac OS X/i.test(ua)) {
            descText = 'Detected: <strong>macOS Desktop</strong>. Download <strong>Jellyfin Media Player v2</strong>.';
            btnHref = 'https://github.com/jellyfin/jellyfin-media-player/releases';
            btnText = 'Download for Mac';
        } else if (/Windows/i.test(ua)) {
            descText = 'Detected: <strong>Windows PC</strong>. Download <strong>Jellyfin Media Player v2</strong>.';
            btnHref = 'https://github.com/jellyfin/jellyfin-media-player/releases';
            btnText = 'Download for Windows';
        } else if (/Linux/i.test(ua)) {
            descText = 'Detected: <strong>Linux Desktop</strong>. Download <strong>Jellyfin Media Player v2</strong>.';
            btnHref = 'https://github.com/jellyfin/jellyfin-media-player/releases';
            btnText = 'Download for Linux';
        } else {
            descText = 'Detected: <strong>Web / Universal Client</strong>. Browse official client downloads.';
            btnHref = 'https://jellyfin.org/downloads/clients/';
            btnText = 'Browse all clients';
        }

        const desc = document.getElementById('jellyfin-detected-client-desc');
        const btn = document.getElementById('jellyfin-detected-client-btn');
        if (desc && btn) { desc.innerHTML = descText; btn.href = btnHref; btn.textContent = btnText; }
    }
    detectClientPlatform();

    // ---------- request-access modal (the jfa-go form loads only when first opened) ----------
    const modal = document.getElementById('invite-modal');
    if (modal) {
        let lastFocus = null;
        const openModal = () => {
            const frame = modal.querySelector('iframe');
            if (!frame.src) frame.src = frame.dataset.src;
            lastFocus = document.activeElement;
            frozen = true;
            // lock the page without losing the scrollbar's width, so nothing behind the form reflows
            const bar = window.innerWidth - document.documentElement.clientWidth;
            modal.hidden = false;
            document.body.style.overflow = 'hidden';
            if (bar > 0) document.body.style.paddingRight = `${bar}px`;
            modal.querySelector('[data-close-invite]').focus({ preventScroll: true });   // focus moves; the page doesn't
            window.dispatchEvent(new Event('site:modal'));
            track('request-access-opened');
        };
        const closeModal = () => {
            modal.hidden = true;
            document.body.style.overflow = '';
            document.body.style.paddingRight = '';
            frozen = false;
            if (lastFocus) lastFocus.focus({ preventScroll: true });
            update();
        };
        if (navRequest) navRequest.addEventListener('click', openModal);
        document.querySelectorAll('[data-open-invite]').forEach((b) => b.addEventListener('click', openModal));
        modal.querySelector('[data-close-invite]').addEventListener('click', closeModal);
        modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !modal.hidden) closeModal(); });
        window.addEventListener('hashchange', () => { if (!modal.hidden) closeModal(); });   // following a link always dismisses the form
    }
})();
