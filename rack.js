// rack.js — the 3D stage: a 19-inch cabinet built from plain HTML elements placed with CSS 3D transforms.
// The page is the timeline. Every section is a keyframe for the camera and the moving parts, and scrolling
// scrubs between them, the way a Remotion or HyperFrames composition is scrubbed frame by frame.
// Nothing is repainted per frame: the browser only re-composites flat planes, so it stays light on phones.
// One CSS pixel is one millimetre. World coordinates are y-up; CSS's y points down, so at() flips it.

const U = 44.45;                // one rack unit, mm
const RACK_W = 483;             // 19-inch faceplate
const FRONT = 400;              // z of the mounting rails
const Y0 = 120;                 // bottom of U1
const NU = 20;                  // cabinet height in U
const TOP = Y0 + NU * U;
const H = TOP + 60;             // the cabinet's overall height
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
    { key: 'atem',   kind: 'server', u: 1, label: 'ATEM-CTL', led: 'blue' },
    { key: 'tools',  kind: 'server', u: 1, label: 'TOOLS-01', led: 'blue' },
    { key: 'ping',   kind: 'server', u: 1, label: 'PING-SIDECAR', led: 'blue' },
    { key: 'blank2', kind: 'blank',  u: 1 },
    { key: 'media',  kind: 'media',  u: 4, label: 'JELLYFIN', led: 'amber' },
    { key: 'blank3', kind: 'blank',  u: 1 },
    { key: 'ups',    kind: 'ups',    u: 2, label: 'UPS' },
    { key: 'pdu',    kind: 'pdu',    u: 1 },
];
const LIGHT = new Set(['server', 'media', 'blank']);

// ---------- building blocks ----------
function div(cls, parent, css, html) {
    const d = document.createElement('div');
    if (cls) d.className = cls;
    if (css) d.style.cssText = css;
    if (html) d.innerHTML = html;
    parent.appendChild(d);
    return d;
}
const at = (x, y, z) => `translate3d(${x}px, ${-y}px, ${z}px)`;
const group = (parent, x, y, z, more = '', cls = '') => div('g' + (cls ? ' ' + cls : ''), parent, `transform: ${at(x, y, z)} ${more}`);
// a flat w × h plane centred on its group's origin, then moved by tf
const plane = (parent, w, h, tf, cls = '', html = '') => div('p' + (cls ? ' ' + cls : ''), parent, `width:${w}px;height:${h}px;margin:${-h / 2}px 0 0 ${-w / 2}px;transform:${tf}`, html);
const FACES = {
    f: (w, h, d) => [w, h, `translateZ(${d / 2}px)`],
    k: (w, h, d) => [w, h, `rotateY(180deg) translateZ(${d / 2}px)`],
    r: (w, h, d) => [d, h, `rotateY(90deg) translateZ(${w / 2}px)`],
    l: (w, h, d) => [d, h, `rotateY(-90deg) translateZ(${w / 2}px)`],
    t: (w, h, d) => [w, d, `rotateX(90deg) translateZ(${h / 2}px)`],
    b: (w, h, d) => [w, d, `rotateX(-90deg) translateZ(${h / 2}px)`],
};
// a box: only the faces named are built, since most are never seen
function box(parent, [w, h, d], [x, y, z], mat, faces = 'frltk', html = {}, more = '') {
    const g = group(parent, x, y, z, more, mat);
    const out = { g };
    for (const f of faces) { const [pw, ph, tf] = FACES[f](w, h, d); out[f] = plane(g, pw, ph, tf, f, html[f] || ''); }
    return out;
}
// artwork drawn at its own pixel size, scaled to fill a w × h mm plane
const art = (aw, ah, w, h, inner, cls = '') => `<div class="art ${cls}" style="width:${aw}px;height:${ah}px;transform:scale(${(w / aw).toFixed(5)},${(h / ah).toFixed(5)})">${inner}</div>`;
// a straight run between two world points: a ribbon along the axis, facing front. Every run here is seen from the
// front half of the room, so one ribbon is enough; each extra plane costs compositing work on every camera move.
function beam(parent, a, b, thick, cls, inner = '') {
    const dx = b[0] - a[0], dy = -(b[1] - a[1]), dz = b[2] - a[2];
    const L = Math.hypot(dx, dy, dz);
    const g = div('g', parent, `transform: ${at(...a)} rotateY(${Math.atan2(-dz, dx).toFixed(5)}rad) rotateZ(${Math.asin(dy / L).toFixed(5)}rad)`);
    g._rib = div('rb ' + cls, g, `width:${L.toFixed(1)}px;height:${thick}px;margin-top:${-thick / 2}px`, inner);
    return g;
}
const phase = () => `${(-Math.random() * 3).toFixed(2)}s`;

// ---------- faceplate artwork: 1024 px across the 19 inches, 96 px per U ----------
function faceArt(spec, y, h) {
    const W = 1024, Ht = spec.u * 96, ear = 46;
    const s = [], leds = [];
    const pos = (x, yy, w, hh) => `left:${x}px;top:${yy}px` + (w != null ? `;width:${w}px;height:${hh}px` : '');
    const el = (cls, x, yy, w, hh, extra = '') => s.push(`<i class="${cls}" style="${pos(x, yy, w, hh)};${extra}"></i>`);
    const text = (str, x, yy, size, align = '') => s.push(`<span class="ft ${align}" style="${pos(x, yy)};font-size:${size}px">${str}</span>`);
    const led = (x, yy, c, mode = '', sm = false) => leds.push(`<i class="ld ${c} ${mode}${sm ? ' sm' : ''}" style="${pos(x, yy)};--ph:${phase()}"></i>`);
    const tape = (x, yy) => s.push(`<b class="tape-art" style="${pos(x, yy)}">${spec.label}</b>`);
    [23, W - 23].forEach(x => { el('screw', x, 48); if (spec.u > 1) el('screw', x, Ht - 48); });

    switch (spec.kind) {
        case 'blank':
            el('slats', ear + 30, 14, W - 2 * ear - 60, Ht - 24);
            break;
        case 'brush':
            el('brush', ear + 40, 26, W - 2 * ear - 80, 36);
            text('CABLE PASS-THROUGH', W - ear - 50, 80, 13, 'r');
            break;
        case 'patch': {
            const gap = (W - 300 - 24 * 28) / 23;
            for (let i = 0; i < 24; i++) {
                const x = 150 + i * (28 + gap);
                el('', x - 2, 30, 32, 34, 'background:#0a1113');
                el('port', x, 32, 28, 30);
                if (i % 6 === 0) text(String(i + 1), x + 14, 80, 11, 'c');
            }
            text('24 × RJ45', 84, 48, 13, 'c');
            tape(786, 73);
            break;
        }
        case 'switch': {
            let x = 120, n = 0;
            for (let bank = 0; bank < 2; bank++) {
                for (let c = 0; c < 12; c++) {
                    for (let r = 0; r < 2; r++) {
                        el('port', x, 20 + r * 36, 26, 24);
                        const off = (c * 3 + r) % 5 === 0;
                        led(x + 13, r ? 50 : 13, off ? 'o' : ((c + r) % 7 === 3 ? 'a' : 'g'), off ? '' : (n++ % 6 === 1 ? 'link' : ''), true);
                    }
                    x += 30;
                }
                x += 20;
            }
            [x + 6, x + 52].forEach(sx => { for (let r = 0; r < 2; r++) el('sfp', sx, 20 + r * 36, 40, 26); });
            text('SYS', 80, 26, 11, 'c'); text('ACT', 80, 72, 11, 'c'); led(80, 48, 'g');
            tape(640, 73);   // clear of the leads, which plug into the top row
            break;
        }
        case 'router':
            for (let i = 0; i < 4; i++) el('port', 560 + i * 44, 30, 32, 28);
            el('sfp', 760, 28, 44, 32);
            text('WAN', 576, 76, 11); text('LAN', 664, 76, 11); text('CONSOLE', 782, 76, 11, 'c');
            text('FIREWALL', 96, 76, 13, 'c');
            el('gloss', ear + 160, 14, 300, Ht - 28);
            led(74, 40, 'g'); led(118, 40, 'a', 'act');
            tape(356, 48);
            break;
        case 'server':
            el('grille', 330, 10, W - ear - 100 - 330, Ht - 20);
            for (let i = 0; i < 2; i++) el('bay', W - ear - 92 + i * 44, 12, 38, Ht - 24);
            text('PWR', 92, 72, 10, 'c'); text('ACT', 126, 72, 10, 'c');
            led(92, 48, 'b', spec.led === 'blue' ? 'pulse' : '');
            led(126, 48, 'g', 'act');
            tape(spec.u > 1 ? 237 : 250, spec.u > 1 ? 27 : 73);
            break;
        case 'kvm':
            el('recess', ear + 40, 14, W - 2 * ear - 80, Ht - 28);
            text('CONSOLE', W - ear - 70, 48, 13, 'r');
            el('latch', W - ear - 30, 48);
            led(100, 48, 'g');
            tape(250, 73);
            break;
        case 'media':
            el('', ear, 0, W - 2 * ear, Ht, 'background:rgba(0,0,0,.06)');
            el('grille', W - ear - 46, 10, 40, Ht - 20);
            break;
        case 'ups':
            s.push(`<div class="lcd" style="${pos(140, 40, 260, 110)}"><b>ONLINE</b><span>230 V   100 %</span></div>`);
            for (let i = 0; i < 3; i++) el('btn-round', 460 + i * 46, 96);
            text('RUNTIME 42 MIN', W - ear - 24, 96, 14, 'r');
            el('grille', 600, 30, W - ear - 230 - 600, Ht - 60, '--ga:.45');
            led(90, 96, 'g');
            tape(500, 32);
            break;
        case 'pdu':
            for (let i = 0; i < 8; i++) s.push(`<i class="outlet" style="${pos(130 + i * 100, 20)}"><i></i></i>`);
            text('16 A', W - ear - 14, 48, 13, 'r');
            led(80, 48, 'g');
            break;
    }
    const bd = ((y - Y0) / (TOP - Y0)).toFixed(2);   // power-on order: bottom first
    return art(W, Ht, RACK_W, h, s.join('') + `<div class="leds" style="--bd:${bd}s">${leds.join('')}</div>`, 'abs');
}

function railArt(side) {
    const s = [];
    for (let u = 0; u < NU; u++) {
        const yb = (NU - u) * 96;
        [.143, .5, .857].forEach(f => s.push(`<i style="left:${side < 0 ? 46 : 26}px;top:${(yb - f * 96).toFixed(1)}px"></i>`));
        s.push(`<b style="${side < 0 ? 'left:8px' : 'right:8px'};top:${yb - 48}px">${String(u + 1).padStart(2, '0')}</b>`);
    }
    return art(72, NU * 96, 60, NU * U, s.join(''), 'rail-art abs');
}

// ---------- screens ----------
const SESSION = [
    ['$ anydesk 553 221 904', ''], ['connected. customer is watching', 'ok'],
    ['$ scan C:\\ for bloat', ''], ['  Windows.old         6.8 GB', 'dim'], ['  temp and caches     3.1 GB', 'dim'], ['  browser caches      2.5 GB', 'dim'],
    ['$ clean --safe', ''], ['PROGRESS', ''], ['12.4 GB freed', 'ok'], ['$ printer --wake HP-Office', ''], ['printer back online', 'ok'], ['$ _', ''],
];
const termHTML = () => `<div class="bar"><span>remote session — you can end this at any time</span><span><i style="background:#34A851"></i><i style="background:#FABB05"></i><i style="background:#E94335"></i></span></div><ol>${SESSION.map(([line, c]) => line === 'PROGRESS'
    ? `<li class="prog" hidden><span><i></i></span><b>0 %</b></li>`
    : `<li class="${c}" hidden>${line}</li>`).join('')}<li class="cur"><i class="cursor"></i></li></ol>`;

const tvHTML = () => `<p class="host">app.robocrax.com</p><p class="ttl">Quick Connect</p><p class="code">482 913</p><p class="hint">Enter this code on your phone or PC<span class="dots">.</span></p>`;

const PAD_TILES = ['PC', 'Camera 1', 'Camera 2', 'Poster'];
function padHTML() {
    const glass = (x, y, w, h, r = 18) => `<i class="gl" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px;border-radius:${r}px"></i>`;
    const t = (str, x, y, size, weight = 600, color = '#E4ECEA') => `<span class="h" style="left:${x}px;top:${y - size / 2}px;font:${weight} ${size}px/1 var(--display);color:${color}">${str}</span>`;
    const pill = (str, x, y, red) => `<span class="pill${red ? ' red' : ''}" style="left:${x}px;top:${y - 10}px">${str}</span>`;
    return glass(14, 14, 388, 314) + t('Inputs', 30, 38, 18)
        + PAD_TILES.map((name, i) => `<div class="tile src-${i}" style="left:${28 + (i % 2) * 184}px;top:${58 + Math.floor(i / 2) * 130}px"><span class="pill name">${name}</span><span class="pill red air">ON AIR</span></div>`).join('')
        + glass(414, 14, 212, 208) + `<div class="prog-tile src-0"></div>` + pill('ON AIR', 426, 158, true) + `<span class="src" style="left:500px;top:149px">PC</span>`
        + pill('Auto logo', 426, 194, true) + pill('Freeze', 506, 194)
        + glass(414, 234, 212, 94) + t('Projectors', 430, 258, 16) + t('Both on program', 430, 296, 14, 500, 'rgba(228,236,234,.6)')
        + glass(14, 342, 612, 44, 22) + `<i class="gl" style="left:26px;top:353px;width:40px;height:22px;border-radius:11px;background:#34A851;box-shadow:none"></i>`
        + t('SSMB ATEM', 78, 358, 16, 700) + t('Switcher and video connected', 78, 375, 12, 500, 'rgba(228,236,234,.6)')
        + t('1080p60', 300, 365, 14) + t('GO LIVE', 420, 365, 14)
        + `<i class="gl" style="left:360px;top:354px;width:48px;height:22px;border-radius:11px;background:rgba(255,255,255,.18);box-shadow:none"></i><i class="gl" style="left:363px;top:356px;width:18px;height:18px;border-radius:9px;background:#fff;box-shadow:none"></i>`;
}

function init() {
    const stage = document.getElementById('stage');
    const lens = document.getElementById('stage-lens');
    const persp = document.getElementById('stage-persp');
    if (!stage || !lens || !persp || !(window.CSS && CSS.supports('transform-style', 'preserve-3d'))) return;

    const world = div('world off still', persp);
    const cam = div('g', world);              // dolly: how far the camera sits from what it looks at
    const sway = div('g sway', cam);          // a slow idle drift, run by CSS on the compositor
    const root = div('g', sway);              // orbit: yaw, pitch and the point looked at

    // ---------- the cabinet ----------
    plane(root, 400, 400, `${at(0, 1, 0)} rotateX(90deg) scale(4.4)`, 'floor');
    // only the faces the camera can reach: it never goes behind the rack, and the side panels hide the rear posts
    box(root, [620, 60, 820], [0, 30, 0], 'mat-rack', 'frlt');
    [-1, 1].forEach(sx => box(root, [36, H, 36], [sx * 292, H / 2, 392], 'mat-rack', sx > 0 ? 'fr' : 'fl'));
    box(root, [620, 24, 820], [0, H + 12, 0], 'mat-rack', 'frlt');
    [-1, 1].forEach(sx => {
        plane(root, 780, H - 60, `${at(sx * 314, H / 2 + 30, 0)} rotateY(${sx * 90}deg)`, (sx > 0 ? 'r' : 'l') + ' mat-rack');   // steel outside
        plane(root, 780, H - 60, `${at(sx * 302, H / 2 + 30, 0)} rotateY(${-sx * 90}deg)`, 'in');                               // dark inside
    });
    plane(root, 580, H - 60, at(0, H / 2 + 30, -398), 'in');
    plane(root, 300, 300, `${at(316, 620, 40)} rotateY(90deg)`, 'logo-decal', '<img src="logo.svg" alt="">');

    // ---------- units ----------
    // Everything fixed to the front shares one plane: both rails and every faceplate that never moves. The browser
    // composites one layer for them instead of one each, which is most of what a camera move costs on a phone.
    // The units that slide out (web server, console drawer, tools tray) get planes of their own, just in front.
    const MOVING = new Set(['web', 'kvm', 'tools']);
    const FW = 530;                                   // rail to rail
    const frontArt = [-1, 1].map(side => `<div style="position:absolute;left:${side < 0 ? 0 : FW - 60}px;top:0;width:60px;height:${NU * U}px">${railArt(side)}</div>`);
    const units = {};
    const focus = {};
    const uy = (k) => units[k].y;
    const frameAround = (parent, key, cy, h, z) => {
        focus[key] = plane(parent, RACK_W + 16, h + 12, at(0, cy, z), 'focus');
        focus[key].hidden = true;
    };
    let off = 0;
    for (const spec of LAYOUT) {
        const h = spec.u * U, y = Y0 + (NU - off) * U - h / 2;
        off += spec.u;
        const unit = { ...spec, y, h };
        units[spec.key] = unit;
        const g = unit.g = group(root, 0, y, 0, '', 'mat-gear');
        let holder = g;
        if (spec.kind === 'kvm') holder = unit.drawer = group(g, 0, 0, 0);
        const faceCls = 'face' + (LIGHT.has(spec.kind) ? '' : ' dark');
        if (MOVING.has(spec.key)) plane(holder, RACK_W, h - 4, `translateZ(${FRONT + 8}px)`, faceCls, faceArt(spec, y, h - 4));
        else frontArt.push(`<div class="${faceCls}" style="position:absolute;left:${(FW - RACK_W) / 2}px;top:${(TOP - y - h / 2 + 2).toFixed(2)}px;width:${RACK_W}px;height:${h - 4}px;overflow:hidden">${faceArt(spec, y, h - 4)}</div>`);

        if (spec.key === 'web' || spec.key === 'tools') {
            // a chassis that slides out on its rails: floor, sides inside and out, back. Built only to be seen pulled out.
            const ch = unit.chassis = group(g, 0, 0, 0);
            plane(ch, RACK_W, 8, `translate3d(0px, ${-(h / 2 - 2)}px, ${FRONT + 4}px) rotateX(90deg)`, 't mat-face');
            plane(ch, 436, 620, `translate3d(0px, ${h / 2 - 6}px, ${FRONT - 310}px) rotateX(90deg)`, 't');
            [-1, 1].forEach(sx => {
                plane(ch, 620, h - 12, `translate3d(${sx * 218}px, 0px, ${FRONT - 310}px) rotateY(${sx * 90}deg)`, sx > 0 ? 'r' : 'l');
                plane(ch, 620, h - 12, `translate3d(${sx * 214}px, 0px, ${FRONT - 310}px) rotateY(${-sx * 90}deg)`, 'b');
            });
            plane(ch, 436, h - 12, `translate3d(0px, 0px, ${FRONT - 618}px)`, 'b');
            ch.hidden = true;
        }
        if (spec.key === 'web') {
            unit.lid = plane(unit.chassis, 436, 600, '', 't');
            const inside = unit.inside = group(g, 0, 0, 0);
            const pcb = `<i class="chip" style="left:150px;top:300px;width:46px;height:46px"></i><i class="chip" style="left:226px;top:330px;width:30px;height:30px"></i><i class="chip" style="left:40px;top:250px;width:70px;height:22px"></i>`
                + `<svg viewBox="0 0 400 480" width="400" height="480"><g fill="none" stroke="rgba(255,255,255,.14)" stroke-width="1.5"><path d="M196 323h30M173 300v-40h70M110 261h40v40M241 345h60v-90"/></g><path d="M330 120c-30 10-60 25-90 45s-40 15-40 15" fill="none" stroke="#FABB05" stroke-width="5" stroke-linecap="round"/></svg>`;
            plane(inside, 400, 480, `translate3d(0px, ${h / 2 - 9}px, ${FRONT - 340}px) rotateX(90deg)`, 'pcb', art(400, 480, 400, 480, pcb, 'abs'));
            box(inside, [85, 30, 85], [0, -h / 2 + 24, FRONT - 400], 'mat-metal', 'frlt', { t: '<div class="fins" style="position:absolute;inset:0"></div>' });
            for (let i = 0; i < 4; i++) box(inside, [4, 28, 130], [85 + i * 12, -h / 2 + 23, FRONT - 400], 'mat-ram', 'rlt');
            const fan = '<div class="fan" style="position:absolute;inset:0"></div>';
            for (let i = 0; i < 3; i++) box(inside, [38, 38, 24], [-140 + i * 50, -h / 2 + 28, FRONT - 160], 'mat-ram', 'fkt', { f: fan, k: fan });
            box(inside, [90, 34, 170], [160, -h / 2 + 23, FRONT - 530], 'mat-gear', 'frlt');
            inside.hidden = true;
        }
        if (spec.key === 'tools') {
            // an open tray of plug-in cards: one per thing built, and room for more
            const cards = unit.cards = group(g, 0, 0, 0);
            for (let i = 0; i < 12; i++) {
                const c = group(cards, -176 + i * 32, -h / 2 + 22, FRONT - 200, '', 'card');
                c.style.setProperty('--ph', `${(i * 0.473).toFixed(2)}s`);
                plane(c, 260, 26, 'rotateY(90deg)', 'p2 card-face');
                plane(c, 8, 260, 'translate3d(0px, -15.5px, 0px) rotateX(90deg)', 'p2 card-edge-' + (i % 4));
            }
            cards.hidden = true;
        }
        if (spec.kind === 'kvm') {
            // a console drawer: it pulls out, then the screen lifts like a laptop lid
            const inside = unit.inside = group(unit.drawer, 0, 0, 0);
            const keys = `<div class="keys" style="position:absolute;left:18px;top:200px;width:400px;height:270px">${art(512, 320, 400, 270, '')}</div>`;
            box(inside, [436, h - 18, 500], [0, -3, FRONT - 250], 'mat-gear', 'trl', { t: keys });
            box(inside, [300, 12, 12], [0, 0, FRONT + 14], 'mat-metal', 'ftb');
            unit.hinge = group(inside, 0, h / 2 - 11, FRONT - 300);
            const scr = `<div style="position:absolute;left:10px;top:26px;width:400px;height:225px">${art(640, 360, 400, 225, termHTML(), 'term')}</div>`;
            box(unit.hinge, [420, 6, 280], [0, 3, 140], 'mat-gear', 'tbf', { b: scr });
            unit.term = unit.hinge.querySelector('.term');
            inside.hidden = true;
        }
        if (spec.kind === 'media') {
            const tray = `<i class="grille" style="left:12px;top:12px;width:184px;height:184px"></i><i style="left:206px;top:70px;width:32px;height:110px;background:var(--face);box-shadow:inset 0 0 0 1px rgba(0,0,0,.35)"></i><i style="left:18px;top:170px;width:72px;height:24px;border-radius:3px;background:var(--face);box-shadow:0 1px 2px rgba(0,0,0,.3)"></i>`;
            const still = [];
            for (let r = 0; r < 2; r++) for (let c = 0; c < 4; c++) {
                const x = -162.75 + c * 108.5, ty = r === 0 ? 44.5 : -44.5;
                const leds = `<div class="leds" style="--bd:${((y + ty - Y0) / (TOP - Y0)).toFixed(2)}s"><i class="ld a" style="left:222px;top:30px"></i><i class="ld g act" style="left:222px;top:56px;--ph:${phase()}"></i></div>`;
                const face = art(256, 208, 102, 82, tray + leds, 'abs tray-art');
                if (r === 1 && c === 1) {
                    const t = group(g, x, ty, FRONT + 8);
                    box(t, [102, 82, 20], [0, 0, 10], 'mat-face', 'ftrl', { f: face });
                    unit.tray = { g: t, x, y: ty };
                } else {
                    still.push(`<div style="position:absolute;left:${(x - 51 + 213.75).toFixed(2)}px;top:${(85.5 - ty - 41).toFixed(2)}px;width:102px;height:82px;overflow:hidden">${face}</div>`);
                }
            }
            still.push(`<span class="tape3d" style="position:absolute;left:1px;top:3px;width:100px;height:18.75px;font-size:11.5px">${spec.label}</span>`);
            plane(g, 427.5, 171, `translateZ(${FRONT + 28}px)`, '', still.join(''));
        }
        if (['web', 'auto', 'kvm', 'atem', 'tools', 'ping', 'media', 'switch'].includes(spec.key)) {
            frameAround(unit.drawer || g, spec.key, 0, h, FRONT + (spec.kind === 'media' ? 30 : 12));
        }
    }
    // one frame around the whole tools shelf: the controller, the tools server and the ping sidecar
    frameAround(root, 'shelf', uy('tools'), 3 * U, FRONT + 12);
    plane(root, FW, NU * U, at(0, Y0 + NU * U / 2, FRONT + 7), 'front', frontArt.join(''));

    // ---------- cables ----------
    const swY = uy('switch'), patchY = uy('patch');
    const gap = (1024 - 300 - 24 * 28) / 23;
    const patchPortX = (i) => ((150 + i * (28 + gap) + 14) / 1024 - 0.5) * RACK_W;
    const swPortX = (i) => ((120 + (i % 12) * 30 + Math.floor(i / 12) * (12 * 30 + 20) + 13) / 1024 - 0.5) * RACK_W;
    // every lead on the front, drawn in one plane: patch leads from the panel to the switch, the uplink out through
    // the roof, a trunk down the right-hand channel, three drops into it from the switch, and a tap to each server
    const trunkX = 284;
    const portY = (k) => uy(k) + (k === 'web' ? 20 : 0) + (k === 'media' ? 60 : 0);
    {
        const left = -265, right = 300, top = TOP + 40, bottom = uy('ups') - 10, cw = right - left, ch = top - bottom;
        const X = (x) => (x - left).toFixed(1), Y = (yy) => (top - yy).toFixed(1);
        const colours = ['var(--harbour)', 'var(--led-green)', 'var(--led-amber)', '#E94335', '#DCE5E3'];
        const lead = (d, colour, w = 6.4) => `<path d="${d}" stroke="rgba(0,0,0,.35)" stroke-width="${w + 2.2}"/><path d="${d}" style="stroke:${colour}" stroke-width="${w}"/>`;
        let paths = lead(`M${X(trunkX)} ${Y(swY + 20)}V${Y(uy('ups') + 20)}`, 'var(--gear)', 14);
        for (let i = 0; i < 8; i++) {
            const x0 = patchPortX(i * 3), x1 = swPortX(i * 2 + (i % 2));
            paths += lead(`M${X(x0)} ${Y(patchY - 6)}C${X(x0)} ${Y(patchY - 30)} ${X(x1)} ${Y(swY + 36)} ${X(x1)} ${Y(swY + 11)}`, colours[i % 5]);
        }
        const x0 = patchPortX(0);
        paths += lead(`M${X(x0)} ${Y(patchY + 7)}C${X(x0)} ${Y(patchY + 30)} ${X(-190)} ${Y(patchY + 20)} ${X(-190)} 0`, 'var(--led-amber)', 7);
        for (let i = 0; i < 3; i++) {
            const sx = swPortX(23 - i * 2);
            paths += lead(`M${X(sx)} ${Y(swY - 12)}C${X(sx)} ${Y(swY - 34)} ${X(trunkX - 20)} ${Y(swY - 10 - i * 6)} ${X(trunkX)} ${Y(swY - 16 - i * 8)}`, colours[(i + 1) % 5]);
        }
        ['web', 'auto', 'kvm', 'atem', 'tools', 'ping', 'media', 'router'].forEach((k, i) => {
            const yy = portY(k);
            paths += lead(`M${X(trunkX)} ${Y(yy + 10)}C${X(trunkX - 30)} ${Y(yy + 10)} ${X(232)} ${Y(yy)} ${X(200)} ${Y(yy)}`, colours[i % 5]);
        });
        plane(root, cw, ch, at((left + right) / 2, (top + bottom) / 2, FRONT + 20), '', `<svg viewBox="0 0 ${cw} ${ch.toFixed(1)}" width="${cw}" height="${ch.toFixed(1)}" fill="none" stroke-linecap="round">${paths}</svg>`);
    }

    // ---------- the outside world: the internet, a TV in the lounge, a tablet, devices on the LAN ----------
    const props = {};
    {
        props.cloud = group(root, -680, 1200, 100);
        const puffs = [[0, 0, 110], [-120, -20, 85], [120, -15, 90], [30, 70, 75], [-60, 60, 60]];
        const circles = (attrs) => puffs.map(([x, y, r]) => `<circle cx="${x}" cy="${-y}" r="${r}" ${attrs}/>`).join('');
        plane(props.cloud, 460, 280, at(0, 10, 0), 'p2', `<svg viewBox="-230 -150 460 280" width="460" height="280">${circles('style="fill:color-mix(in srgb, var(--ink) 22%, var(--paper));stroke:color-mix(in srgb, var(--ink) 22%, var(--paper))" stroke-width="5"')}${circles('style="fill:var(--paper)"')}${puffs.slice(0, 3).map(([x, y, r]) => `<circle cx="${x - r * .25}" cy="${-y - r * .3}" r="${r * .55}" style="fill:color-mix(in srgb, var(--paper) 88%, #fff)" opacity=".7"/>`).join('')}</svg>`);
        plane(props.cloud, 160, 30, at(0, -170, 6), 'p2 tape3d', '<span style="font-size:19px">INTERNET</span>');
    }
    {
        props.tv = group(root, 860, 640, 120);
        const screen = `<div style="position:absolute;left:12.5px;top:12px;width:555px;height:312px">${art(768, 432, 555, 312, tvHTML(), 'tv-screen')}</div>`;
        box(props.tv, [580, 345, 22], [0, 0, 0], 'mat-gear', 'frltk', { f: screen });
        box(props.tv, [30, 80, 30], [0, -210, 0], 'mat-gear', 'frl');
        box(props.tv, [260, 12, 140], [0, -253, 20], 'mat-gear', 'frlt');
        plane(props.tv, 140, 26, at(-200, -210, 20), 'tape3d', '<span style="font-size:16px">LOUNGE TV</span>');
        props.tvDots = props.tv.querySelector('.dots');
    }
    {
        props.pad = group(root, -40, uy('atem') - 110, FRONT + 220);
        const screen = `<div style="position:absolute;left:7px;top:9px;width:256px;height:160px">${art(640, 400, 256, 160, padHTML(), 'pad-screen')}</div>`;
        box(props.pad, [270, 178, 10], [0, 0, 0], 'mat-gear', 'frltb', { f: screen });
        props.tiles = [...props.pad.querySelectorAll('.tile')];
        props.prog = props.pad.querySelector('.prog-tile');
        props.progName = props.pad.querySelector('.src');
    }
    const devSpecs = [['IOT GATEWAY', 920, 500, 200], ['HOME HUB', 1060, 330, -20], ['DB SERVER', 860, 170, 360]];
    props.devices = devSpecs.map(([label, x, y, z]) => {
        const d = group(root, x, y, z);
        const front = `<span class="tape3d" style="position:absolute;left:10px;top:6px;width:104px;height:20px;font-size:10px">${label}</span><i class="ld g act" style="position:absolute;left:128px;top:16px;width:6px;height:6px;margin:-3px;--ph:${phase()}"></i>`;
        box(d, [140, 32, 100], [0, 0, 0], 'mat-gear', 'frlt', { f: front });
        return { g: d, x, y, z };
    });

    // ---------- the door: a perforated steel panel hinged on the left ----------
    const door = group(root, -310, H / 2, 445);
    plane(door, 310, (H - 70) / 2, 'translate3d(310px, 0px, 0px) scale(2)', 'p2 door-mesh');
    box(door, [14, 120, 18], [575, 0, 14], 'mat-metal', 'frlt');

    // ---------- traffic: lanes of packets along the routes the data takes ----------
    const lanes = {};
    const lane = (key, pts, colours, w = 16) => {
        const g = div('g', root);
        for (let i = 0; i + 1 < pts.length; i++) {
            const [c, rev] = colours[0];
            const inner = `<i class="pk pc-${c}${rev ? ' rev' : ''}" style="--pd:${(150 / 520).toFixed(3)}s"></i>`;
            beam(g, pts[i], pts[i + 1], w, 'lane', inner);
        }
        g.hidden = true;
        lanes[key] = g;
    };
    const topOut = [-120, TOP + 50, 220], cloudAt = [-660, 1120, 140];
    const patchAt = [-190, patchY + 20, FRONT + 40], swOut = [250, swY, FRONT + 40];
    const trunkAt = (yy) => [trunkX, yy, FRONT + 27];
    const tapTo = (k) => [trunkAt(portY(k) + 10), [200, portY(k), FRONT + 27]];
    lane('wan', [topOut, cloudAt], [['harbour', true], ['green']]);
    lane('up', [topOut, patchAt, swOut, trunkAt(swY)], [['harbour'], ['green', true]]);
    lane('trunk', [trunkAt(swY), trunkAt(uy('ups') + 30)], [['harbour'], ['green', true]]);
    lane('tapWeb', tapTo('web'), [['harbour'], ['green', true]]);
    lane('tapAuto', tapTo('auto'), [['amber'], ['white', true]]);
    lane('tapAtem', tapTo('atem'), [['blue', true], ['green']]);
    lane('tapTools', tapTo('tools'), [['blue'], ['green', true]]);
    lane('tapPing', tapTo('ping'), [['blue', true], ['green']]);
    lane('tapMedia', tapTo('media'), [['amber', true]]);
    lane('tv', [swOut, [420, swY + 40, 400], [660, 700, 300], [840, 640, 140]], [['amber']]);
    devSpecs.forEach(([, x, y, z], i) => lane('lan' + i, [[330, swY, FRONT + 60], [600, (swY + y) / 2, 420], [x - 40, y + 10, z + 60]], [['blue'], ['green', true]], 14));
    lane('pad', [[-40, uy('atem') - 24, FRONT + 215], [-40, uy('atem'), FRONT + 20]], [['red']], 12);
    // the dashed links to the outside world, shown with the things they connect to
    const dashes = {};
    const dashed = (key, pts) => { const g = div('g', root); for (let i = 0; i + 1 < pts.length; i++) beam(g, pts[i], pts[i + 1], 3, 'dash'); g.hidden = true; g._dash = true; dashes[key] = g; };
    dashed('wan', [[-120, TOP + 50, 220], [-450, 1080, 140], [-680, 1100, 100]]);
    devSpecs.forEach(([, x, y, z], i) => dashed('lan' + i, [[330, swY, FRONT + 60], [600, (swY + y) / 2, 420], [x, y, z]]));

    // ---------- camera keyframes, one per stop on the page (distances in metres) ----------
    const DEFAULTS = { theta: 0, phi: .15, r: 2.4, tx: 0, ty: .56, tz: 0, door: 1, web: 0, kvm: 0, media: 0, tv: 0, devices: 0, cloud: 0, pad: 0, mods: 0, fWeb: 0, fAuto: 0, fMedia: 0, fPing: 0, fAtem: 0, fBase: 0, gWeb: 0, gAuto: 0, gKvm: 0, gAtem: 0, gTools: 0, gPing: 0, gMedia: 0, gSwitch: 0, gShelf: 0 };
    const m = (k) => uy(k) / 1000;
    const KF = {
        home:         { theta: .62, phi: .16, r: 3.3, ty: .6, cloud: 1, fBase: 1 },
        portfolio:    { theta: -.5, phi: .1, r: 3.4, ty: .6, cloud: 1, fWeb: 1, fBase: .4, gWeb: 1 },
        services:     { theta: .12, phi: .46, r: 3.1, ty: .55, cloud: 1, fBase: 1 },
        wordpress:    { theta: .34, phi: .4, r: 1.5, ty: m('web'), tz: .55, cloud: 1, web: 1, fWeb: 1, gWeb: 1 },
        'it-support': { theta: -.36, phi: .26, r: 1.7, ty: m('kvm') + .1, tz: FRONT / 1000 + .2, kvm: 1, gKvm: 1, fBase: .3 },
        automations:  { theta: .28, phi: .08, r: 1.5, ty: (m('switch') + m('auto')) / 2, tz: .3, cloud: 1, fAuto: 1, gAuto: 1, gSwitch: 1 },
        how:          { theta: 1.38, phi: .46, r: 3.5, ty: .5, cloud: 1, fBase: 1 },
        tools:        { theta: -.4, phi: .14, r: 1.75, ty: m('tools'), tz: .3, gShelf: 1, fBase: .6 },
        respond:      { theta: -.26, phi: .2, r: 1.55, ty: m('tools'), tz: .3, gTools: 1, fBase: .6 },
        nzquiz:       { theta: -.1, phi: .1, r: 1.5, ty: m('tools'), tz: .3, gTools: 1, fBase: .6 },
        atem:         { theta: .22, phi: .12, r: 1.5, ty: m('atem') - .05, tz: .3, cloud: 1, pad: 1, gAtem: 1, fAtem: 1, fBase: .3 },
        magento:      { theta: .3, phi: .42, r: 1.45, ty: m('tools'), tz: .55, mods: 1, gTools: 1, fBase: .6 },
        dashboards:   { theta: -.18, phi: .16, r: 1.6, ty: m('tools'), tz: .3, gTools: 1, fBase: .8 },
        heartbeats:   { theta: .5, phi: .14, r: 2.75, tx: .42, ty: .5, tz: .15, gPing: 1, devices: 1, cloud: 1, fPing: 1 },
        jellyfin:     { theta: .42, phi: .14, r: 1.6, ty: m('media') + .01, tz: .3, media: 1, gMedia: 1, fMedia: 1 },
        'tv-setup':   { theta: .2, phi: .1, r: 2.3, tx: .55, ty: .62, tz: .05, tv: 1, fMedia: 1, gMedia: .5 },
        contact:      { theta: .08, phi: .12, r: 3.7, ty: .42, door: 0, cloud: 1, fBase: 1 },
    };
    for (const k in KF) KF[k] = { ...DEFAULTS, ...KF[k] };

    // ---------- state: a target blended from two keyframes, eased toward every frame ----------
    const target = { ...DEFAULTS }, cur = { ...DEFAULTS };
    let blend = { a: 'home', b: 'home', t: 0, y: 0 };
    let mobile = false, visible = true, P = 1000, snapFrames = 2;
    let frame = null;   // the part of the stage the rack is framed in: { top, height } in px
    function retarget() {
        const A = KF[blend.a] || KF.home, B = KF[blend.b] || A;
        for (const k in DEFAULTS) target[k] = A[k] + (B[k] - A[k]) * blend.t;
        if (mobile) target.r *= 1.12;
    }

    function layout() {
        const W = stage.clientWidth, Hs = stage.clientHeight;
        const f = frame || { top: 0, height: Hs };
        P = (Math.min(f.height, W * 1.05) / 2) / Math.tan(15 * Math.PI / 180);
        persp.style.perspective = `${P.toFixed(1)}px`;
        lens.style.transform = `translateY(${(f.top + f.height / 2 - Hs / 2).toFixed(1)}px)`;
        wake();
    }

    // ---------- boot: LEDs post from the bottom up, then the door opens ----------
    let bootT0 = null, bootPhase = '', bootDone = false;
    const bootText = (text, done) => { if (text !== bootPhase) { bootPhase = text; window.dispatchEvent(new CustomEvent('rack:boot', { detail: { text, done } })); } };

    // ---------- per frame: write only what changed ----------
    const tf = (el, v) => { if (el._tf !== v) { el._tf = v; el.style.transform = v; } };
    const show = (el, on) => { if (el.hidden === on) el.hidden = !on; };
    const fo = (el, v) => {
        v = v < 0.02 ? 0 : Math.min(1, v);
        show(el, v > 0);
        const s = (v * (el._dash ? .6 : 1)).toFixed(2);
        if (el._fo !== s) { el._fo = s; for (const b of el.children) b._rib.style.opacity = s; }
    };
    const scaleProp = (g, s, extra = '') => { show(g, s > 0.002); return `${extra} scale3d(${s.toFixed(3)}, ${s.toFixed(3)}, ${s.toFixed(3)})`; };
    let time = 0, bootFlow = 0;

    function apply() {
        const r = cur.r * 1000;
        tf(cam, `translateZ(${(P - r).toFixed(1)}px)`);
        tf(root, `rotateX(${(-cur.phi).toFixed(4)}rad) rotateY(${(-cur.theta).toFixed(4)}rad) translate3d(${(-cur.tx * 1000).toFixed(1)}px, ${(cur.ty * 1000).toFixed(1)}px, ${(-cur.tz * 1000).toFixed(1)}px)`);

        const bt = time - bootT0;
        const bootDoor = clamp01((bt - 1.5) / 1.3);
        bootFlow = clamp01((bt - 2.4) / 1.0);
        tf(door, `${at(-310, H / 2, 445)} rotateY(${(-EASE(Math.min(cur.door, bootDoor)) * 2.95).toFixed(4)}rad)`);

        const web = units.web, wo = EASE(cur.web);
        tf(web.g, at(0, web.y, wo * 340));
        tf(web.lid, `translate3d(0px, ${-(web.h / 2 - 6)}px, ${(FRONT - 302 - EASE(clamp01((cur.web - .35) / .65)) * 240).toFixed(1)}px) rotateX(90deg)`);
        show(web.chassis, cur.web > 0.005);
        show(web.inside, cur.web > 0.3);
        const kvm = units.kvm;
        tf(kvm.drawer, `translate3d(0px, 0px, ${(EASE(clamp01(cur.kvm / .6)) * 460).toFixed(1)}px)`);
        tf(kvm.hinge, `translate3d(0px, ${-(kvm.h / 2 - 11)}px, ${FRONT - 300}px) rotateX(${(EASE(clamp01((cur.kvm - .4) / .6)) * 1.42).toFixed(4)}rad)`);
        show(kvm.inside, cur.kvm > 0.005);
        const tray = units.media.tray;
        tf(tray.g, at(tray.x, tray.y, FRONT + 8 + EASE(cur.media) * 85));
        const tools = units.tools;
        tf(tools.g, at(0, tools.y, EASE(cur.mods) * 340));
        show(tools.chassis, cur.mods > 0.005);
        show(tools.cards, cur.mods > 0.01);
        world.classList.toggle('mods-on', cur.mods > 0.05);

        // the cloud always turns to face the camera
        tf(props.cloud, `${at(-680, 1200, 100)} rotateY(${cur.theta.toFixed(4)}rad) rotateX(${cur.phi.toFixed(4)}rad)` + scaleProp(props.cloud, EASE(cur.cloud)));
        tf(props.tv, `${at(860, 640, 120)} rotateY(-0.42rad)` + scaleProp(props.tv, EASE(cur.tv)));
        tf(props.pad, `${at(-40, uy('atem') - 110, FRONT + 220)} rotateX(0.14rad) rotateY(0.2rad)` + scaleProp(props.pad, EASE(cur.pad)));
        props.devices.forEach(d => tf(d.g, `${at(d.x, d.y, d.z)} rotateY(-0.55rad)` + scaleProp(d.g, EASE(cur.devices))));

        for (const k in focus) {
            const g = cur['g' + k[0].toUpperCase() + k.slice(1)];
            show(focus[k], g > 0.01);
            const s = g.toFixed(2);
            if (focus[k]._o !== s) { focus[k]._o = s; focus[k].style.opacity = s; }
        }

        // traffic: each lane is as busy as the stops that use it
        const b = bootFlow, base = cur.fBase, web2 = cur.fWeb, auto = cur.fAuto, atem = cur.fAtem, ping = cur.fPing, media = cur.fMedia;
        fo(lanes.wan, b * cur.cloud * Math.max(base, web2, auto, atem, ping * .5));
        fo(lanes.up, b * Math.max(base, web2, auto, atem, ping * .5));
        fo(lanes.trunk, b * Math.max(base, web2, auto, atem, ping, media));
        fo(lanes.tapWeb, b * Math.max(base, web2, auto * .6));
        fo(lanes.tapAuto, b * auto);
        fo(lanes.tapAtem, b * Math.max(atem, base * .4));
        fo(lanes.tapTools, b * base * .7);
        fo(lanes.tapPing, b * ping);
        fo(lanes.tapMedia, b * Math.max(media, base * .4));
        fo(lanes.tv, b * media * cur.tv);
        props.devices.forEach((d, i) => { fo(lanes['lan' + i], b * ping * cur.devices); fo(dashes['lan' + i], cur.devices); });
        fo(lanes.pad, b * atem * cur.pad);
        fo(dashes.wan, cur.cloud);
        screens();
    }

    // ---------- the three screens: a remote-support session, a TV waiting for its code, the switcher controller ----------
    let screenTimer = 0, lastK = -1;
    const term = units.kvm.term;
    const termLines = [...term.querySelectorAll('li:not(.cur)')], termCur = term.querySelector('.cur'), termOl = term.querySelector('ol');
    function drawScreens(t = performance.now() / 1000) {
        if (cur.kvm > 0.3) {
            const loop = t % 14, shown = Math.floor(loop / 1.05);
            termLines.forEach((li, i) => {
                show(li, i < shown);
                if (li.classList.contains('prog') && i < shown) {
                    const p = i === shown - 1 ? clamp01((loop - i * 1.05) / 1.05) : 1;
                    li.querySelector('i').style.transform = `scaleX(${p.toFixed(3)})`;
                    li.querySelector('b').textContent = `${Math.round(p * 100)} %`;
                }
            });
            termOl.insertBefore(termCur, termLines[shown] || null);
            termCur.style.visibility = shown < termLines.length && Math.floor(t * 2) % 2 === 0 ? 'visible' : 'hidden';
        }
        if (cur.tv > 0.05) props.tvDots.textContent = '.'.repeat(1 + Math.floor(t * 1.5) % 3);
        if (cur.pad > 0.05) {
            const k = Math.floor(t / 1.9) % PAD_TILES.length;
            if (k !== lastK) {
                props.tiles.forEach((el, i) => el.classList.toggle('on', i === k));
                props.prog.className = `prog-tile src-${k}`;
                props.progName.textContent = PAD_TILES[k];
                lastK = k;
            }
        }
    }
    let drawnOnce = false;
    function screens() {
        const showing = cur.kvm > 0.3 || cur.tv > 0.05 || cur.pad > 0.05;
        const need = alive && visible && !document.hidden && showing;
        if (need && !screenTimer) { drawScreens(); screenTimer = setInterval(drawScreens, 150); }
        if (!need && screenTimer) { clearInterval(screenTimer); screenTimer = 0; }
        // with motion reduced the screens never run, so they show a finished session instead of a blank one
        if (showing && !need && !drawnOnce) { drawnOnce = true; drawScreens(13.9); }
    }

    // ---------- like a paused video, the scene holds its last frame a few seconds after the camera stops ----------
    // Running animations make the browser recomposite every plane of the cabinet on every frame, so the LEDs,
    // packets, screens and idle drift play while you scroll and for a while after, then hold still.
    let alive = false, stillTimer = 0;
    function setAlive(on) {
        if (on === alive) return;
        alive = on;
        world.classList.toggle('still', !on);
        screens();
    }
    function nudge() {
        if (reduced) return;
        setAlive(true);
        clearTimeout(stillTimer);
        stillTimer = setTimeout(() => setAlive(false), 7000);
    }

    // ---------- the loop runs only while something is moving ----------
    let raf = 0, last = 0;
    function wake() { if (!raf && visible && !document.hidden) { last = performance.now(); raf = requestAnimationFrame(tick); } }
    function tick(now) {
        raf = 0;
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now; time += dt;
        if (bootT0 === null) {
            bootT0 = time;
            if (blend.y > 60 || blend.a !== 'home' || reduced) bootT0 = time - 10;   // arriving mid-page: already running
        }
        const bt = time - bootT0;
        if (bt >= 0.35 && world.classList.contains('off')) { world.classList.remove('off'); if (bt < 2) world.classList.add('post'); }
        if (bt < 0.4) bootText('Powering on'); else if (bt < 1.5) bootText('Self-test'); else if (bt < 2.8) bootText('Opening the cabinet'); else if (!bootDone) { bootDone = true; bootText('Taking new work', true); }

        retarget();
        const snap = snapFrames > 0;
        if (snap) snapFrames--;
        const k = 1 - Math.exp(-4.2 * dt);
        let moving = false;
        for (const key in DEFAULTS) {
            const d = target[key] - cur[key];
            if (Math.abs(d) > 1e-4) moving = true;
            cur[key] = snap ? target[key] : cur[key] + d * k;
        }
        apply();
        if (moving || bt < 3.6) { nudge(); raf = requestAnimationFrame(tick); }
    }
    document.addEventListener('visibilitychange', () => { if (document.hidden) { cancelAnimationFrame(raf); raf = 0; screens(); } else wake(); });
    window.addEventListener('resize', layout);

    window.RackStage = {
        setBlend(a, b, t, y) { blend = { a, b, t, y }; wake(); },
        setMobile(m2) { if (m2 !== mobile) { mobile = m2; wake(); } },
        setFrame(top, height) { frame = { top, height }; layout(); },
        setVisible(v) { if (v === visible) return; visible = v; if (v) { wake(); nudge(); } else { cancelAnimationFrame(raf); raf = 0; } screens(); },
        keyframes: () => KF,
    };
    layout();
    document.documentElement.classList.add('rack-ready');
    window.dispatchEvent(new Event('rack:ready'));
    wake();
}

init();
