// signal.js — the Signal design's stage: one cloud of points that takes a new shape for every section.
// Scrolling morphs the cloud from one section's shape into the next. The pointer parts the cloud as it passes
// through, a drag turns the shape and a click beside the text sends a pulse through it.
// It is one draw call with no post-processing, and the loop sleeps a few seconds after things stop moving.
import * as THREE from '../../vendor/three.module.min.js';

const canvas = document.getElementById('stage-canvas');
const stageEl = document.getElementById('stage');
const hint = document.getElementById('stage-hint');
const header = document.querySelector('.site-head');
const progressEl = document.querySelector('.progress i');
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const phoneMQ = matchMedia('(max-width: 959.98px)');

const COUNT = phoneMQ.matches ? 15000 : 30000;
const CORE = Math.floor(COUNT * 0.9);          // the rest drift as dust around the shape
const FOV = 35;
const HOLD_MS = 8000;                           // keep breathing this long after the last scroll or pointer move

// which shape each section takes
const SHAPE_OF = {
    home: 'logo', portfolio: 'windows', services: 'orbs', wordpress: 'rack', 'it-support': 'laptop',
    automations: 'knot', how: 'rings', tools: 'gear', respond: 'phone', nzquiz: 'sign', atem: 'multiview',
    dashboards: 'dash', heartbeats: 'ecg', magento: 'cubes', jellyfin: 'play', 'tv-setup': 'code', contact: 'chat',
    // the Jellyfin page
    'jf-plans': 'rack', 'jf-features': 'multiview', 'jf-setup': 'laptop',
};
// spin: turns continuously (rad/s); amp: sways about facing you instead; tilt: looks down on it; fill: share of the frame
const POSE = {
    void:      { amp: 0,   tilt: 0,   fill: .9 },
    logo:      { amp: .45, tilt: .05, fill: .8 },
    windows:   { amp: .24, tilt: .05, fill: .94 },
    orbs:      { spin: .22, tilt: .14, fill: .84 },
    rack:      { spin: .16, tilt: .16, fill: .86 },
    laptop:    { amp: .55, tilt: .34, fill: .88 },
    knot:      { spin: .2,  tilt: .22, fill: .86 },
    rings:     { spin: .24, tilt: .4,  fill: .84 },
    gear:      { amp: .45, tilt: .12, fill: .8, roll: .14 },
    phone:     { amp: .42, tilt: .04, fill: .86 },
    sign:      { amp: .42, tilt: .03, fill: .86 },
    multiview: { amp: .28, tilt: .05, fill: .84 },
    dash:      { spin: .14, tilt: .32, fill: .82 },
    ecg:       { amp: .36, tilt: .3,  fill: .92 },
    cubes:     { spin: .18, tilt: .45, fill: .78 },
    play:      { amp: .3,  tilt: .04, fill: .82 },
    code:      { amp: .26, tilt: .04, fill: .84 },
    chat:      { amp: .34, tilt: .05, fill: .8 },
};

function hasWebGL() {
    try { const c = document.createElement('canvas'); return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl'))); }
    catch (e) { return false; }
}

// ---------- colours, straight into the shader as sRGB ----------
const hex = (h) => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
const C = {
    red: hex('#E94335'), amber: hex('#FABB05'), green: hex('#34A851'), blue: hex('#4285F4'),
    white: hex('#EEF0FB'), mist: hex('#8890C4'), orange: hex('#F26322'),
};
const mixC = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// ---------- small maths ----------
function rng(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
const TAU = Math.PI * 2;
const gauss = (r) => (r() + r() + r() - 1.5) / 1.5;
function sphere(r) { const z = r() * 2 - 1, t = r() * TAU, s = Math.sqrt(1 - z * z); return [s * Math.cos(t), s * Math.sin(t), z]; }
// a point on the outline of a w × h rectangle centred on 0, t in 0..1
function perimeter(t, w, h) {
    let e = t * 2 * (w + h);
    if (e < w) return [e - w / 2, h / 2];
    e -= w; if (e < h) return [w / 2, h / 2 - e];
    e -= h; if (e < w) return [w / 2 - e, -h / 2];
    e -= w; return [-w / 2, -h / 2 + e];
}
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
function rrect(g, x, y, w, h, r) { g.beginPath(); g.roundRect(x, y, w, h, r); }

// ---------- a cloud: CORE points that draw the shape, then dust ----------
class Cloud {
    constructor(seed) {
        this.pos = new Float32Array(COUNT * 3);
        this.col = new Float32Array(COUNT * 3);
        this.n = 0;
        this.r = rng(seed);
    }
    get full() { return this.n >= CORE; }
    add(x, y, z, c, b = 1) {
        if (this.n >= CORE) return;
        const k = this.n++ * 3;
        this.pos[k] = x; this.pos[k + 1] = y; this.pos[k + 2] = z;
        this.col[k] = c[0] * b; this.col[k + 1] = c[1] * b; this.col[k + 2] = c[2] * b;
    }
    // top up any shortfall, centre it, order the points top to bottom so every morph sweeps down the shape,
    // then scatter the dust and note how big the shape is for framing
    finish() {
        const r = this.r, p = this.pos, c = this.col;
        const have = Math.max(1, this.n);
        while (this.n < CORE) {
            const j = Math.floor(r() * have) * 3;
            this.add(p[j] + gauss(r) * .01, p[j + 1] + gauss(r) * .01, p[j + 2] + gauss(r) * .01, [c[j], c[j + 1], c[j + 2]]);
        }
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
        for (let i = 0; i < CORE; i++) {
            const x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2];
            if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z;
        }
        const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, cz = (z0 + z1) / 2;
        let rad = 0, hy = 0;
        for (let i = 0; i < CORE; i++) {
            const x = (p[i * 3] -= cx), y = (p[i * 3 + 1] -= cy), z = (p[i * 3 + 2] -= cz);
            rad = Math.max(rad, Math.hypot(x, z));
            hy = Math.max(hy, Math.abs(y));
        }
        this.rad = rad; this.hy = hy; this.hx = (x1 - x0) / 2;
        const order = Array.from({ length: CORE }, (_, i) => i);
        const key = new Float32Array(CORE);
        for (let i = 0; i < CORE; i++) key[i] = -p[i * 3 + 1] + (r() - .5) * .45;
        order.sort((a, b) => key[a] - key[b]);
        const P = new Float32Array(COUNT * 3), Q = new Float32Array(COUNT * 3);
        order.forEach((from, to) => {
            P[to * 3] = p[from * 3]; P[to * 3 + 1] = p[from * 3 + 1]; P[to * 3 + 2] = p[from * 3 + 2];
            Q[to * 3] = c[from * 3]; Q[to * 3 + 1] = c[from * 3 + 1]; Q[to * 3 + 2] = c[from * 3 + 2];
        });
        for (let i = CORE; i < COUNT; i++) {
            const [x, y, z] = sphere(r), d = 3.4 + Math.pow(r(), .7) * 4.2, b = .18 + r() * .32;
            P[i * 3] = x * d * 1.5; P[i * 3 + 1] = y * d; P[i * 3 + 2] = z * d - 1.2;
            Q[i * 3] = C.mist[0] * b; Q[i * 3 + 1] = C.mist[1] * b; Q[i * 3 + 2] = C.mist[2] * b;
        }
        this.pos = P; this.col = Q;
        return this;
    }
}

// ---------- canvas drawings sampled into points; black is left empty ----------
function layer(w, h, draw) {
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const g = cv.getContext('2d', { willReadFrequently: true });
    draw(g, w, h);
    const d = g.getImageData(0, 0, w, h).data;
    const pts = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const k = (y * w + x) * 4;
        if (d[k + 3] < 128 || d[k] + d[k + 1] + d[k + 2] < 60) continue;
        pts.push(x, y, d[k] / 255, d[k + 1] / 255, d[k + 2] / 255);
    }
    return { pts, w, h, n: pts.length / 5 };
}
// height: world height of the whole canvas; depth: thickness of the slab
function fromLayer(cl, L, height, depth, count = Infinity, bright = 1) {
    if (!L.n) return;
    const s = height / L.h, P = L.pts;
    for (let i = 0; i < count && !cl.full; i++) {
        const k = Math.floor(cl.r() * L.n) * 5;
        cl.add((P[k] + cl.r() - L.w / 2) * s, -(P[k + 1] + cl.r() - L.h / 2) * s, (cl.r() - .5) * depth, [P[k + 2], P[k + 3], P[k + 4]], bright);
    }
}

// ---------- the shapes ----------
const assets = {};
const SHAPES = {
    // before anything: dust, which gathers into the first shape when the page opens
    void(cl) {
        while (!cl.full) { const [x, y, z] = sphere(cl.r), d = 2.6 + Math.pow(cl.r(), .6) * 5; cl.add(x * d * 1.4, y * d, z * d, C.mist, .3); }
    },

    // Intro: the logo, in its own colours
    logo(cl) {
        const L = layer(260, 360, (g, w, h) => g.drawImage(assets.logo, 0, 0, w, h));
        fromLayer(cl, L, 3.4, .5);
    },

    // Work: a curved wall of browser windows
    windows(cl) {
        const R = 3.6, w = 1.02, h = .66, gx = .16, gy = .2, spanX = 4 * w + 3 * gx;
        const acc = [C.red, C.amber, C.green, C.blue];
        const at = (col, row, u, v) => {
            const th = (-spanX / 2 + col * (w + gx) + w / 2 + u) / R;
            return [R * Math.sin(th), (1 - row) * (h + gy) + v, R * Math.cos(th) - R];
        };
        while (!cl.full) {
            const k = Math.floor(cl.r() * 12), col = k % 4, row = Math.floor(k / 4), a = acc[(col + row * 2) % 4];
            const p = cl.r();
            let u, v, c, b;
            if (p < .3) { [u, v] = perimeter(cl.r(), w, h); c = C.white; b = .85; }
            else if (p < .38) { u = (cl.r() - .5) * w; v = h / 2 - .075; c = C.mist; b = .9; }
            else if (p < .43) { const d = Math.floor(cl.r() * 3); u = -w / 2 + .07 + d * .055 + gauss(cl.r) * .008; v = h / 2 - .038 + gauss(cl.r) * .008; c = [C.red, C.amber, C.green][d]; b = 1.3; }
            else if (p < .74) { u = -w / 2 + .06 + cl.r() * w * .46; v = h / 2 - .14 - cl.r() * h * .5; c = a; b = .72; }
            else { const line = Math.floor(cl.r() * 5); u = w * .04 + cl.r() * w * (line ? .3 : .38); v = h / 2 - .16 - line * .075; c = line ? C.mist : C.white; b = line ? .55 : .95; }
            const [x, y, z] = at(col, row, u, v);
            cl.add(x, y, z + (cl.r() - .5) * .03, c, b);
        }
    },

    // Services: four services, four worlds
    orbs(cl) {
        const at = [[-.86, .78, 0], [.86, .78, .25], [-.86, -.78, .25], [.86, -.78, 0]];
        const cols = [C.green, C.blue, C.red, C.amber];
        while (!cl.full) {
            const p = cl.r();
            if (p < .06) {
                const i = Math.floor(cl.r() * 4), j = (i + 1 + Math.floor(cl.r() * 3)) % 4, t = cl.r(), A = at[i], B = at[j];
                cl.add(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t, C.mist, .5);
                continue;
            }
            const k = Math.floor(cl.r() * 4), [cx, cy, cz] = at[k];
            if (p < .72) {
                const [x, y, z] = sphere(cl.r), rr = .5 * (.97 + cl.r() * .05);
                cl.add(cx + x * rr, cy + y * rr, cz + z * rr, cols[k], .9);
            } else if (p < .92) {
                const a = cl.r() * TAU, tz = (k - 1.5) * .45, tx = .5;
                let x = Math.cos(a) * .76, y = 0, z = Math.sin(a) * .76;
                [x, y] = [x * Math.cos(tz) - y * Math.sin(tz), x * Math.sin(tz) + y * Math.cos(tz)];
                [y, z] = [y * Math.cos(tx) - z * Math.sin(tx), y * Math.sin(tx) + z * Math.cos(tx)];
                cl.add(cx + x, cy + y, cz + z, C.white, .6);
            } else {
                const [x, y, z] = sphere(cl.r), rr = .16 * Math.cbrt(cl.r());
                cl.add(cx + x * rr, cy + y * rr, cz + z * rr, C.white, 1.2);
            }
        }
    },

    // Website hosting: the rack, with its status lights
    rack(cl) {
        const W = 1.5, H = 3.1, D = 1.15, U = .17, gap = .035;
        const spec = [[1, 'sw'], [1, 'patch'], [2, 'srv'], [1, 'srv'], [1, 'kvm'], [1, 'srv'], [1, 'srv'], [4, 'media'], [1, 'blank'], [2, 'ups']];
        let top = H / 2 - .16;
        const units = spec.map(([u, kind]) => { const h = u * U, unit = { kind, top, h }; top -= h + gap; return unit; });
        const total = units.reduce((s, u) => s + u.h, 0);
        const pickUnit = () => { let t = cl.r() * total; for (const u of units) { if ((t -= u.h) <= 0) return u; } return units[0]; };
        while (!cl.full) {
            const p = cl.r();
            if (p < .15) {
                const e = Math.floor(cl.r() * 12), t = cl.r() - .5, sx = e & 1 ? 1 : -1, sy = e & 2 ? 1 : -1;
                if (e < 4) cl.add(sx * W / 2, sy * H / 2, t * D, C.mist, .8);
                else if (e < 8) cl.add(sx * W / 2, t * H, sy * D / 2, C.mist, .8);
                else cl.add(t * W, sx * H / 2, sy * D / 2, C.mist, .8);
            } else if (p < .22) {
                cl.add((cl.r() < .5 ? -1 : 1) * W / 2, (cl.r() - .5) * H, (cl.r() - .5) * D, C.mist, .22);
            } else if (p < .93) {
                const u = pickUnit(), light = u.kind === 'srv' || u.kind === 'media' || u.kind === 'blank';
                cl.add((cl.r() - .5) * (W - .18), u.top - cl.r() * u.h, D / 2 - .04, light ? C.white : C.mist, light ? .6 : .3);
            } else {
                const u = units[Math.floor(cl.r() * units.length)];
                const col = u.kind === 'media' ? C.amber : u.kind === 'sw' || u.kind === 'patch' || u.kind === 'ups' ? C.green : cl.r() < .5 ? C.green : C.blue;
                const x = u.kind === 'sw' || u.kind === 'patch' ? -.5 + Math.floor(cl.r() * 15) * .07 : -.6 + Math.floor(cl.r() * 2) * .06;
                cl.add(x + gauss(cl.r) * .006, u.top - u.h / 2 + gauss(cl.r) * .006, D / 2 - .01, col, 1.6);
            }
        }
    },

    // IT support: a laptop with a remote session on screen
    laptop(cl) {
        const W = 2.7, D = 1.75, y0 = -.62, Hs = 1.72, lean = .2;
        const scr = (u, v) => [u, y0 + v * Math.cos(lean), -D / 2 - v * Math.sin(lean)];
        const lens = [.55, .9, .5, .62, .58, .72, .45, .8, .3];
        while (!cl.full) {
            const p = cl.r();
            if (p < .13) { const [u, v] = perimeter(cl.r(), W, D); cl.add(u, y0, v, C.mist, .8); }
            else if (p < .42) {
                const row = Math.floor(cl.r() * 5), kw = .155, g = .03;
                const x = row === 4 ? (cl.r() - .5) * .9 : (Math.floor(cl.r() * 13) - 6) * (kw + g) + (cl.r() - .5) * kw;
                cl.add(x, y0 + .01, -D / 2 + .2 + row * (kw + g) + (cl.r() - .5) * kw, C.white, .42);
            } else if (p < .48) { const [u, v] = perimeter(cl.r(), .78, .5); cl.add(u, y0, D / 2 - .34 + v, C.mist, .7); }
            else if (p < .62) { const [u, v] = perimeter(cl.r(), W, Hs); const [x, y, z] = scr(u, Hs / 2 + v); cl.add(x, y, z, C.white, .85); }
            else {
                const line = Math.floor(cl.r() * lens.length);
                let u = -W / 2 + .2 + cl.r() * lens[line] * (W - .4), v = Hs - .3 - line * .14, c = C.white, b = .55;
                if (line === 0) { c = C.mist; b = .8; }
                if (line === 1 || line === 8) { c = C.green; b = 1; }
                if (line === 5) { u = -W / 2 + .2 + cl.r() * (W - .4) * .7; v += (cl.r() - .5) * .05; c = C.green; b = .9; }
                const [x, y, z] = scr(u, v);
                cl.add(x, y, z + .006, c, b);
            }
        }
    },

    // Data and automation: a loop that never stops, with packets riding it
    knot(cl) {
        const P = 2, Q = 3, s = .66, tube = .2;
        const f = (u) => { const r = Math.cos(Q * u) + 2.1; return [r * Math.cos(P * u) * s, r * Math.sin(P * u) * s, -Math.sin(Q * u) * s * 1.3]; };
        const grad = [C.green, C.blue, C.amber, C.red];
        while (!cl.full) {
            const packet = cl.r() < .07;
            let u = cl.r() * TAU;
            if (packet) u = (Math.floor(u / TAU * 14) + .5) / 14 * TAU + gauss(cl.r) * .02;
            const a = f(u), T = norm(sub(f(u + 1e-3), a)), N = norm(cross(T, [0, 0, 1])), B = cross(T, N);
            const th = cl.r() * TAU, rr = packet ? tube * .35 * Math.sqrt(cl.r()) : tube * (.92 + cl.r() * .1);
            const g = u / TAU * 4, c = mixC(grad[Math.floor(g) % 4], grad[(Math.floor(g) + 1) % 4], g % 1);
            cl.add(a[0] + (N[0] * Math.cos(th) + B[0] * Math.sin(th)) * rr, a[1] + (N[1] * Math.cos(th) + B[1] * Math.sin(th)) * rr,
                a[2] + (N[2] * Math.cos(th) + B[2] * Math.sin(th)) * rr, packet ? C.white : c, packet ? 1.4 : .72);
        }
    },

    // How I work: three rings that only hold together as a set
    rings(cl) {
        const a = 1.45, b = .92;
        const ring = [(t) => [a * Math.cos(t), b * Math.sin(t), 0], (t) => [0, a * Math.cos(t), b * Math.sin(t)], (t) => [b * Math.sin(t), 0, a * Math.cos(t)]];
        const cols = [C.red, C.green, C.blue];
        while (!cl.full) {
            const k = Math.floor(cl.r() * 3), [x, y, z] = ring[k](cl.r() * TAU), [dx, dy, dz] = sphere(cl.r), rr = .075 * Math.cbrt(cl.r());
            cl.add(x + dx * rr, y + dy * rr, z + dz * rr, cols[k], .85);
        }
    },

    // Tools: a gear
    gear(cl) {
        const teeth = 12, Ro = 1.5, Rr = 1.22, Rh = .36, T = .42, holes = 6, Rc = .82, rh = .19;
        const prof = (th) => {
            let f = (th / TAU * teeth) % 1; if (f < 0) f += 1;
            if (f < .12) return Rr + (Ro - Rr) * f / .12;
            if (f < .42) return Ro;
            if (f < .54) return Ro - (Ro - Rr) * (f - .42) / .12;
            return Rr;
        };
        const solid = (x, y) => {
            const r = Math.hypot(x, y);
            if (r > prof(Math.atan2(y, x)) || r < Rh) return false;
            for (let k = 0; k < holes; k++) { const a = k / holes * TAU; if (Math.hypot(x - Rc * Math.cos(a), y - Rc * Math.sin(a)) < rh) return false; }
            return true;
        };
        const edge = mixC(C.blue, C.white, .45);
        while (!cl.full) {
            const p = cl.r();
            if (p < .58) { const x = (cl.r() - .5) * 2 * Ro, y = (cl.r() - .5) * 2 * Ro; if (solid(x, y)) cl.add(x, y, (cl.r() < .5 ? -1 : 1) * T / 2, C.blue, .62); }
            else if (p < .88) { const th = cl.r() * TAU, r = prof(th); cl.add(r * Math.cos(th), r * Math.sin(th), (cl.r() - .5) * T, edge, .95); }
            else if (p < .94) { const th = cl.r() * TAU; cl.add(Rh * Math.cos(th), Rh * Math.sin(th), (cl.r() - .5) * T, C.white, .9); }
            else { const a = Math.floor(cl.r() * holes) / holes * TAU, th = cl.r() * TAU; cl.add(Rc * Math.cos(a) + rh * Math.cos(th), Rc * Math.sin(a) + rh * Math.sin(th), (cl.r() - .5) * T, C.white, .75); }
        }
    },

    // The quiz app: a phone with four coloured answers
    phone(cl) {
        const W = 220, H = 440;
        const outline = layer(W, H, (g) => {
            rrect(g, 8, 8, W - 16, H - 16, 34); g.lineWidth = 9; g.strokeStyle = '#EEF0FB'; g.stroke();
            g.fillStyle = '#EEF0FB'; rrect(g, 86, 24, 48, 9, 5); g.fill();
            g.fillStyle = '#C3C8E8'; rrect(g, 30, 60, W - 60, 52, 10); g.fill();
            g.fillStyle = '#8890C4'; rrect(g, 30, 398, W - 60, 9, 5); g.fill();
        });
        const tiles = layer(W, H, (g) => {
            ['#E94335', '#4285F4', '#FABB05', '#34A851'].forEach((c, i) => {
                const x = 30 + (i % 2) * 84, y = 142 + Math.floor(i / 2) * 120, cx = x + 38, cy = y + 54;
                g.fillStyle = c; rrect(g, x, y, 76, 108, 12); g.fill();
                g.fillStyle = '#000'; g.beginPath();
                if (i === 0) { g.moveTo(cx, cy - 18); g.lineTo(cx + 18, cy + 14); g.lineTo(cx - 18, cy + 14); }
                else if (i === 1) { g.moveTo(cx, cy - 19); g.lineTo(cx + 15, cy); g.lineTo(cx, cy + 19); g.lineTo(cx - 15, cy); }
                else if (i === 2) g.arc(cx, cy, 16, 0, TAU);
                else g.rect(cx - 14, cy - 14, 28, 28);
                g.fill();
            });
        });
        fromLayer(cl, outline, 3.3, .2, CORE * .42, .9);
        fromLayer(cl, tiles, 3.3, .2, Infinity, .8);
    },

    // The road code quiz: a curve-ahead sign
    sign(cl) {
        const W = 300, H = 440;
        const face = layer(W, H, (g) => {
            g.save(); g.translate(150, 150); g.rotate(Math.PI / 4);
            g.fillStyle = '#FABB05'; rrect(g, -100, -100, 200, 200, 18); g.fill();
            g.strokeStyle = '#000'; g.lineWidth = 7; rrect(g, -88, -88, 176, 176, 12); g.stroke();
            g.restore();
            g.strokeStyle = '#000'; g.lineWidth = 17; g.beginPath(); g.moveTo(114, 238); g.bezierCurveTo(112, 168, 190, 186, 188, 116); g.stroke();
            g.fillStyle = '#000'; g.beginPath(); g.moveTo(188, 74); g.lineTo(214, 118); g.lineTo(162, 118); g.closePath(); g.fill();
        });
        const post = layer(W, H, (g) => { g.fillStyle = '#8890C4'; g.fillRect(141, 292, 18, 148); });
        fromLayer(cl, face, 3.4, .22, CORE * .9, .95);
        fromLayer(cl, post, 3.4, .1, Infinity, .7);
    },

    // The ATEM controller: a multiview, with program in red
    multiview(cl) {
        const W = 400, H = 300;
        const pics = layer(W, H, (g) => {
            const r = rng(7);
            const screens = [[10, 10, 186, 105], [204, 10, 186, 105], [10, 123, 186, 105], [204, 123, 186, 105], [10, 238, 88, 50], [106, 238, 88, 50], [202, 238, 88, 50], [298, 238, 88, 50]];
            const hues = [['#2f5fd0', '#7a3fb0'], ['#b06a1c', '#4a2a7a'], ['#1d7a5a', '#203a8a'], ['#8a2f5a', '#2a4a9a']];
            screens.forEach(([x, y, w, h], i) => {
                const [a, b] = hues[i % 4], grd = g.createLinearGradient(x, y, x, y + h);
                grd.addColorStop(0, a); grd.addColorStop(1, b);
                g.fillStyle = grd; g.fillRect(x + 4, y + 4, w - 8, h - 8);
                g.fillStyle = 'rgba(238,240,251,.85)';
                g.beginPath(); g.arc(x + w * (.3 + r() * .4), y + h * .42, h * .16, 0, TAU); g.fill();
                g.fillRect(x + w * .2, y + h * .66, w * .6, h * .1);
            });
        });
        const frames = layer(W, H, (g) => {
            g.strokeStyle = '#EEF0FB'; g.lineWidth = 3;
            [[204, 10, 186, 105], [10, 123, 186, 105], [204, 123, 186, 105], [10, 238, 88, 50], [106, 238, 88, 50], [202, 238, 88, 50], [298, 238, 88, 50]].forEach(([x, y, w, h]) => g.strokeRect(x, y, w, h));
            g.strokeStyle = '#E94335'; g.lineWidth = 8; g.strokeRect(10, 10, 186, 105);
        });
        fromLayer(cl, frames, 2.9, .12, CORE * .45, 1);
        fromLayer(cl, pics, 2.9, .12, Infinity, .6);
    },

    // Dashboards: a 3D bar chart, with a trend line riding above it
    dash(cl) {
        const NX = 6, NZ = 3, s = .34, step = .54, hr = rng(5);
        const H = Array.from({ length: NZ }, (_, k) => Array.from({ length: NX }, (_, i) => .35 + (.5 + .5 * Math.sin(i * .9 + k * 1.3)) * 1.3 + hr() * .35));
        const cols = [C.blue, C.green, C.amber];
        const x0 = -(NX - 1) / 2 * step, z0 = -(NZ - 1) / 2 * step, base = -.9;
        const line = (u) => base + 2.05 + Math.sin(u * 4.2) * .16 + u * .3;
        while (!cl.full) {
            const p = cl.r();
            if (p < .1) {
                const along = cl.r() < .5, x = (cl.r() - .5) * 4, z = (cl.r() - .5) * 2.4;
                cl.add(along ? Math.round(x / .27) * .27 : x, base, along ? z : Math.round(z / .27) * .27, C.mist, .3);
            } else if (p < .84) {
                const i = Math.floor(cl.r() * NX), k = Math.floor(cl.r() * NZ), h = H[k][i];
                const cx = x0 + i * step, cz = z0 + k * step, edge = cl.r() < .5;
                const face = Math.floor(cl.r() * 5);
                let u = (cl.r() - .5) * s, v = cl.r() * h, w = (cl.r() - .5) * s;
                if (face === 4) { v = h; if (edge) { if (cl.r() < .5) u = Math.sign(u) * s / 2; else w = Math.sign(w) * s / 2; } }
                else {
                    const side = face < 2 ? 'x' : 'z', sign = face % 2 ? 1 : -1;
                    if (side === 'x') u = sign * s / 2; else w = sign * s / 2;
                    if (edge) { if (side === 'x') w = Math.sign(w) * s / 2; else u = Math.sign(u) * s / 2; }
                }
                cl.add(cx + u, base + v, cz + w, cols[k], edge ? 1.05 : .4);
            } else {
                const u = cl.r(), y = line(u);
                const dot = cl.r() < .25;
                const uu = dot ? Math.round(u * 8) / 8 : u;
                cl.add(-2.2 + uu * 4.4 + gauss(cl.r) * (dot ? .02 : .006), (dot ? line(uu) : y) + gauss(cl.r) * (dot ? .02 : .006), -.62 + gauss(cl.r) * .01, dot ? C.white : C.red, dot ? 1.4 : 1);
            }
        }
    },

    // Device Ping Heartbeats: a monitor's heartbeat, line after line
    ecg(cl) {
        const L = 4.8, beat = 1.6;
        const g = (x, m, s, a) => a * Math.exp(-((x - m) ** 2) / (2 * s * s));
        const wave = (x) => { const ph = ((x / beat) % 1 + 1) % 1; return g(ph, .2, .035, .14) - g(ph, .37, .012, .14) + g(ph, .41, .014, 1.05) - g(ph, .45, .016, .32) + g(ph, .66, .05, .24); };
        const front = mixC(C.green, C.white, .35);
        while (!cl.full) {
            if (cl.r() < .12) {
                const along = cl.r() < .5, x = (cl.r() - .5) * L, z = (cl.r() - .5) * 1.9;
                cl.add(along ? Math.round(x / .4) * .4 : x, -1, along ? z : Math.round(z / .32) * .32, C.mist, .28);
                continue;
            }
            const line = Math.floor(cl.r() * 7), z = -.9 + line * .3, shift = line * .11;
            let x = (cl.r() - .5) * L;
            if (cl.r() < .4) { x = (Math.floor(cl.r() * 4) - 2 + .36 + cl.r() * .11) * beat - shift; if (Math.abs(x) > L / 2) continue; }
            cl.add(x, wave(x + shift) * 1.25 - .35, z, line === 3 ? front : C.green, .35 + (1 - Math.abs(z) / 1.1) * .65);
        }
    },

    // Magento modules: a cube of cubes, one being slotted in
    cubes(cl) {
        const s = .44, step = .76;
        while (!cl.full) {
            const ix = Math.floor(cl.r() * 3), iy = Math.floor(cl.r() * 3), iz = Math.floor(cl.r() * 3);
            let cx = (ix - 1) * step, cy = (iy - 1) * step, cz = (iz - 1) * step;
            const odd = ix === 2 && iy === 2 && iz === 2;
            if (odd) { cx += .38; cy += .26; cz += .38; }
            const face = Math.floor(cl.r() * 6), edge = cl.r() < .58;
            let u = (cl.r() - .5) * s, v = (cl.r() - .5) * s;
            if (edge) { if (cl.r() < .5) u = Math.sign(u) * s / 2; else v = Math.sign(v) * s / 2; }
            const w = (face & 1 ? 1 : -1) * s / 2;
            const [x, y, z] = face < 2 ? [w, u, v] : face < 4 ? [u, w, v] : [u, v, w];
            const c = odd ? C.white : mixC(C.orange, C.amber, iy / 2);
            cl.add(cx + x, cy + y, cz + z, c, edge ? 1.05 : .32);
        }
    },

    // Jellyfin: a TV with a play button in Jellyfin's colours
    play(cl) {
        const W = 420, H = 300;
        const frame = layer(W, H, (g) => {
            g.strokeStyle = '#EEF0FB'; g.lineWidth = 10; rrect(g, 10, 10, 400, 236, 18); g.stroke();
            g.fillStyle = '#8890C4'; g.fillRect(196, 252, 28, 24); rrect(g, 130, 276, 160, 12, 6); g.fill();
        });
        const tri = layer(W, H, (g) => {
            const grd = g.createLinearGradient(170, 70, 280, 190);
            grd.addColorStop(0, '#AA5CC3'); grd.addColorStop(1, '#00A4DC');
            g.fillStyle = grd; g.lineJoin = 'round'; g.lineWidth = 16; g.strokeStyle = grd;
            g.beginPath(); g.moveTo(184, 80); g.lineTo(184, 176); g.lineTo(266, 128); g.closePath(); g.fill(); g.stroke();
        });
        const glow = layer(W, H, (g) => { g.fillStyle = '#2B2474'; rrect(g, 22, 22, 376, 212, 10); g.fill(); });
        fromLayer(cl, frame, 2.6, .24, CORE * .34, .95);
        fromLayer(cl, tri, 2.6, .24, CORE * .4, 1.15);
        fromLayer(cl, glow, 2.6, .06, Infinity, .9);
    },

    // Smart TV setup: the Quick Connect code on the TV
    code(cl) {
        const W = 480, H = 280;
        const frame = layer(W, H, (g) => {
            g.strokeStyle = '#FABB05'; g.lineWidth = 8; rrect(g, 8, 8, W - 16, 230, 16); g.stroke();
            g.fillStyle = '#8890C4'; g.fillRect(226, 240, 28, 20); rrect(g, 160, 260, 160, 10, 5); g.fill();
        });
        const label = layer(W, H, (g) => { g.fillStyle = '#AAB1DA'; g.font = '600 26px "Instrument Sans", sans-serif'; g.textAlign = 'center'; g.fillText('Quick Connect', W / 2, 62); });
        const digits = layer(W, H, (g) => { g.fillStyle = '#EEF0FB'; g.font = '700 84px Unbounded, "Arial Black", sans-serif'; g.textAlign = 'center'; g.fillText('482 913', W / 2, 166); });
        fromLayer(cl, frame, 2.6, .16, CORE * .3, .9);
        fromLayer(cl, label, 2.6, .08, CORE * .1, .9);
        fromLayer(cl, digits, 2.6, .2, Infinity, 1.05);
    },

    // Contact: a message, being typed
    chat(cl) {
        const W = 400, H = 320;
        const bubble = layer(W, H, (g) => {
            g.fillStyle = '#34A851'; rrect(g, 20, 20, 360, 220, 46); g.fill();
            g.beginPath(); g.moveTo(80, 230); g.lineTo(52, 300); g.lineTo(150, 236); g.closePath(); g.fill();
            g.fillStyle = '#000'; [130, 200, 270].forEach((x) => { g.beginPath(); g.arc(x, 130, 22, 0, TAU); g.fill(); });
        });
        const rim = layer(W, H, (g) => { g.strokeStyle = '#D9F2DF'; g.lineWidth = 5; rrect(g, 20, 20, 360, 220, 46); g.stroke(); });
        fromLayer(cl, rim, 2.7, .3, CORE * .2, .7);
        fromLayer(cl, bubble, 2.7, .3, Infinity, .85);
    },
};

const clouds = {};
function cloud(name) {
    if (!clouds[name]) {
        const cl = new Cloud(name.length * 977 + name.charCodeAt(0) * 31);
        SHAPES[name](cl);
        clouds[name] = cl.finish();
    }
    return clouds[name];
}

// ---------- the shader ----------
const vertexShader = /* glsl */ `
uniform float uMix, uTime, uBurst, uSize, uScaleP, uRepel, uPulse, uWobble, uDist;
uniform vec3 uRayO, uRayD, uRayDLag, uPulseO;
attribute vec3 aFrom, aTo, aColFrom, aColTo, aDir;
attribute vec4 aRand;
varying vec3 vColor;
varying float vAlpha;

float hash(vec3 p, float s) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719)) + s * 17.13) * 43758.5453); }

void main() {
    // each point sets off a little after the one above it, so a morph sweeps down the shape
    float t = clamp((uMix - aRand.x * .42) / .58, 0., 1.);
    t = t * t * (3. - 2. * t);
    vec3 p = mix(aFrom, aTo, t);
    float mid = sin(t * 3.14159265);
    p += aDir * mid * uBurst * (.35 + aRand.y);
    float ang = mid * uBurst * (aRand.z - .5) * 2.4;
    p.xz = vec2(cos(ang) * p.x - sin(ang) * p.z, sin(ang) * p.x + cos(ang) * p.z);
    float ph = aRand.z * 6.2831853;
    p += uWobble * .022 * vec3(sin(uTime * .8 + ph + p.y * 1.7), sin(uTime * .9 + ph * 1.3 + p.x * 1.9), cos(uTime * .7 + ph + p.z * 1.5));

    vec4 world = modelMatrix * vec4(p, 1.);
    // the pointer: points near it drift aside, each in its own time and by its own amount. About one in five
    // can't make up its mind: it drifts out to the edge, bounces back in, and drifts out again, unsure whether
    // to follow where the pointer is or where it just was
    float h1 = hash(aRand.yzw, 1.), h2 = hash(aRand.yzw, 2.), h3 = hash(aRand.yzw, 3.), h4 = hash(aRand.yzw, 4.), h5 = hash(aRand.yzw, 5.);
    float lost = step(h2, .2);
    float bounce = mix(.5, 1. - abs(sin(uTime * (.45 + h3 * .7) + ph * 2.)), uWobble);
    float follow = mix(h4, .5 + .5 * sin(uTime * (.3 + h1 * .4) + ph), lost);
    vec3 rd = normalize(mix(uRayD, uRayDLag, follow));
    vec3 v = world.xyz - uRayO;
    vec3 off = v - rd * dot(v, rd);
    float dist = length(off);
    float reach = .6 + h1 * .35;
    float fall = exp(-dist * dist / (reach * reach));
    float join = smoothstep(h5 * .55, h5 * .55 + .45, uRepel);
    float strength = mix((.5 + .5 * h3) * (1. + uWobble * .12 * sin(uTime * .7 + ph * 3.)), .15 + bounce, lost);
    float push = join * fall * strength;
    vec3 side = off / max(dist, 1e-4);
    world.xyz += side * push * .6;
    world.xyz += cross(rd, side) * join * fall * lost * uWobble * .12 * sin(uTime * .8 + ph * 5.);
    // a click: a shell of light expanding from where it landed
    float pd = distance(world.xyz, uPulseO);
    float shell = exp(-pow((pd - uPulse * 5.5) * 3., 2.)) * (1. - uPulse);
    world.xyz += (world.xyz - uPulseO) / max(pd, 1e-4) * shell * .22;

    vec4 mv = viewMatrix * world;
    gl_Position = projectionMatrix * mv;
    float depth = -mv.z;
    float sparkle = step(.986, aRand.w);
    float size = uSize * (.55 + aRand.y * .8 + sparkle * 1.5) * (1. + push * 1.4 + shell * 1.2);
    gl_PointSize = clamp(size * uScaleP / depth, 1., 48.);
    float tw = .8 + .2 * sin(uTime * (1.4 + aRand.w * 2.2) + ph * 3.);
    vColor = mix(aColFrom, aColTo, t) * (uWobble > .5 ? tw : .9) + vec3(push * .35 + shell * .45);
    vAlpha = clamp(1.25 - (depth - uDist) * .16, .3, 1.);
}`;
const fragmentShader = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
void main() {
    vec2 c = gl_PointCoord - .5;
    float d = dot(c, c) * 4.;
    float a = (exp(-d * 3.2) - .04) * vAlpha;
    if (a <= 0.) discard;
    gl_FragColor = vec4(vColor, a);
}`;

// ---------- start ----------
async function start() {
    const img = new Image();
    img.src = 'logo.svg';
    await img.decode();
    assets.logo = img;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, powerPreference: 'high-performance' });
    renderer.setClearColor(0x000000, 0);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(FOV, 1, .1, 60);
    const turn = new THREE.Group();     // yaw and tilt
    const roll = new THREE.Group();     // the gear turns about its own axle
    scene.add(turn);
    turn.add(roll);

    const geo = new THREE.BufferGeometry();
    const attr = (n) => new THREE.BufferAttribute(new Float32Array(COUNT * n), n);
    geo.setAttribute('position', attr(3));
    for (const k of ['aFrom', 'aTo', 'aColFrom', 'aColTo']) { const a = attr(3); a.setUsage(THREE.DynamicDrawUsage); geo.setAttribute(k, a); }
    const dir = attr(3), rnd = attr(4), r = rng(42);
    for (let i = 0; i < COUNT; i++) {
        const [x, y, z] = sphere(r);
        dir.array.set([x, y * .7, z], i * 3);
        // delay follows the point's place top to bottom (the clouds are sorted that way), with some spread
        const delay = i < CORE ? (i / CORE) * .78 + r() * .22 : r();
        rnd.array.set([delay, r(), r(), r()], i * 4);
    }
    geo.setAttribute('aDir', dir);
    geo.setAttribute('aRand', rnd);

    const uniforms = {
        uMix: { value: 0 }, uTime: { value: 0 }, uBurst: { value: reduced ? 0 : (phoneMQ.matches ? .55 : .85) },
        uSize: { value: phoneMQ.matches ? .03 : .021 }, uScaleP: { value: 500 }, uRepel: { value: 0 }, uPulse: { value: 1 },
        uWobble: { value: reduced ? 0 : 1 }, uDist: { value: 8 },
        uRayO: { value: new THREE.Vector3(0, 0, 100) }, uRayD: { value: new THREE.Vector3(0, 0, -1) }, uRayDLag: { value: new THREE.Vector3(0, 0, -1) }, uPulseO: { value: new THREE.Vector3() },
    };
    const material = new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending });
    const points = new THREE.Points(geo, material);
    points.frustumCulled = false;
    roll.add(points);

    // ---------- the pair of shapes being blended ----------
    const scenes = window.Site ? window.Site.scenes : [];
    const shapeAt = (i) => SHAPE_OF[scenes[Math.max(0, Math.min(scenes.length - 1, i))]?.dataset.stage] || 'logo';
    let pairA = '', pairB = '';
    function setPair(a, b) {
        const A = cloud(a), B = cloud(b);
        geo.attributes.aFrom.array.set(A.pos); geo.attributes.aColFrom.array.set(A.col);
        geo.attributes.aTo.array.set(B.pos); geo.attributes.aColTo.array.set(B.col);
        for (const k of ['aFrom', 'aTo', 'aColFrom', 'aColTo']) geo.attributes[k].needsUpdate = true;
        pairA = a; pairB = b;
    }

    // ---------- layout: where the shape sits and how big ----------
    let W = 1, H = 1, mobile = phoneMQ.matches, headH = 66, win = 0;
    let copyRight = [];
    const fitDist = (shape, frame) => {
        const cl = cloud(shape), pose = POSE[shape], t = Math.tan(FOV * Math.PI / 360);
        const reach = Math.max(cl.rad, cl.hx);
        const V = Math.max(2 * cl.hy * H / (frame.fh * pose.fill), 2 * reach * H / (frame.fw * pose.fill));
        return V / (2 * t);
    };
    // the free part of the screen beside section i's text
    const frameFor = (i) => {
        if (mobile) return { cx: W / 2, cy: headH + win / 2, fw: W - 36, fh: Math.max(120, win - 28) };
        const right = Math.min(W * .6, copyRight[i] || W * .45);
        const cx = Math.max(W * .62, Math.min(W * .76, (right + W) / 2 + 10));
        return { cx, cy: headH + (H - headH) / 2, fw: Math.min(W - right - 60, 2 * (W - cx) - 40), fh: H - headH - 110 };
    };
    function measure() {
        mobile = phoneMQ.matches;
        headH = header ? header.offsetHeight : 66;
        win = mobile ? (parseFloat(getComputedStyle(scenes[1] || document.body).paddingTop) || innerHeight * .46) : 0;
        copyRight = scenes.map((s) => { const c = s.querySelector('.copy'); return c ? c.getBoundingClientRect().right : 0; });
        measureSheets();
    }
    function layout() {
        W = canvas.clientWidth || innerWidth; H = canvas.clientHeight || innerHeight;
        renderer.setPixelRatio(Math.min(devicePixelRatio || 1, mobile ? 1.5 : 1.75));
        renderer.setSize(W, H, false);
        camera.aspect = W / H;
        uniforms.uScaleP.value = renderer.getPixelRatio() * H / (2 * Math.tan(FOV * Math.PI / 360));
        // the shapes' quarter lines hold until the frame changes size, which a phone's address bar doesn't do
        const sig = `${W} ${H} ${headH} ${win}`;
        if (sig !== quarterFor) { quarter = {}; quarterFor = sig; }
        wake();
    }

    // ---------- on a phone, stop drawing while a section's sheet covers the window ----------
    let sheets = [], covered = false;
    function measureSheets() {
        const y = scrollY;
        sheets = scenes.map((s) => { const r = s.querySelector('.copy')?.getBoundingClientRect(); return r ? [r.top + y, r.bottom + y] : [0, 0]; });
    }
    function checkCovered(y, i) {
        let c = false;
        if (mobile) {
            const bandBottom = Math.min(stageEl.getBoundingClientRect().bottom, innerHeight);
            for (let k = Math.max(0, i - 1); k <= Math.min(scenes.length - 1, i + 1); k++) {
                if (sheets[k] && sheets[k][0] <= y + headH && sheets[k][1] >= y + bandBottom) c = true;
            }
        }
        if (c !== covered) {
            covered = c;
            stageEl.style.visibility = c ? 'hidden' : '';
            if (!c) wake();
        }
    }

    // ---------- on a phone, a shape shows only through the window above each section's sheet, so the morph into
    // the next shape waits until three quarters of the current one is out from under the sheet above, then plays
    // out as you scroll, finishing as the window lines up under the header ----------
    // where the sheet's edge leaves that much of a shape's points below it, px down the screen, with a little to
    // spare: taken as the shape turns, at its highest, so it holds whichever way the shape is facing
    let quarter = {}, quarterFor = '';
    function shapeQuarter(shape) {
        const f = frameFor(0), pose = POSE[shape];
        if (!clouds[shape]) return f.cy - f.fh * pose.fill / 4;     // near enough until the shape is built
        if (quarter[shape] == null) {
            const cl = clouds[shape], D = fitDist(shape, f), px = H / (2 * D * Math.tan(FOV * Math.PI / 360));
            const ct = Math.cos(pose.tilt), st = Math.sin(pose.tilt), step = 7, n = Math.floor(CORE / step), ys = new Float32Array(n);
            let q = Infinity;
            for (let a = 0; a < 16; a++) {
                const ca = Math.cos(a * TAU / 16), sa = Math.sin(a * TAU / 16);
                for (let j = 0; j < n; j++) {
                    const k = j * step * 3, y = cl.pos[k + 1];
                    const z = cl.pos[k + 2] * ca - cl.pos[k] * sa;         // turned about its upright, then tipped toward you
                    ys[j] = f.cy - (y * ct - z * st) * px * D / (D - (y * st + z * ct));
                }
                ys.sort();
                q = Math.min(q, ys[Math.floor(n * .22)]);
            }
            quarter[shape] = q;
        }
        return quarter[shape];
    }
    function phoneStage(y) {
        const tops = window.Site.tops;
        let s = 0;
        for (let k = 1; k < scenes.length; k++) {
            const top = tops[k] - y;                     // the top of section k's window: the sheet above ends here
            if (top <= headH) { s = k; continue; }       // that window is open: its morph is done
            const start = shapeQuarter(shapeAt(k - 1));  // three quarters of the shape is below it
            if (!(top <= start)) break;
            s = k - 1 + Math.min(1, (start - top) / Math.max(1, start - headH));
        }
        return s;
    }

    // ---------- scroll ----------
    let sTarget = 0, sCur = -1;
    window.addEventListener('site:frame', (e) => {
        const d = e.detail;
        sTarget = mobile ? phoneStage(d.y) : d.i + d.t;
        if (progressEl) progressEl.style.transform = `scaleX(${d.progress.toFixed(4)})`;
        checkCovered(d.y, d.i);
        wake();
    });
    window.addEventListener('site:measure', () => { measure(); layout(); });

    // ---------- pointer: part the cloud, drag to turn it, click to pulse ----------
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    let px = -1, py = -1, repelTarget = 0, lastActive = performance.now();
    let sx = -1, sy = -1, lx = -1, ly = -1;     // where the cloud feels the pointer: close behind it, and further back
    let dragging = false, dragMoved = false, downX = 0, downY = 0, lastX = 0, yawVel = 0, pitchDrag = 0, pulseStart = -1;
    const parallax = { x: 0, y: 0 };
    const free = (el) => !el.closest('.copy, a, button, input, textarea, select, label, iframe, .site-head, .modal, [data-design-switcher]');
    const hideHint = () => { if (hint && !hint.classList.contains('gone')) hint.classList.add('gone'); };

    let tapAt = 0, tapX = 0, tapY = 0;
    window.addEventListener('pointermove', (e) => {
        px = e.clientX; py = e.clientY;
        repelTarget = 1;
        parallax.x = (px / innerWidth) * 2 - 1;
        parallax.y = (py / innerHeight) * 2 - 1;
        if (dragging) {
            const dx = e.clientX - lastX;
            if (Math.abs(e.clientX - downX) + Math.abs(e.clientY - downY) > 5) dragMoved = true;
            if (dragMoved) { yawVel = dx * .0065 * 60; yaw += dx * .0065; pitchDrag = Math.max(-.5, Math.min(.5, pitchDrag + e.movementY * .004)); }
            lastX = e.clientX;
        }
        wake();
    }, { passive: true });
    document.addEventListener('mouseout', (e) => { if (!e.relatedTarget) { repelTarget = 0; wake(); } });
    window.addEventListener('blur', () => { repelTarget = 0; });
    window.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || !free(e.target)) return;
        px = e.clientX; py = e.clientY;
        if (e.pointerType === 'mouse') {
            dragging = true; dragMoved = false; downX = lastX = e.clientX; downY = e.clientY; yawVel = 0;
            document.documentElement.classList.add('dragging');
            e.preventDefault();
        } else {
            // a touch pulses only if it lifts again without scrolling
            tapAt = performance.now(); tapX = e.clientX; tapY = e.clientY;
        }
        wake();
    });
    window.addEventListener('pointerup', (e) => {
        if (!dragging) {
            if (e.pointerType !== 'mouse') {
                if (tapAt && performance.now() - tapAt < 450 && Math.hypot(e.clientX - tapX, e.clientY - tapY) < 10) pulseAt(e.clientX, e.clientY);
                tapAt = 0;
                repelTarget = 0;
                wake();
            }
            return;
        }
        dragging = false;
        document.documentElement.classList.remove('dragging');
        if (!dragMoved) pulseAt(e.clientX, e.clientY); else hideHint();
        wake();
    });
    window.addEventListener('pointercancel', () => { tapAt = 0; repelTarget = 0; dragging = false; document.documentElement.classList.remove('dragging'); });
    const plane = new THREE.Plane(), hit = new THREE.Vector3(), camDir = new THREE.Vector3();
    function pulseAt(x, y) {
        const rc = canvas.getBoundingClientRect();
        ndc.set(((x - rc.left) / rc.width) * 2 - 1, -((y - rc.top) / rc.height) * 2 + 1);
        raycaster.setFromCamera(ndc, camera);
        camera.getWorldDirection(camDir);
        plane.setFromNormalAndCoplanarPoint(camDir, turn.position);
        if (raycaster.ray.intersectPlane(plane, hit)) {
            uniforms.uPulseO.value.copy(hit);
            pulseStart = time;
            hideHint();
        }
    }

    // ---------- the loop: runs while anything moves, then holds still ----------
    let raf = 0, last = 0, time = 0, yaw = 0, rollAngle = 0, intro = reduced ? 1 : 0;
    let dist = 8, frameCx = W / 2, frameCy = H / 2, tilt = 0, visible = true;
    function wake() {
        lastActive = performance.now();
        if (!raf && visible && !document.hidden && !covered) { last = performance.now(); raf = requestAnimationFrame(tick); }
    }
    function tick(now) {
        raf = 0;
        const dt = Math.min(.05, (now - last) / 1000);
        last = now;
        time += dt;

        // where the page is: section i, and m of the way to the next one
        if (sCur < 0) sCur = sTarget;
        sCur += (sTarget - sCur) * (1 - Math.exp(-dt * 6));
        if (Math.abs(sTarget - sCur) < 1e-4) sCur = sTarget;
        let i = Math.min(Math.floor(sCur), scenes.length - 1), m = Math.min(1, sCur - i);
        let a = shapeAt(i), b = shapeAt(i + 1);
        if (intro < 1) {
            // the opening: dust gathers into the shape of whichever section the page opened on
            intro = Math.min(1, intro + dt / 2.6);
            i = Math.round(sCur); m = 0; a = b = shapeAt(i);
            if (pairA !== 'void' || pairB !== a) setPair('void', a);
            uniforms.uMix.value = intro;
        } else {
            if (a !== pairA || b !== pairB) setPair(a, b);
            // the points always travel from one shape to the next as you scroll, so the move is yours and stops when you
            // do; with reduced motion they go straight there, without the burst, the swirl or the idle drift
            uniforms.uMix.value = m;
        }
        const mm = m * m * (3 - 2 * m);
        uniforms.uTime.value = time;

        // pose: spin, or sway about facing you
        const pa = POSE[a], pb = POSE[b], lead = mm < .5 ? pa : pb;
        if (!dragging) {
            yaw += yawVel * dt;
            yawVel *= Math.exp(-dt * 2.6);
            if (Math.abs(yawVel) < .02) {
                if (lead.spin && !reduced) yaw += lead.spin * dt;
                else {
                    const goal = Math.round(yaw / TAU) * TAU + (reduced ? 0 : (lead.amp || 0) * Math.sin(time * .32));
                    yaw += (goal - yaw) * (1 - Math.exp(-dt * 1.4));
                }
            }
            pitchDrag *= Math.exp(-dt * 1.8);
        }
        const tiltGoal = pa.tilt + (pb.tilt - pa.tilt) * mm + pitchDrag + parallax.y * .06;
        tilt += (tiltGoal - tilt) * (1 - Math.exp(-dt * 4));
        turn.rotation.set(tilt, yaw + parallax.x * .08, 0, 'XYZ');
        // only the gear turns on its axle; every other shape settles back upright
        if (lead.roll && !reduced) rollAngle += lead.roll * dt;
        else rollAngle += (Math.round(rollAngle / TAU) * TAU - rollAngle) * (1 - Math.exp(-dt * 2.5));
        roll.rotation.z = rollAngle;

        // frame and distance, blended between the two sections
        const fa = frameFor(i), fb = frameFor(Math.min(i + 1, scenes.length - 1));
        const goalD = fitDist(a, fa) * (1 - mm) + fitDist(b, fb) * mm;
        dist = goalD;
        frameCx = fa.cx + (fb.cx - fa.cx) * mm;
        frameCy = fa.cy + (fb.cy - fa.cy) * mm;
        camera.position.set(0, 0, dist);
        camera.lookAt(0, 0, 0);
        camera.setViewOffset(W, H, W / 2 - frameCx, H / 2 - frameCy, W, H);
        camera.updateProjectionMatrix();
        uniforms.uDist.value = dist;

        // the pointer rays, recomputed as the camera moves; the cloud parts slowly and trails the pointer
        if (px >= 0) {
            if (sx < 0 || uniforms.uRepel.value < .02) { sx = lx = px; sy = ly = py; }
            const kf = 1 - Math.exp(-dt * 4), ks = 1 - Math.exp(-dt * 1.5);
            sx += (px - sx) * kf; sy += (py - sy) * kf;
            lx += (px - lx) * ks; ly += (py - ly) * ks;
            const rc = canvas.getBoundingClientRect();
            ndc.set(((lx - rc.left) / rc.width) * 2 - 1, -((ly - rc.top) / rc.height) * 2 + 1);
            raycaster.setFromCamera(ndc, camera);
            uniforms.uRayDLag.value.copy(raycaster.ray.direction);
            ndc.set(((sx - rc.left) / rc.width) * 2 - 1, -((sy - rc.top) / rc.height) * 2 + 1);
            raycaster.setFromCamera(ndc, camera);
            uniforms.uRayO.value.copy(raycaster.ray.origin);
            uniforms.uRayD.value.copy(raycaster.ray.direction);
        }
        uniforms.uRepel.value += (repelTarget - uniforms.uRepel.value) * (1 - Math.exp(-dt * (repelTarget > uniforms.uRepel.value ? 1.6 : 1.2)));
        uniforms.uPulse.value = pulseStart < 0 ? 1 : Math.min(1, (time - pulseStart) / 1.5);

        renderer.render(scene, camera);

        const settling = intro < 1 || Math.abs(sTarget - sCur) > 1e-4 || Math.abs(repelTarget - uniforms.uRepel.value) > .01 || Math.abs(lx - px) + Math.abs(ly - py) > .5 || uniforms.uPulse.value < 1 || dragging || Math.abs(yawVel) > .02;
        if (settling || (!reduced && now - lastActive < HOLD_MS)) raf = requestAnimationFrame(tick);
    }
    document.addEventListener('visibilitychange', () => { if (document.hidden) { cancelAnimationFrame(raf); raf = 0; } else wake(); });
    window.addEventListener('resize', () => { measure(); layout(); });
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); document.documentElement.classList.add('no-stage'); visible = false; });

    measure();
    layout();
    setPair(shapeAt(0), shapeAt(1));
    if (window.Site) window.Site.update();
    wake();

    // build the shapes this page uses while the browser is idle, nearest section first (the next one before the
    // previous one), so a morph never stops to build its shape and no time goes on shapes the page never shows
    const here = Math.max(0, window.Site ? window.Site.index : 0);
    const near = scenes.map((_, k) => k).sort((x, y) => Math.abs(x - here) - Math.abs(y - here) || y - x);
    const queue = [...new Set(near.map(shapeAt))].filter((k) => k !== 'code' && !clouds[k]);
    const idle = window.requestIdleCallback || ((f) => setTimeout(() => f({ timeRemaining: () => 8 }), 60));
    const work = (dl) => {
        while (queue.length && dl.timeRemaining() > 4) {
            const k = queue.shift();
            cloud(k);
            if (mobile) shapeQuarter(k);
        }
        if (queue.length) idle(work);
    };
    idle(work);
    // the Quick Connect code needs its typeface first
    (document.fonts ? document.fonts.load('700 84px Unbounded') : Promise.resolve()).catch(() => {}).then(() => idle(() => cloud('code')));
}

if (!canvas || !hasWebGL()) {
    document.documentElement.classList.add('no-stage');
} else {
    start().catch((err) => {
        console.error(err);
        document.documentElement.classList.add('no-stage');
    });
}
