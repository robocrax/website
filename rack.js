// rack.js — the 3D stage behind the page: a 19-inch cabinet the camera tours as you scroll.
// Built from primitives and canvas textures only, so there is nothing to download but Three.js itself.
import * as THREE from './vendor/three.module.min.js';

const U = 0.04445;              // one rack unit, metres
const RACK_W = 0.483;           // 19-inch faceplate
const FRONT = 0.40;             // z of the faceplates
const Y0 = 0.12;                // bottom of U1
const NU = 20;                  // cabinet height in U
const TOP = Y0 + NU * U;
const EASE = (t) => t * t * (3 - 2 * t);
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

// top to bottom
const LAYOUT = [
    { key: 'patch',  kind: 'patch',  u: 1, label: 'PATCH-A' },
    { key: 'switch', kind: 'switch', u: 1, label: 'CORE-SW' },
    { key: 'brush',  kind: 'brush',  u: 1 },
    { key: 'router', kind: 'router', u: 1, label: 'EDGE-FW' },
    { key: 'web',    kind: 'server', u: 2, label: 'WEB-01', led: 'green' },
    { key: 'auto',   kind: 'server', u: 1, label: 'AUTO-01', led: 'green' },
    { key: 'kvm',    kind: 'kvm',    u: 1, label: 'KVM' },
    { key: 'blank1', kind: 'blank',  u: 1 },
    { key: 'tools',  kind: 'server', u: 1, label: 'TOOLS-01', led: 'blue' },
    { key: 'ping',   kind: 'server', u: 1, label: 'PING-SIDECAR', led: 'blue' },
    { key: 'blank2', kind: 'blank',  u: 1 },
    { key: 'media',  kind: 'media',  u: 4, label: 'JELLYFIN', led: 'amber' },
    { key: 'blank3', kind: 'blank',  u: 1 },
    { key: 'ups',    kind: 'ups',    u: 2, label: 'UPS' },
    { key: 'pdu',    kind: 'pdu',    u: 1 },
];

function init() {
    const canvas = document.getElementById('stage');
    let renderer;
    try {
        renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    } catch (e) {
        document.documentElement.classList.add('no-webgl');
        return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.setClearColor(0x000000, 0);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 40);
    const clock = new THREE.Clock();

    // ---------- theme: colours come from the page's CSS tokens ----------
    function readTheme() {
        const cs = getComputedStyle(document.documentElement);
        const v = (n) => cs.getPropertyValue(n).trim();
        return {
            fog: v('--fog'), paper: v('--paper'), ink: v('--ink'), slate: v('--slate'), harbour: v('--harbour'),
            rack: v('--rack'), inside: v('--rack-inside'), rail: v('--rail'), railEdge: v('--rail-edge'), railInk: v('--rail-ink'),
            face: v('--face'), faceLo: v('--face-lo'), gear: v('--gear'), tape: v('--tape'),
            green: v('--led-green'), blue: v('--led-blue'), amber: v('--led-amber'), red: '#E94335',
            dark: matchMedia('(prefers-color-scheme: dark)').matches,
        };
    }
    let T = readTheme();

    // ---------- canvas textures ----------
    const maxAniso = renderer.capabilities.getMaxAnisotropy();
    function canvasTex(w, h, draw, opts = {}) {
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        draw(c.getContext('2d'), w, h);
        const t = new THREE.CanvasTexture(c);
        if (!opts.linear) t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = Math.min(8, maxAniso);
        if (opts.repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(opts.repeat[0], opts.repeat[1]); }
        return t;
    }
    const col = (hex) => new THREE.Color(hex);
    const shade = (hex, k) => { const c = col(hex); c.multiplyScalar(1 + k); return '#' + c.getHexString(); };
    const MONO = '"IBM Plex Mono", ui-monospace, Menlo, monospace';
    const COND = '"IBM Plex Sans Condensed", "Arial Narrow", sans-serif';

    // zinc rail with three cage-nut holes per U and the U number stamped beside them
    function railTexture(side) {
        const pu = 96, w = 72, h = NU * pu;
        return canvasTex(w, h, (g) => {
            const grad = g.createLinearGradient(0, 0, w, 0);
            grad.addColorStop(0, T.railEdge); grad.addColorStop(.2, T.rail); grad.addColorStop(.8, T.rail); grad.addColorStop(1, T.railEdge);
            g.fillStyle = grad; g.fillRect(0, 0, w, h);
            const holeX = side < 0 ? w - 26 : 26, numX = side < 0 ? 8 : w - 8;
            g.textAlign = side < 0 ? 'left' : 'right'; g.textBaseline = 'middle';
            for (let u = 0; u < NU; u++) {
                const yb = h - u * pu;
                [.143, .5, .857].forEach(f => {
                    const cy = yb - f * pu, s = 19;
                    g.fillStyle = T.inside; g.fillRect(holeX - s / 2, cy - s / 2, s, s);
                    g.fillStyle = 'rgba(255,255,255,.3)'; g.fillRect(holeX - s / 2, cy + s / 2, s, 1.5);
                });
                g.fillStyle = T.railInk; g.font = `600 13px ${COND}`;
                g.fillText(String(u + 1).padStart(2, '0'), numX, yb - pu / 2);
            }
        });
    }

    // hexagonal perforation, as an alpha map for the door
    const perfTexture = () => canvasTex(96, 96, (g, w, h) => {
        g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
        g.fillStyle = '#000';
        const dx = 16, dy = 13.86;
        for (let r = -1; r < 8; r++) for (let c = -1; c < 7; c++) {
            const x = c * dx + (r % 2 ? dx / 2 : 0), y = r * dy;
            g.beginPath(); g.arc(x, y, 5.4, 0, Math.PI * 2); g.fill();
        }
    }, { linear: true, repeat: [12, 20] });

    function screw(g, x, y) {
        const r = 9;
        const rg = g.createRadialGradient(x - 3, y - 3, 1, x, y, r);
        rg.addColorStop(0, '#fff'); rg.addColorStop(.55, '#b5c0c2'); rg.addColorStop(1, '#6c7b80');
        g.fillStyle = rg; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
        g.strokeStyle = '#45545a'; g.lineWidth = 1.5; g.stroke();
        g.strokeStyle = '#3d4a4e'; g.lineWidth = 2.2; g.beginPath();
        g.moveTo(x - 5, y); g.lineTo(x + 5, y); g.moveTo(x, y - 5); g.lineTo(x, y + 5); g.stroke();
    }
    function hexGrille(g, x0, y0, x1, y1, alpha) {
        g.save(); g.beginPath(); g.rect(x0, y0, x1 - x0, y1 - y0); g.clip();
        g.fillStyle = `rgba(0,0,0,${alpha})`;
        const dx = 9, dy = 7.8;
        for (let r = 0; (y0 + r * dy) < y1 + dy; r++) for (let c = 0; (x0 + c * dx) < x1 + dx; c++) {
            g.beginPath(); g.arc(x0 + c * dx + (r % 2 ? dx / 2 : 0), y0 + r * dy, 2.4, 0, Math.PI * 2); g.fill();
        }
        g.restore();
        g.strokeStyle = 'rgba(0,0,0,.22)'; g.lineWidth = 1.5; g.strokeRect(x0 + .5, y0 + .5, x1 - x0 - 1, y1 - y0 - 1);
    }
    const port = (g, x, y, w, h) => {
        g.fillStyle = '#05090a'; g.fillRect(x, y, w, h);
        g.fillStyle = 'rgba(255,255,255,.18)'; g.fillRect(x, y, w, 2);
        g.fillStyle = '#1b2528'; g.fillRect(x + w * .3, y + h - 6, w * .4, 4);
    };

    // one faceplate texture per unit kind. 1024 px across the 19 inches, 96 px per U.
    function faceTexture(kind, u) {
        const w = 1024, h = u * 96;
        return canvasTex(w, h, (g) => {
            const light = kind === 'server' || kind === 'media' || kind === 'blank';
            const base = light ? T.face : T.gear, lo = light ? T.faceLo : shade(T.gear, -.3);
            const grad = g.createLinearGradient(0, 0, 0, h);
            grad.addColorStop(0, shade(base, light ? .03 : .12)); grad.addColorStop(.45, base); grad.addColorStop(1, lo);
            g.fillStyle = grad; g.fillRect(0, 0, w, h);
            g.fillStyle = 'rgba(255,255,255,' + (light ? .7 : .12) + ')'; g.fillRect(0, 0, w, 1.5);
            g.fillStyle = 'rgba(0,0,0,.45)'; g.fillRect(0, h - 2, w, 2);
            const ear = 46;
            g.fillStyle = 'rgba(0,0,0,.07)'; g.fillRect(0, 0, ear, h); g.fillRect(w - ear, 0, ear, h);
            g.fillStyle = 'rgba(0,0,0,.28)'; g.fillRect(ear - 1, 0, 1, h); g.fillRect(w - ear, 0, 1, h);
            [23, w - 23].forEach(x => { screw(g, x, 48); if (u > 1) screw(g, x, h - 48); });
            const text = (s, x, y, size, color, align = 'left', font = MONO) => { g.fillStyle = color; g.font = `500 ${size}px ${font}`; g.textAlign = align; g.textBaseline = 'middle'; g.fillText(s, x, y); };
            const dim = light ? 'rgba(17,38,43,.55)' : 'rgba(255,255,255,.45)';

            if (kind === 'blank') {
                g.fillStyle = 'rgba(0,0,0,.05)';
                for (let y = 14; y < h - 10; y += 8) g.fillRect(ear + 30, y, w - 2 * ear - 60, 3);
            }
            if (kind === 'brush') {
                g.fillStyle = '#020607'; g.fillRect(ear + 40, 30, w - 2 * ear - 80, 36);
                g.fillStyle = 'rgba(255,255,255,.1)';
                for (let x = ear + 42; x < w - ear - 40; x += 3) g.fillRect(x, 32, 1, 32);
                text('CABLE PASS-THROUGH', w - ear - 50, 48, 13, dim, 'right');
            }
            if (kind === 'patch') {
                const n = 24, pw = 28, ph = 30, x0 = 150, gap = (w - 300 - n * pw) / (n - 1);
                for (let i = 0; i < n; i++) {
                    const x = x0 + i * (pw + gap);
                    g.fillStyle = '#0a1113'; g.fillRect(x - 2, 30, pw + 4, ph + 4);
                    port(g, x, 32, pw, ph);
                    if (i % 6 === 0) text(String(i + 1), x + pw / 2, 78, 11, dim, 'center');
                }
                text('24 × RJ45', 80, 48, 13, dim, 'center');
            }
            if (kind === 'switch') {
                let x = 150;
                for (let bank = 0; bank < 2; bank++) {
                    for (let c = 0; c < 12; c++) {
                        for (let r = 0; r < 2; r++) port(g, x, 22 + r * 36, 30, 26);
                        x += 36;
                    }
                    x += 26;
                }
                // SFP+ uplink cages
                [x + 10, x + 56].forEach(sx => { for (let r = 0; r < 2; r++) { g.fillStyle = '#56656a'; g.fillRect(sx, 22 + r * 36, 40, 26); g.fillStyle = '#05090a'; g.fillRect(sx + 4, 26 + r * 36, 32, 18); } });
                text('SYS', 86, 28, 11, dim, 'center'); text('ACT', 86, 68, 11, dim, 'center');
                text('24G + 2 × SFP+', w - ear - 12, h - 14, 11, dim, 'right');
            }
            if (kind === 'router') {
                for (let i = 0; i < 4; i++) port(g, 560 + i * 44, 32, 32, 28);
                g.fillStyle = '#56656a'; g.fillRect(760, 30, 44, 32); g.fillStyle = '#05090a'; g.fillRect(764, 34, 36, 24);
                text('WAN', 576, 78, 11, dim, 'left'); text('LAN', 664, 78, 11, dim, 'left'); text('CONSOLE', 782, 78, 11, dim, 'center');
                text('FIREWALL', 96, 48, 13, dim, 'center');
                g.fillStyle = 'rgba(255,255,255,.05)'; g.fillRect(ear + 160, 18, 300, h - 36);
            }
            if (kind === 'server') {
                hexGrille(g, 330, 10, w - ear - 100, h - 10, light ? .3 : .45);
                // two 2.5-inch bays at the right
                for (let i = 0; i < 2; i++) {
                    const bx = w - ear - 92 + i * 44;
                    g.fillStyle = lo; g.fillRect(bx, 12, 38, h - 24);
                    g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 1; g.strokeRect(bx + .5, 12.5, 37, h - 25);
                    g.fillStyle = light ? '#fff' : '#2a383c'; g.fillRect(bx + 6, h - 34, 26, 16);
                }
                text('PWR', 92, 72, 10, dim, 'center'); text('ACT', 126, 72, 10, dim, 'center');
            }
            if (kind === 'kvm') {
                g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(ear + 40, 14, w - 2 * ear - 80, h - 28);
                text('CONSOLE', w - ear - 70, 48, 13, dim, 'right');
                g.fillStyle = '#9aa8ab'; g.beginPath(); g.arc(w - ear - 30, 48, 8, 0, Math.PI * 2); g.fill();
                g.fillStyle = '#243034'; g.fillRect(w - ear - 32, 44, 4, 8);
            }
            if (kind === 'media') {
                g.fillStyle = 'rgba(0,0,0,.06)'; g.fillRect(ear, 0, w - 2 * ear, h);
                hexGrille(g, w - ear - 46, 10, w - ear - 6, h - 10, light ? .3 : .45);
                text('8 × 3.5" HOT-SWAP', ear + 20, h - 14, 11, dim, 'left');
            }
            if (kind === 'ups') {
                g.fillStyle = '#0d1f16'; g.fillRect(140, 40, 260, 110);
                g.strokeStyle = 'rgba(255,255,255,.25)'; g.strokeRect(140.5, 40.5, 259, 109);
                text('ONLINE', 160, 70, 22, '#8FE0A8', 'left', COND);
                text('230 V   100 %', 160, 110, 18, '#8FE0A8', 'left');
                for (let i = 0; i < 3; i++) { g.fillStyle = '#56656a'; g.beginPath(); g.arc(460 + i * 46, 96, 12, 0, Math.PI * 2); g.fill(); }
                text('RUNTIME 42 MIN', w - ear - 24, 96, 14, dim, 'right');
                hexGrille(g, 600, 30, w - ear - 230, h - 30, .45);
            }
            if (kind === 'pdu') {
                for (let i = 0; i < 8; i++) {
                    const x = 130 + i * 100;
                    g.fillStyle = '#0a1113'; g.beginPath(); g.roundRect(x, 20, 70, 56, 8); g.fill();
                    g.fillStyle = '#2a383c'; [[x + 22, 36], [x + 48, 36], [x + 35, 60]].forEach(([px, py]) => { g.beginPath(); g.arc(px, py, 5, 0, Math.PI * 2); g.fill(); });
                }
                text('16 A', w - ear - 14, 48, 13, dim, 'right');
            }
        });
    }

    // label-maker tape with the unit name
    function tapeTexture(label) {
        return canvasTex(256, 48, (g, w, h) => {
            g.fillStyle = T.tape; g.fillRect(0, 0, w, h);
            g.fillStyle = 'rgba(17,38,43,.25)'; g.fillRect(0, 0, w, 1); g.fillRect(0, h - 1, w, 1);
            g.fillStyle = '#11262B'; g.font = `600 30px ${COND}`; g.textAlign = 'center'; g.textBaseline = 'middle';
            g.fillText(label, w / 2, h / 2 + 1);
        });
    }
    function trayTexture() {
        return canvasTex(256, 208, (g, w, h) => {
            g.fillStyle = T.faceLo; g.fillRect(0, 0, w, h);
            hexGrille(g, 12, 12, w - 60, h - 12, .3);
            g.fillStyle = T.face; g.fillRect(w - 50, 70, 32, 110);
            g.strokeStyle = 'rgba(0,0,0,.35)'; g.strokeRect(w - 49.5, 70.5, 31, 109);
        });
    }
    const glowTexture = () => canvasTex(64, 64, (g, w, h) => {
        const rg = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
        rg.addColorStop(0, 'rgba(255,255,255,1)'); rg.addColorStop(.25, 'rgba(255,255,255,.85)'); rg.addColorStop(.55, 'rgba(255,255,255,.25)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = rg; g.fillRect(0, 0, w, h);
    }, { linear: true });
    const discTexture = () => canvasTex(256, 256, (g, w, h) => {
        const rg = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
        const c = T.dark ? '228,236,234' : '17,38,43';
        rg.addColorStop(0, `rgba(${c},${T.dark ? .07 : .12})`); rg.addColorStop(.6, `rgba(${c},${T.dark ? .025 : .04})`); rg.addColorStop(1, `rgba(${c},0)`);
        g.fillStyle = rg; g.fillRect(0, 0, w, h);
    }, { linear: true });
    function keyboardTexture() {
        return canvasTex(512, 320, (g, w, h) => {
            g.fillStyle = '#1a2528'; g.fillRect(0, 0, w, h);
            g.fillStyle = '#2b383c';
            const rows = [14, 14, 13, 12, 8];
            rows.forEach((n, r) => { const kw = (w - 40) / 14; for (let i = 0; i < n; i++) { const x = 20 + i * kw + (14 - n) * kw / 2; g.beginPath(); g.roundRect(x + 2, 24 + r * 46, kw - 4, 38, 4); g.fill(); } });
            g.fillStyle = '#20302f'; g.beginPath(); g.roundRect(w / 2 - 70, 258, 140, 40, 6); g.fill();   // trackpad
        });
    }

    // the console drawer's screen shows a remote-support session as it runs
    const screenCanvas = document.createElement('canvas'); screenCanvas.width = 640; screenCanvas.height = 360;
    const screenTex = new THREE.CanvasTexture(screenCanvas); screenTex.colorSpace = THREE.SRGBColorSpace;
    const SESSION = [
        ['$ anydesk 553 221 904', '#D7E4E2'], ['connected. customer is watching', '#8FE0A8'],
        ['$ scan C:\\ for bloat', '#D7E4E2'], ['  Windows.old         6.8 GB', '#9AB0B1'], ['  temp and caches     3.1 GB', '#9AB0B1'], ['  browser caches      2.5 GB', '#9AB0B1'],
        ['$ clean --safe', '#D7E4E2'], ['PROGRESS', ''], ['12.4 GB freed', '#8FE0A8'], ['$ printer --wake HP-Office', '#D7E4E2'], ['printer back online', '#8FE0A8'], ['$ _', '#D7E4E2'],
    ];
    function drawScreen(time) {
        const g = screenCanvas.getContext('2d');
        g.fillStyle = '#0F2124'; g.fillRect(0, 0, 640, 360);
        g.fillStyle = '#143035'; g.fillRect(0, 0, 640, 34);
        g.font = `500 17px ${MONO}`; g.textBaseline = 'middle'; g.textAlign = 'left';
        g.fillStyle = '#9AB0B1'; g.fillText('remote session — you can end this at any time', 18, 17);
        [T.red, T.amber, T.green].forEach((c, i) => { g.fillStyle = c; g.beginPath(); g.arc(600 - i * 20, 17, 6, 0, Math.PI * 2); g.fill(); });
        const loop = (time % 14), shown = Math.floor(loop / 1.05);
        g.font = `400 18px ${MONO}`;
        let y = 62;
        for (let i = 0; i < Math.min(shown, SESSION.length); i++) {
            const [line, color] = SESSION[i];
            if (line === 'PROGRESS') {
                const p = i === shown - 1 ? clamp01((loop - i * 1.05) / 1.05) : 1;
                g.fillStyle = '#1B3237'; g.fillRect(18, y - 9, 420, 18);
                g.fillStyle = T.green; g.fillRect(18, y - 9, 420 * p, 18);
                g.fillStyle = '#D7E4E2'; g.fillText(`${Math.round(p * 100)} %`, 452, y);
            } else { g.fillStyle = color; g.fillText(line, 18, y); }
            y += 26;
        }
        if (Math.floor(time * 2) % 2 === 0 && shown < SESSION.length) { g.fillStyle = '#D7E4E2'; g.fillRect(18, y - 9, 10, 18); }
        screenTex.needsUpdate = true;
    }

    // the TV, waiting for its Quick Connect code to be authorised
    const tvCanvas = document.createElement('canvas'); tvCanvas.width = 768; tvCanvas.height = 432;
    const tvTex = new THREE.CanvasTexture(tvCanvas); tvTex.colorSpace = THREE.SRGBColorSpace;
    function drawTV(time) {
        const g = tvCanvas.getContext('2d');
        const grad = g.createLinearGradient(0, 0, 768, 432); grad.addColorStop(0, '#1c0a45'); grad.addColorStop(1, '#2b1a6b');
        g.fillStyle = grad; g.fillRect(0, 0, 768, 432);
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillStyle = 'rgba(255,255,255,.75)'; g.font = `500 26px ${COND}`; g.fillText('app.robocrax.com', 384, 70);
        g.fillStyle = '#fff'; g.font = `700 40px ${COND}`; g.fillText('Quick Connect', 384, 150);
        g.fillStyle = 'rgba(255,255,255,.08)'; g.beginPath(); g.roundRect(184, 196, 400, 110, 12); g.fill();
        g.fillStyle = '#fff'; g.font = `600 78px ${MONO}`; g.fillText('482 913', 384, 252);
        const dots = '.'.repeat(1 + Math.floor(time * 1.5) % 3);
        g.fillStyle = 'rgba(255,255,255,.7)'; g.font = `400 22px ${COND}`; g.fillText('Enter this code on your phone or PC' + dots, 384, 360);
        tvTex.needsUpdate = true;
    }

    // ---------- lighting and environment ----------
    const envScene = new THREE.Scene();
    function buildEnv() {
        envScene.clear();
        envScene.add(new THREE.Mesh(new THREE.BoxGeometry(12, 12, 12), new THREE.MeshBasicMaterial({ color: T.dark ? 0x101c1f : 0xb4c1c3, side: THREE.BackSide })));
        const panel = (w, h, pos, rot, c) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: c })); m.position.set(...pos); m.rotation.set(...rot); envScene.add(m); };
        panel(5, 2.5, [0, 5.9, 0], [Math.PI / 2, 0, 0], 0xffffff);
        panel(3, 4, [-5.9, 2.5, 1], [0, Math.PI / 2, 0], 0xeaf2f4);
        panel(2.5, 4, [5.9, 2.5, -1], [0, -Math.PI / 2, 0], 0xd8e2e4);
        panel(6, 1.2, [0, 3.5, -5.9], [0, 0, 0], 0xffffff);
        const pmrem = new THREE.PMREMGenerator(renderer);
        const tex = pmrem.fromScene(envScene, 0.04).texture;
        pmrem.dispose();
        return tex;
    }

    const lights = new THREE.Group(); scene.add(lights);
    const hemi = new THREE.HemisphereLight(0xffffff, 0x223033, 0.8); lights.add(hemi);
    const key = new THREE.DirectionalLight(0xffffff, 2.3);
    key.position.set(2.4, 3.6, 2.8); key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, { left: -2, right: 2, top: 2.4, bottom: -0.6, near: 0.5, far: 12 });
    key.shadow.bias = -0.0004; key.shadow.normalBias = 0.025;
    lights.add(key);
    const fill = new THREE.DirectionalLight(0xdfe9ec, 0.7); fill.position.set(-2.6, 1.6, 1.8); lights.add(fill);
    const rim = new THREE.DirectionalLight(0xffffff, 0.6); rim.position.set(0.6, 2.2, -3); lights.add(rim);

    // ---------- the cabinet ----------
    let root, units = {}, leds = [], focusables = {}, extras = {}, curves = {}, parts = {};
    const uy = (k) => units[k].y;

    let logoTex = null;
    function addDecal(parent) {
        const decal = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.3), new THREE.MeshBasicMaterial({ map: logoTex, transparent: true, opacity: T.dark ? .9 : 1 }));
        decal.position.set(0.3151, 0.62, 0.04); decal.rotation.y = Math.PI / 2; parent.add(decal);
    }
    const logoImg = new Image();
    logoImg.onload = () => {
        const c = document.createElement('canvas'); c.width = 512; c.height = 512;
        const g = c.getContext('2d'); const s = 420 / 628.27; g.drawImage(logoImg, 256 - 453.07 * s / 2, 46, 453.07 * s, 420);
        logoTex = new THREE.CanvasTexture(c); logoTex.colorSpace = THREE.SRGBColorSpace; logoTex.anisotropy = Math.min(8, maxAniso);
        if (root) addDecal(root);
    };
    logoImg.src = 'logo.svg';

    function build() {
        root = new THREE.Group(); scene.add(root);
        units = {}; leds = []; focusables = {}; extras = {}; parts = {};
        scene.environment = buildEnv();
        hemi.color.set(T.dark ? 0x7d9ba0 : 0xffffff); hemi.groundColor.set(T.dark ? 0x0a1416 : 0x3a4a4e); hemi.intensity = T.dark ? 0.5 : 0.8;
        key.intensity = T.dark ? 1.7 : 2.3; fill.intensity = T.dark ? 0.45 : 0.7; rim.intensity = T.dark ? 0.9 : 0.6;

        const envI = T.dark ? 0.55 : 0.75;
        const matRack = new THREE.MeshStandardMaterial({ color: col(T.rack), roughness: .55, metalness: .4, envMapIntensity: envI });
        const matInside = new THREE.MeshStandardMaterial({ color: col(T.inside), roughness: .95, metalness: .1 });
        const matGear = new THREE.MeshStandardMaterial({ color: col(T.gear), roughness: .6, metalness: .3, envMapIntensity: envI });
        const matFace = new THREE.MeshStandardMaterial({ color: col(T.face), roughness: .5, metalness: .2, envMapIntensity: envI });
        const matRailPlain = new THREE.MeshStandardMaterial({ color: col(T.rail), roughness: .4, metalness: .8, envMapIntensity: envI });
        const matMetal = new THREE.MeshStandardMaterial({ color: 0xbcc6c7, roughness: .35, metalness: .9, envMapIntensity: envI });
        parts.mats = { matRack, matInside, matGear, matFace };

        const H = TOP + 0.06;
        const add = (geo, mat, pos, parent = root, opts = {}) => {
            const m = new THREE.Mesh(geo, mat);
            m.position.set(...pos);
            m.castShadow = opts.cast !== false; m.receiveShadow = opts.receive !== false;
            parent.add(m);
            return m;
        };

        // floor shadow and the stage disc
        const floor = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), new THREE.ShadowMaterial({ opacity: T.dark ? .5 : .24 }));
        floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; root.add(floor);
        const disc = new THREE.Mesh(new THREE.CircleGeometry(1.7, 64), new THREE.MeshBasicMaterial({ map: discTexture(), transparent: true, depthWrite: false }));
        disc.rotation.x = -Math.PI / 2; disc.position.y = 0.001; root.add(disc);

        // frame: plinth, posts, top, sides, rear, interior
        add(new THREE.BoxGeometry(0.62, 0.06, 0.82), matRack, [0, 0.03, 0]);
        [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => add(new THREE.BoxGeometry(0.036, H, 0.036), matRack, [sx * 0.292, H / 2, sz * 0.392]));
        add(new THREE.BoxGeometry(0.62, 0.024, 0.82), matRack, [0, H + 0.012, 0]);
        add(new THREE.BoxGeometry(0.56, H - 0.02, 0.74), matInside, [0, H / 2 + 0.01, -0.01], root, { cast: false });
        [-1, 1].forEach(sx => add(new THREE.BoxGeometry(0.012, H - 0.06, 0.78), matRack, [sx * 0.308, H / 2 + 0.03, 0]));
        add(new THREE.BoxGeometry(0.6, H - 0.06, 0.012), matRack, [0, H / 2 + 0.03, -0.404]);
        // four casters
        [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => { const c = add(new THREE.CylinderGeometry(0.03, 0.03, 0.02, 16), matGear, [sx * 0.24, 0.0, sz * 0.3]); c.rotation.z = Math.PI / 2; });

        // mounting rails with the U numbers
        [-1, 1].forEach(side => {
            const mats = [matRailPlain, matRailPlain, matRailPlain, matRailPlain, new THREE.MeshStandardMaterial({ map: railTexture(side), roughness: .45, metalness: .75, envMapIntensity: envI }), matRailPlain];
            add(new THREE.BoxGeometry(0.06, NU * U, 0.008), mats, [side * 0.235, Y0 + NU * U / 2, FRONT - 0.006]);
        });

        // the trunk of cables down the right-hand channel, behind the faceplates
        const trunkX = 0.284, trunkZ = FRONT - 0.03;

        // ---- units ----
        let offset = 0;
        const unitLeds = (unit, specs) => specs.forEach(s => leds.push({ parent: s.parent || unit.group, local: new THREE.Vector3(s.x, s.y, s.z ?? 0.0105), color: col(s.color), mode: s.mode, phase: Math.random() * 10, intensity: 0 }));
        const px = (x, y, hpx) => [(x / 1024 - 0.5) * RACK_W, (0.5 - y / hpx) * (hpx / 96) * U];

        LAYOUT.forEach((spec, idx) => {
            const h = spec.u * U, hpx = spec.u * 96;
            const yTop = Y0 + (NU - offset) * U, y = yTop - h / 2;
            offset += spec.u;
            const group = new THREE.Group(); group.position.set(0, y, 0); root.add(group);
            const unit = { ...spec, y, h, group };
            units[spec.key] = unit;

            const faceMat = new THREE.MeshStandardMaterial({ map: faceTexture(spec.kind, spec.u), roughness: spec.kind === 'server' || spec.kind === 'media' || spec.kind === 'blank' ? .5 : .6, metalness: .25, envMapIntensity: envI });
            const face = add(new THREE.BoxGeometry(RACK_W, h - 0.004, 0.008), [faceMat, faceMat, faceMat, faceMat, faceMat, faceMat], [0, 0, FRONT + 0.004], group);
            unit.face = face;

            if (spec.kind === 'server' && spec.key === 'web') {
                // the web server opens: tray, sides, back, a sliding lid, and what is inside
                add(new THREE.BoxGeometry(0.436, 0.004, 0.62), matGear, [0, -h / 2 + 0.006, FRONT - 0.31], group);
                [-1, 1].forEach(s => add(new THREE.BoxGeometry(0.004, h - 0.012, 0.62), matGear, [s * 0.216, 0, FRONT - 0.31], group));
                add(new THREE.BoxGeometry(0.436, h - 0.012, 0.004), matGear, [0, 0, FRONT - 0.618], group);
                const lid = add(new THREE.BoxGeometry(0.436, 0.004, 0.6), matGear, [0, h / 2 - 0.006, FRONT - 0.302], group);
                unit.lid = lid; unit.lidZ = lid.position.z;
                const pcb = new THREE.MeshStandardMaterial({ color: 0x1f5e4a, roughness: .7, metalness: .1 });
                add(new THREE.PlaneGeometry(0.40, 0.48), pcb, [0, -h / 2 + 0.009, FRONT - 0.34], group).rotation.x = -Math.PI / 2;
                add(new THREE.BoxGeometry(0.085, 0.03, 0.085), matMetal, [0.0, -h / 2 + 0.024, FRONT - 0.40], group);
                for (let i = 0; i < 4; i++) add(new THREE.BoxGeometry(0.004, 0.028, 0.13), new THREE.MeshStandardMaterial({ color: 0x0b1416, roughness: .5 }), [0.085 + i * 0.012, -h / 2 + 0.023, FRONT - 0.40], group);
                for (let i = 0; i < 3; i++) {
                    const fan = add(new THREE.CylinderGeometry(0.019, 0.019, 0.024, 20), new THREE.MeshStandardMaterial({ color: 0x0b1416, roughness: .6 }), [-0.14 + i * 0.05, -h / 2 + 0.028, FRONT - 0.16], group);
                    fan.rotation.x = Math.PI / 2;
                    const hub = add(new THREE.CylinderGeometry(0.007, 0.007, 0.026, 12), matMetal, [-0.14 + i * 0.05, -h / 2 + 0.028, FRONT - 0.16], group);
                    hub.rotation.x = Math.PI / 2;
                }
                add(new THREE.BoxGeometry(0.09, 0.034, 0.17), matGear, [0.16, -h / 2 + 0.023, FRONT - 0.53], group);
                const psuCable = new THREE.CatmullRomCurve3([new THREE.Vector3(0.12, -h / 2 + 0.03, FRONT - 0.5), new THREE.Vector3(0.06, -h / 2 + 0.04, FRONT - 0.46), new THREE.Vector3(0.0, -h / 2 + 0.04, FRONT - 0.42)]);
                add(new THREE.TubeGeometry(psuCable, 20, 0.003, 6, false), new THREE.MeshStandardMaterial({ color: col(T.amber), roughness: .7 }), [0, 0, 0], group);
                unitLeds(unit, [{ x: px(92, 48, hpx)[0], y: px(92, 48, hpx)[1], color: T.blue, mode: 'on' }, { x: px(126, 48, hpx)[0], y: px(126, 48, hpx)[1], color: T.green, mode: 'activity' }]);
            } else if (spec.kind === 'server') {
                add(new THREE.BoxGeometry(0.436, h - 0.01, 0.62), matGear, [0, 0, FRONT - 0.31], group);
                const [lx, ly] = px(92, 48, hpx), [ax, ay] = px(126, 48, hpx);
                unitLeds(unit, [{ x: lx, y: ly, color: spec.led === 'blue' ? T.blue : T.blue, mode: spec.led === 'blue' ? 'pulse' : 'on' }, { x: ax, y: ay, color: T.green, mode: 'activity' }]);
            } else if (spec.kind === 'kvm') {
                // a console drawer: pulls out, then the screen lifts
                const drawer = new THREE.Group(); group.add(drawer); unit.drawer = drawer;
                drawer.add(face); face.position.set(0, 0, FRONT + 0.004);
                add(new THREE.BoxGeometry(0.436, h - 0.018, 0.5), matGear, [0, -0.003, FRONT - 0.25], drawer);
                add(new THREE.BoxGeometry(0.30, 0.012, 0.012), matMetal, [0, 0, FRONT + 0.014], drawer);
                const kb = add(new THREE.PlaneGeometry(0.40, 0.27), new THREE.MeshStandardMaterial({ map: keyboardTexture(), roughness: .8 }), [0, h / 2 - 0.0115, FRONT - 0.165], drawer, { cast: false });
                kb.rotation.x = -Math.PI / 2;
                const hinge = new THREE.Group(); hinge.position.set(0, h / 2 - 0.011, FRONT - 0.30); drawer.add(hinge); unit.hinge = hinge;
                const screenMat = new THREE.MeshBasicMaterial({ map: screenTex });
                // like a laptop: the screen is the underside of the lid, facing the keys when closed and the front when lifted
                const lid = add(new THREE.BoxGeometry(0.42, 0.006, 0.28), [matGear, matGear, matGear, screenMat, matGear, matGear], [0, 0.003, 0.14], hinge);
                unitLeds(unit, [{ x: px(100, 48, hpx)[0], y: px(100, 48, hpx)[1], color: T.green, mode: 'on', parent: drawer }]);
            } else if (spec.kind === 'media') {
                add(new THREE.BoxGeometry(0.436, h - 0.01, 0.62), matGear, [0, 0, FRONT - 0.31], group);
                const trayMat = new THREE.MeshStandardMaterial({ map: trayTexture(), roughness: .55, metalness: .2, envMapIntensity: envI });
                const latchMat = new THREE.MeshStandardMaterial({ color: col(T.face), roughness: .5, metalness: .3 });
                unit.trays = [];
                for (let r = 0; r < 2; r++) for (let c = 0; c < 4; c++) {
                    const tray = new THREE.Group();
                    tray.position.set(-0.1627 + c * 0.1085, r === 0 ? 0.0445 : -0.0445, FRONT + 0.008);
                    group.add(tray);
                    add(new THREE.BoxGeometry(0.102, 0.082, 0.02), trayMat, [0, 0, 0.01], tray);
                    add(new THREE.BoxGeometry(0.028, 0.01, 0.006), latchMat, [-0.03, -0.03, 0.022], tray);
                    unit.trays.push(tray);
                    unitLeds(unit, [{ x: 0.041, y: 0.027, z: 0.021, color: T.amber, mode: 'on', parent: tray }, { x: 0.041, y: 0.014, z: 0.021, color: T.green, mode: 'activity', parent: tray }]);
                }
            } else {
                add(new THREE.BoxGeometry(0.436, h - 0.01, spec.kind === 'blank' || spec.kind === 'brush' ? 0.02 : 0.5), matGear, [0, 0, spec.kind === 'blank' || spec.kind === 'brush' ? FRONT - 0.01 : FRONT - 0.25], group, { cast: false });
                if (spec.kind === 'switch') {
                    const specs = [];
                    let x = 150;
                    for (let bank = 0; bank < 2; bank++) { for (let c = 0; c < 12; c++) { for (let r = 0; r < 2; r++) { const [lx, ly] = px(x + 4, 18 + r * 36, hpx); specs.push({ x: lx, y: ly, color: (c + r) % 7 === 3 ? T.amber : T.green, mode: (c * 3 + r) % 5 === 0 ? 'off' : 'link' }); } x += 36; } x += 26; }
                    const [sx, sy] = px(86, 48, hpx); specs.push({ x: sx, y: sy, color: T.green, mode: 'on' });
                    unitLeds(unit, specs);
                }
                if (spec.kind === 'router') unitLeds(unit, [{ x: px(70, 48, hpx)[0], y: px(70, 48, hpx)[1], color: T.green, mode: 'on' }, { x: px(122, 48, hpx)[0], y: px(122, 48, hpx)[1], color: T.amber, mode: 'activity' }]);
                if (spec.kind === 'ups') unitLeds(unit, [{ x: px(90, 96, hpx)[0], y: px(90, 96, hpx)[1], color: T.green, mode: 'on' }]);
                if (spec.kind === 'pdu') unitLeds(unit, [{ x: px(80, 48, hpx)[0], y: px(80, 48, hpx)[1], color: T.green, mode: 'on' }]);
            }

            // label tape and the focus frame on the units the page talks about
            if (spec.label) {
                const tape = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.01875), new THREE.MeshBasicMaterial({ map: tapeTexture(spec.label), transparent: false }));
                const ty = spec.u === 1 ? -0.0115 : h / 2 - 0.0125;
                const tx = spec.kind === 'switch' || spec.kind === 'patch' || spec.kind === 'router' ? 0.13 : (spec.kind === 'media' ? -0.12 : -0.13);
                tape.position.set(tx, spec.kind === 'media' ? h / 2 - 0.0135 : ty, FRONT + 0.0085);
                (unit.drawer || group).add(tape);
                unit.tape = tape;
                if (['web', 'auto', 'kvm', 'tools', 'ping', 'media', 'switch'].includes(spec.key)) {
                    const frame = new THREE.Group(); (unit.drawer || group).add(frame);
                    const fm = new THREE.MeshBasicMaterial({ color: col(T.harbour), transparent: true, opacity: 0, depthWrite: false });
                    const W = RACK_W + 0.016, Hh = h + 0.012, t = 0.005;
                    [[0, Hh / 2, W, t], [0, -Hh / 2, W, t], [-W / 2, 0, t, Hh], [W / 2, 0, t, Hh]].forEach(([x, yy, w, hh]) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, hh, 0.004), fm); m.position.set(x, yy, FRONT + 0.012); frame.add(m); });
                    focusables[spec.key] = { frame, mat: fm, tape };
                }
            }
        });

        // ---- cables ----
        const cableMat = (hex, r = .7) => new THREE.MeshStandardMaterial({ color: col(hex), roughness: r, metalness: 0 });
        const tube = (pts, radius, mat, segs = 40) => { const c = new THREE.CatmullRomCurve3(pts, false, 'centripetal', .5); const m = new THREE.Mesh(new THREE.TubeGeometry(c, segs, radius, 7, false), mat); m.castShadow = true; root.add(m); return m; };
        const v = (x, y, z) => new THREE.Vector3(x, y, z);
        const cableColours = [T.harbour, T.green, T.amber, T.red, '#DCE5E3'];
        const patchY = uy('patch'), swY = uy('switch');
        const patchPortX = (i) => (((150 + i * ((1024 - 300) / 23)) + 14) / 1024 - 0.5) * RACK_W;
        const swPortX = (i) => (((150 + (i % 12) * 36 + Math.floor(i / 12) * (12 * 36 + 26)) + 15) / 1024 - 0.5) * RACK_W;
        for (let i = 0; i < 8; i++) {
            const pi = i * 3, si = i * 2 + (i % 2);
            const x0 = patchPortX(pi), x1 = swPortX(si);
            tube([v(x0, patchY - 0.006, FRONT + 0.012), v(x0, patchY - 0.03, FRONT + 0.05), v((x0 + x1) / 2, (patchY + swY) / 2, FRONT + 0.07), v(x1, swY + 0.035, FRONT + 0.05), v(x1, swY + 0.018, FRONT + 0.012)], 0.0033, cableMat(cableColours[i % 5]), 48);
        }
        // uplink: out of the leftmost patch port and up through the roof
        tube([v(patchPortX(0) - 0.0, patchY - 0.006, FRONT + 0.012), v(patchPortX(0), patchY - 0.03, FRONT + 0.045), v(-0.19, patchY + 0.02, FRONT + 0.045), v(-0.19, TOP + 0.02, 0.32), v(-0.12, TOP + 0.05, 0.22)], 0.0036, cableMat(T.amber), 48);
        // trunk down the right-hand channel, with a tap into each server
        const trunkBottom = uy('ups') + 0.02;
        tube([v(trunkX, swY + 0.02, trunkZ), v(trunkX, (swY + trunkBottom) / 2, trunkZ), v(trunkX, trunkBottom, trunkZ)], 0.007, cableMat(T.gear, .8), 8);
        for (let i = 0; i < 3; i++) tube([v(swPortX(23 - i * 2) + 0.004, swY - 0.016, FRONT + 0.012), v(swPortX(23 - i * 2) + 0.01, swY - 0.035, FRONT + 0.04), v(0.262, swY - 0.012 + i * 0.004, FRONT + 0.012), v(trunkX, swY + 0.01, trunkZ)], 0.0033, cableMat(cableColours[(i + 1) % 5]), 32);
        ['web', 'auto', 'kvm', 'tools', 'ping', 'media', 'router'].forEach((k, i) => {
            const y = uy(k) + (k === 'web' ? 0.02 : 0) + (k === 'media' ? 0.06 : 0);
            tube([v(trunkX, y + 0.01, trunkZ), v(0.262, y, FRONT + 0.02), v(0.2, y, FRONT + 0.014)], 0.0033, cableMat(cableColours[i % 5]), 24);
        });

        // ---- the outside world: the internet, a TV in the lounge, devices on the LAN ----
        const cloud = new THREE.Group(); cloud.position.set(-0.68, 1.2, 0.1); root.add(cloud); extras.cloud = cloud;
        const cloudMat = new THREE.MeshStandardMaterial({ color: col(T.paper), roughness: 1, metalness: 0, envMapIntensity: .4 });
        [[0, 0, 0, .11], [-.12, -.02, .02, .085], [.12, -.015, -.01, .09], [.03, .07, .0, .075], [-.06, .06, .03, .06]].forEach(([x, y, z, r]) => add(new THREE.SphereGeometry(r, 24, 18), cloudMat, [x, y, z], cloud, { cast: false }));
        const cloudTape = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.03), new THREE.MeshBasicMaterial({ map: tapeTexture('INTERNET') })); cloudTape.position.set(0, -0.17, 0.06); cloud.add(cloudTape);
        const wanLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([v(-0.12, TOP + 0.05, 0.22), v(-0.45, 1.08, 0.14), cloud.position.clone().add(v(0, -0.1, 0))]), new THREE.LineDashedMaterial({ color: col(T.slate), dashSize: 0.03, gapSize: 0.022, transparent: true, opacity: 0 }));
        wanLine.computeLineDistances(); root.add(wanLine); extras.wanLine = wanLine;

        const tv = new THREE.Group(); tv.position.set(0.86, 0.64, 0.12); tv.rotation.y = -0.42; root.add(tv); extras.tv = tv;
        add(new THREE.BoxGeometry(0.58, 0.345, 0.022), matGear, [0, 0, 0], tv);
        const tvScreen = new THREE.Mesh(new THREE.PlaneGeometry(0.555, 0.312), new THREE.MeshBasicMaterial({ map: tvTex })); tvScreen.position.z = 0.0115; tv.add(tvScreen);
        add(new THREE.BoxGeometry(0.03, 0.08, 0.03), matGear, [0, -0.21, 0], tv);
        add(new THREE.BoxGeometry(0.26, 0.012, 0.14), matGear, [0, -0.253, 0.02], tv);
        const tvTape = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 0.02625), new THREE.MeshBasicMaterial({ map: tapeTexture('LOUNGE TV') })); tvTape.position.set(-0.2, -0.21, 0.02); tv.add(tvTape);

        const devSpecs = [['IOT GATEWAY', 0.92, 0.5, 0.2], ['HOME HUB', 1.06, 0.33, -0.02], ['DB SERVER', 0.86, 0.17, 0.36]];
        extras.devices = devSpecs.map(([label, x, y, z]) => {
            const d = new THREE.Group(); d.position.set(x, y, z); d.rotation.y = -0.55; root.add(d);
            add(new THREE.BoxGeometry(0.14, 0.032, 0.1), matGear, [0, 0, 0], d);
            const tp = new THREE.Mesh(new THREE.PlaneGeometry(0.11, 0.0206), new THREE.MeshBasicMaterial({ map: tapeTexture(label) })); tp.position.set(-0.005, 0.0, 0.051); d.add(tp);
            leds.push({ parent: d, local: v(0.058, 0.0, 0.052), color: col(T.green), mode: 'activity', phase: Math.random() * 10, intensity: 0 });
            return d;
        });
        const lanPts = devSpecs.map(([, x, y, z]) => v(x, y, z));
        extras.lanLines = lanPts.map(p => { const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([v(0.33, swY, FRONT + 0.06), v(0.6, (swY + p.y) / 2, 0.42), p]), new THREE.LineDashedMaterial({ color: col(T.slate), dashSize: 0.025, gapSize: 0.02, transparent: true, opacity: 0 })); l.computeLineDistances(); root.add(l); return l; });

        // ---- the door: a perforated mesh panel hinged on the left ----
        const door = new THREE.Group(); door.position.set(-0.31, (TOP + 0.06) / 2, 0.445); root.add(door); extras.door = door;
        const dW = 0.62, dH = TOP + 0.06 - 0.07;
        [[dW / 2, dH / 2 - 0.012, dW, 0.024], [dW / 2, -dH / 2 + 0.012, dW, 0.024], [0.012, 0, 0.024, dH], [dW - 0.012, 0, 0.024, dH]].forEach(([x, y, w, h]) => add(new THREE.BoxGeometry(w, h, 0.02), matRack, [x, y, 0], door));
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(dW - 0.048, dH - 0.048), new THREE.MeshStandardMaterial({ color: col(T.rack), alphaMap: perfTexture(), alphaTest: .5, side: THREE.DoubleSide, roughness: .6, metalness: .35, envMapIntensity: envI }));
        mesh.position.set(dW / 2, 0, 0); mesh.castShadow = true; mesh.receiveShadow = true; door.add(mesh);
        add(new THREE.BoxGeometry(0.014, 0.12, 0.018), matMetal, [dW - 0.045, 0, 0.018], door);

        // ---- the logo on the side panel ----
        if (logoTex) addDecal(root);

        // ---- LEDs: one instanced core per LED and one glow sprite each ----
        const n = leds.length;
        const ledMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.0034, 8, 6), new THREE.MeshBasicMaterial({ toneMapped: false }), n);
        ledMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        for (let i = 0; i < n; i++) ledMesh.setColorAt(i, new THREE.Color(0x000000));
        root.add(ledMesh); parts.ledMesh = ledMesh;
        const glowGeo = new THREE.BufferGeometry();
        glowGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
        glowGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
        const glow = new THREE.Points(glowGeo, new THREE.PointsMaterial({ size: 0.036, map: glowTexture(), transparent: true, depthWrite: false, vertexColors: true, sizeAttenuation: true, blending: T.dark ? THREE.AdditiveBlending : THREE.NormalBlending, opacity: T.dark ? .9 : .75 }));
        root.add(glow); parts.glow = glow;

        // ---- packets riding the cables ----
        const PN = 220;
        const pGeo = new THREE.BufferGeometry();
        pGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(PN * 3), 3).setUsage(THREE.DynamicDrawUsage));
        pGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(PN * 3), 3).setUsage(THREE.DynamicDrawUsage));
        const packets = new THREE.Points(pGeo, new THREE.PointsMaterial({ size: 0.056, map: glowTexture(), transparent: true, depthWrite: false, vertexColors: true, sizeAttenuation: true, blending: T.dark ? THREE.AdditiveBlending : THREE.NormalBlending }));
        root.add(packets); parts.packets = packets; parts.PN = PN;
        for (let i = 0; i < PN; i++) pGeo.attributes.position.setXYZ(i, 0, -5, 0);

        // routes, as curves through named points
        const P = {
            cloud: v(-0.66, 1.12, 0.14), topOut: v(-0.12, TOP + 0.08, 0.22),
            patch: v(patchPortX(0), patchY - 0.012, FRONT + 0.03), sw: v(swPortX(0), swY + 0.012, FRONT + 0.03), swOut: v(0.235, swY, FRONT + 0.03),
            tv: v(0.84, 0.64, 0.14),
        };
        const trunk = (y) => v(trunkX + 0.012, y, trunkZ + 0.04);
        const portOf = (k) => v(0.2, uy(k) + (k === 'web' ? 0.02 : 0) + (k === 'media' ? 0.06 : 0), FRONT + 0.03);
        const mk = (pts) => { const c = new THREE.CatmullRomCurve3(pts, false, 'centripetal', .5); c.arcLengthDivisions = 400; c.len = c.getLength(); return c; };
        const rev = (pts) => pts.slice().reverse();
        const cloudTo = (k) => [P.cloud, v(-0.45, TOP + 0.16, 0.25), P.topOut, v(-0.19, patchY + 0.03, FRONT + 0.05), P.patch, v(P.patch.x + 0.02, (patchY + swY) / 2, FRONT + 0.06), P.sw, v(0.0, swY - 0.004, FRONT + 0.035), P.swOut, trunk(swY), trunk(uy(k) + 0.01), v(0.255, uy(k), FRONT + 0.02), portOf(k)];
        const lanTo = (p) => [portOf('ping'), v(0.255, uy('ping'), FRONT + 0.02), trunk(uy('ping') + 0.01), trunk(swY), P.swOut, v(0.33, swY, FRONT + 0.06), v(0.6, (swY + p.y) / 2, 0.42), p.clone().add(v(-0.04, 0.01, 0.06))];
        curves = {
            web: [{ c: mk(cloudTo('web')), color: col(T.harbour).lerp(col('#ffffff'), T.dark ? .4 : 0), w: 1 }, { c: mk(rev(cloudTo('web'))), color: col(T.green), w: 1 }],
            auto: [{ c: mk(cloudTo('auto')), color: col(T.amber), w: 1 }, { c: mk(rev(cloudTo('auto'))), color: col(T.green), w: .6 }, { c: mk([portOf('auto'), v(0.255, uy('auto'), FRONT + 0.02), trunk(uy('auto')), trunk(uy('web') + 0.03), v(0.255, uy('web') + 0.02, FRONT + 0.02), portOf('web')]), color: col('#DCE5E3'), w: .5 }],
            media: [{ c: mk([portOf('media'), v(0.255, uy('media') + 0.06, FRONT + 0.02), trunk(uy('media') + 0.07), trunk(swY), P.swOut, v(0.42, swY + 0.04, 0.4), v(0.66, 0.7, 0.3), P.tv]), color: col(T.amber), w: 1 }],
            ping: lanPts.flatMap(p => [{ c: mk(lanTo(p)), color: col(T.blue).lerp(col('#ffffff'), .3), w: 1 }, { c: mk(rev(lanTo(p))), color: col(T.green), w: .7 }]).concat([{ c: mk(rev(cloudTo('ping'))), color: col(T.green), w: .5 }]),
            base: [{ c: mk(cloudTo('web')), color: col(T.harbour).lerp(col('#ffffff'), T.dark ? .4 : 0), w: 1 }, { c: mk(rev(cloudTo('web'))), color: col(T.green), w: .8 }, { c: mk(cloudTo('auto')), color: col(T.amber), w: .5 }, { c: mk(rev(cloudTo('media'))), color: col(T.amber), w: .4 }, { c: mk(cloudTo('tools')), color: col(T.blue), w: .5 }, { c: mk(rev(cloudTo('tools'))), color: col(T.green), w: .4 }],
        };
    }

    // ---------- camera keyframes, one per stop on the page ----------
    const DEFAULTS = { theta: 0, phi: .15, r: 2.4, tx: 0, ty: .56, tz: 0, shiftX: 1, door: 1, web: 0, kvm: 0, media: 0, tv: 0, devices: 0, cloud: 0, fWeb: 0, fAuto: 0, fMedia: 0, fPing: 0, fBase: 0, gWeb: 0, gAuto: 0, gKvm: 0, gTools: 0, gPing: 0, gMedia: 0, gSwitch: 0 };
    let KF = {};
    function keyframes() {
        const mid = (a, b) => (uy(a) + uy(b)) / 2;
        KF = {
            home:        { theta: .62, phi: .16, r: 3.3, ty: .6, shiftX: 1, cloud: 1, fBase: 1 },
            portfolio:   { theta: -.5, phi: .1, r: 3.4, ty: .6, shiftX: -.6, cloud: 1, fWeb: 1, fBase: .4, gWeb: 1 },
            services:    { theta: .12, phi: .46, r: 3.1, ty: .55, shiftX: 1, cloud: 1, fBase: 1 },
            wordpress:   { theta: .34, phi: .4, r: 1.5, ty: uy('web'), tz: .55, shiftX: .85, cloud: 1, web: 1, fWeb: 1, gWeb: 1 },
            'it-support':{ theta: -.36, phi: .26, r: 1.7, ty: uy('kvm') + .1, tz: FRONT + .2, shiftX: -.85, kvm: 1, gKvm: 1, fBase: .3 },
            automations: { theta: .28, phi: .08, r: 1.5, tx: .0, ty: mid('switch', 'auto'), tz: .3, shiftX: .85, cloud: 1, fAuto: 1, gAuto: 1, gSwitch: 1 },
            how:         { theta: 1.38, phi: .46, r: 3.5, ty: .5, shiftX: -1, cloud: 1, fBase: 1 },
            tools:       { theta: -.4, phi: .14, r: 1.75, ty: mid('tools', 'ping'), tz: .3, shiftX: .85, gTools: 1, fBase: .6 },
            respond:     { theta: -.26, phi: .2, r: 1.55, ty: uy('tools'), tz: .3, shiftX: .85, gTools: 1, fBase: .6 },
            nzquiz:      { theta: -.1, phi: .1, r: 1.5, ty: uy('tools'), tz: .3, shiftX: .85, gTools: 1, fBase: .6 },
            heartbeats:  { theta: .5, phi: .14, r: 2.75, tx: .42, ty: .5, tz: .15, shiftX: -.35, gPing: 1, devices: 1, cloud: 1, fPing: 1 },
            jellyfin:    { theta: .42, phi: .14, r: 1.6, ty: uy('media') + .01, tz: .3, shiftX: .85, media: 1, gMedia: 1, fMedia: 1 },
            'tv-setup':  { theta: .2, phi: .1, r: 2.3, tx: .55, ty: .62, tz: .05, shiftX: -.5, tv: 1, fMedia: 1, gMedia: .5 },
            contact:     { theta: .08, phi: .12, r: 3.7, ty: .42, shiftX: 0, door: 0, cloud: 1, fBase: 1 },
        };
        for (const k in KF) KF[k] = { ...DEFAULTS, ...KF[k] };
    }

    // ---------- state: a target blended from two keyframes, damped every frame ----------
    const target = { ...DEFAULTS }, cur = { ...DEFAULTS };
    let blend = { a: 'home', b: 'home', t: 0, y: 0 }, mobile = window.innerWidth < 900, snapUntil = 0.4;
    function setBlend(a, b, t, y) { blend = { a, b, t, y }; }
    function retarget() {
        const A = KF[blend.a] || KF.home, B = KF[blend.b] || A;
        for (const k in DEFAULTS) target[k] = A[k] + (B[k] - A[k]) * blend.t;
        if (mobile) { target.shiftX = 0; target.r *= 1.55; target.ty += 0.05; }
    }

    // ---------- boot sequence: LEDs post from the bottom up, then the door opens ----------
    let bootT0 = null, bootDone = false, bootPhase = '';
    const bootText = (text, done) => { if (text !== bootPhase) { bootPhase = text; window.dispatchEvent(new CustomEvent('rack:boot', { detail: { text, done } })); } };

    // ---------- per-frame ----------
    const tmpV = new THREE.Vector3(), tmpM = new THREE.Matrix4(), tmpC = new THREE.Color(), offC = new THREE.Color();
    const live = [];   // packets in flight
    let W = 1, Hh = 1, time = 0, lastScreen = -1, lastTV = -1;
    function resize() {
        W = window.innerWidth; Hh = window.innerHeight;
        renderer.setSize(W, Hh, false);
        camera.aspect = W / Hh; camera.updateProjectionMatrix();
    }
    window.addEventListener('resize', resize);
    resize();

    function frame() {
        const dt = Math.min(0.05, clock.getDelta());
        time += dt;
        retarget();
        const snap = time < snapUntil;
        const lam = 4.2;
        for (const k in DEFAULTS) cur[k] = snap ? target[k] : THREE.MathUtils.damp(cur[k], target[k], lam, dt);

        // boot
        if (bootT0 === null) { bootT0 = time; if (blend.y > 60 || blend.a !== 'home') bootT0 = time - 10; }
        const bt = time - bootT0;
        const bootDoor = clamp01((bt - 1.5) / 1.3);
        const bootFlow = clamp01((bt - 2.4) / 1.0);
        if (bt < 0.4) bootText('Powering on'); else if (bt < 1.5) bootText('Self-test'); else if (bt < 2.8) bootText('Opening the cabinet'); else if (!bootDone) { bootDone = true; bootText('Taking new work', true); }

        // camera
        const idle = reduced ? 0 : 1;
        const theta = cur.theta + idle * 0.028 * Math.sin(time * 0.33), phi = cur.phi + idle * 0.012 * Math.sin(time * 0.27 + 1), r = cur.r;
        const tgt = tmpV.set(cur.tx, cur.ty + idle * 0.004 * Math.sin(time * 0.5), cur.tz);
        camera.position.set(tgt.x + r * Math.sin(theta) * Math.cos(phi), tgt.y + r * Math.sin(phi), tgt.z + r * Math.cos(theta) * Math.cos(phi));
        camera.lookAt(tgt);
        camera.setViewOffset(W, Hh, cur.shiftX * W * 0.235, mobile ? Hh * 0.27 : 0, W, Hh);

        // mechanics
        extras.door.rotation.y = -EASE(Math.min(cur.door, bootDoor)) * 2.95;   // swings right round to lie against the side panel
        const web = units.web; web.group.position.z = EASE(cur.web) * 0.34; web.lid.position.z = web.lidZ - EASE(clamp01((cur.web - .35) / .65)) * 0.24;
        const kvm = units.kvm; kvm.drawer.position.z = EASE(clamp01(cur.kvm / .6)) * 0.46; kvm.hinge.rotation.x = -EASE(clamp01((cur.kvm - .4) / .6)) * 1.42;
        units.media.trays[5].position.z = FRONT + 0.008 + EASE(cur.media) * 0.085;
        const sc = (o, s) => { s = Math.max(0.001, s); o.scale.setScalar(s); o.visible = s > 0.002; };
        sc(extras.tv, EASE(cur.tv)); sc(extras.cloud, EASE(cur.cloud));
        extras.devices.forEach(d => sc(d, EASE(cur.devices)));
        extras.wanLine.material.opacity = cur.cloud * .6; extras.lanLines.forEach(l => l.material.opacity = cur.devices * .6);
        for (const k in focusables) {
            const g = cur['g' + k[0].toUpperCase() + k.slice(1)];
            focusables[k].mat.opacity = g * (0.55 + 0.25 * Math.sin(time * 3));
            focusables[k].tape.scale.setScalar(1 + 0.3 * g);
        }
        if (cur.kvm > 0.3 && time - lastScreen > 0.12) { drawScreen(time); lastScreen = time; }
        if (cur.tv > 0.05 && time - lastTV > 0.3) { drawTV(time); lastTV = time; }

        // LEDs
        const glowPos = parts.glow.geometry.attributes.position, glowCol = parts.glow.geometry.attributes.color;
        offC.set(T.dark ? 0x0a1214 : 0x30393c);
        leds.forEach((l, i) => {
            const order = l.local.y + l.parent.getWorldPosition(tmpV).y;
            const boot = clamp01((bt - 0.35 - (order / TOP) * 1.0) / 0.12) * (bt < 1.5 && Math.sin(time * 18 + l.phase) < -0.6 && bt > 0.35 + (order / TOP) ? 0.5 : 1);
            let v = 1;
            switch (l.mode) {
                case 'off': v = 0; break;
                case 'activity': v = Math.sin(time * 6.5 + l.phase) * Math.sin(time * 2.9 + l.phase * 2.1) > 0.05 ? 1 : .14; break;
                case 'pulse': v = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(time * 2.4 + l.phase)); break;
                case 'link': v = Math.sin(time * 8 + l.phase) > 0.86 ? .18 : 1; break;
            }
            l.intensity = v * boot;
            tmpV.copy(l.local); l.parent.localToWorld(tmpV);
            tmpM.makeTranslation(tmpV.x, tmpV.y, tmpV.z); parts.ledMesh.setMatrixAt(i, tmpM);
            tmpC.copy(offC).lerp(l.color, l.intensity); parts.ledMesh.setColorAt(i, tmpC);
            glowPos.setXYZ(i, tmpV.x, tmpV.y, tmpV.z + 0.004);
            tmpC.copy(l.color).multiplyScalar(l.intensity * (T.dark ? 1 : .9)); glowCol.setXYZ(i, tmpC.r, tmpC.g, tmpC.b);
        });
        parts.ledMesh.instanceMatrix.needsUpdate = true; parts.ledMesh.instanceColor.needsUpdate = true;
        glowPos.needsUpdate = true; glowCol.needsUpdate = true;

        // packets
        const flows = [['web', cur.fWeb, 5], ['auto', cur.fAuto, 4], ['media', cur.fMedia, 5], ['ping', cur.fPing, 2.6], ['base', cur.fBase, 2.2]];
        if (!reduced || true) flows.forEach(([name, w, rate]) => {
            if (w < 0.03 || bootFlow <= 0) return;
            const list = curves[name];
            if (Math.random() < rate * w * bootFlow * dt && live.length < parts.PN / 3) {
                const pick = list[Math.floor(Math.random() * list.length)];
                if (Math.random() < pick.w) live.push({ c: pick.c, color: pick.color, s: 0, v: (0.55 + Math.random() * 0.25) / pick.c.len });
            }
        });
        const pPos = parts.packets.geometry.attributes.position, pCol = parts.packets.geometry.attributes.color;
        for (let i = live.length - 1; i >= 0; i--) {
            const p = live[i]; p.s += p.v * dt;
            if (p.s >= 1) { live.splice(i, 1); continue; }
        }
        // each packet is a bright head with two dimmer points trailing it, so you can see which way it is going
        let slot = 0;
        for (const p of live) {
            const fade = Math.min(1, p.s * 12, (1 - p.s) * 12);
            for (let k = 0; k < 3 && slot < parts.PN; k++, slot++) {
                p.c.getPointAt(Math.max(0, p.s - k * 0.011), tmpV);
                pPos.setXYZ(slot, tmpV.x, tmpV.y, tmpV.z);
                const f = fade * (1 - k * 0.38);
                pCol.setXYZ(slot, p.color.r * f, p.color.g * f, p.color.b * f);
            }
        }
        for (; slot < parts.PN; slot++) pPos.setXYZ(slot, 0, -5, 0);
        pPos.needsUpdate = true; pCol.needsUpdate = true;

        renderer.render(scene, camera);
    }

    let running = false;
    function loop() { if (!running) return; frame(); requestAnimationFrame(loop); }
    function start() { if (running) return; running = true; clock.getDelta(); requestAnimationFrame(loop); }
    document.addEventListener('visibilitychange', () => { if (document.hidden) running = false; else start(); });

    // ---------- theme changes rebuild the cabinet with the new tokens ----------
    function rebuild() {
        if (root) { scene.remove(root); root.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { if (m.map) m.map.dispose(); if (m.alphaMap) m.alphaMap.dispose(); m.dispose(); }); }); }
        build();
        keyframes();
    }
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { setTimeout(() => { T = readTheme(); rebuild(); }, 50); });
    if (document.fonts) document.fonts.ready.then(() => { if (root) { T = readTheme(); rebuild(); } });

    rebuild();
    window.RackStage = { setBlend, setMobile: (m) => { mobile = m; }, keyframes: () => KF };
    window.dispatchEvent(new Event('rack:ready'));
    start();
}

init();
