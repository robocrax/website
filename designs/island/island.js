// island.js — the Island design's stage: a low-poly island in the gulf where every service has a building.
// Scrolling flies the camera to the building the page is talking about, and a small robot guide flies with it.
// Hover a building to see what it is, click it to read about it, drag to look around.
// Every still part of the island is merged into one mesh; the loop sleeps a few seconds after things stop moving.
import * as THREE from '../../vendor/three.module.min.js';

const canvas = document.getElementById('stage-canvas');
const stageEl = document.getElementById('stage');
const pinEl = document.getElementById('pin');
const tipEl = document.getElementById('tip');
const header = document.querySelector('.site-head');
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const phoneMQ = matchMedia('(max-width: 1023.98px)');
const HOLD_MS = 8000;

const PAL = {
    grass: 0x89C46E, grass2: 0x7CB963, grass3: 0x95CD78, sand: 0xEFD9A3, wetSand: 0xD9C18B, rock: 0xA88B6B, rock2: 0x93775A,
    volc: 0x6F8C5F, volc2: 0x617E55, basalt: 0x7A7064, crater: 0x5E554B,
    road: 0x59626A, dash: 0xF4F2EA, paving: 0xE3DCCB, gravel: 0xD5CCB6, stone: 0xD9D4C8,
    wall: 0xF5F2EA, wall2: 0xE8E2D4, grey: 0xD7DDDF, grey2: 0xC9D1D4, steel: 0x98A5AB, dark: 0x2C3940, glass: 0x4F6D7B,
    wood: 0xA27D58, woodLight: 0xC9A777, marble: 0xFBF8F1, gold: 0xE2B33C, saffron: 0xF58A1F, roofGrey: 0x6E8290,
    red: 0xE94335, amber: 0xF5B800, green: 0x34A851, blue: 0x4285F4, orange: 0xF26322, sky: 0x59A9D9,
    leaf: 0x4F9A55, leaf2: 0x3E894B, leaf3: 0x66B262, leafLight: 0x8CC56A, trunk: 0x8A6A4D, flower: 0xD93A2E, white: 0xFFFFFF, cardboard: 0xC9A06C,
};
const G = 1.2;                                   // the island's flat top
const RX = 33, RZ = 27;                          // the island's size
const VOLC = { x: 15, z: -16, r: 10, h: 7.5 };   // a cone in the back, for Rangitoto
const RING = { x: 0, z: .6, rx: 9.6, rz: 7.4 };  // the ring road

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
const smooth = (t) => t * t * (3 - 2 * t);
const clamp01 = (x) => Math.min(1, Math.max(0, x));

// ---------- the ground ----------
const coast = (a) => 1 + .06 * Math.sin(3 * a + 1.2) + .045 * Math.sin(5 * a + .4) + .025 * Math.sin(9 * a + 2.2);
const islandD = (x, z) => Math.hypot(x / RX, z / RZ) / coast(Math.atan2(z, x));
function ground(x, z) {
    const d = islandD(x, z);
    let y;
    if (d < .82) y = G;
    else if (d < .9) y = G - (G - .42) * smooth((d - .82) / .08);
    else if (d < 1) y = .42 * (1 - (d - .9) / .1);
    else y = -Math.min(3, (d - 1) * 14);
    const vr = Math.hypot(x - VOLC.x, z - VOLC.z);
    if (vr < VOLC.r) {
        y += VOLC.h * Math.pow(1 - vr / VOLC.r, 1.3);
        if (vr < 2.2) y -= 1.4 * smooth(1 - vr / 2.2);
    }
    return y;
}

// ---------- primitives, each with its base on y = 0 ----------
function gableGeo() {
    const v = [
        -.5, 0, .5, .5, 0, .5, .5, 1, 0, -.5, 0, .5, .5, 1, 0, -.5, 1, 0,
        .5, 0, -.5, -.5, 0, -.5, -.5, 1, 0, .5, 0, -.5, -.5, 1, 0, .5, 1, 0,
        .5, 0, .5, .5, 0, -.5, .5, 1, 0, -.5, 0, -.5, -.5, 0, .5, -.5, 1, 0,
        -.5, 0, -.5, .5, 0, -.5, .5, 0, .5, -.5, 0, -.5, .5, 0, .5, -.5, 0, .5,
    ];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    return g;
}
function wedgeGeo() {   // a sawtooth roof tooth: upright face at z = -.5, slope down to z = .5
    const A = (x) => [x, 0, -.5], B = (x) => [x, 0, .5], C = (x) => [x, 1, -.5];
    const v = [...A(-.5), ...C(-.5), ...C(.5), ...A(-.5), ...C(.5), ...A(.5),
        ...B(-.5), ...B(.5), ...C(.5), ...B(-.5), ...C(.5), ...C(-.5),
        ...A(-.5), ...A(.5), ...B(.5), ...A(-.5), ...B(.5), ...B(-.5),
        ...A(.5), ...C(.5), ...B(.5), ...A(-.5), ...B(-.5), ...C(-.5)];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    return g;
}
const PRIM = {
    box: new THREE.BoxGeometry(1, 1, 1).translate(0, .5, 0).toNonIndexed(),
    cyl3: new THREE.CylinderGeometry(.5, .5, 1, 3).translate(0, .5, 0).toNonIndexed(),
    cyl6: new THREE.CylinderGeometry(.5, .5, 1, 6).translate(0, .5, 0).toNonIndexed(),
    cyl10: new THREE.CylinderGeometry(.5, .5, 1, 10).translate(0, .5, 0).toNonIndexed(),
    cyl16: new THREE.CylinderGeometry(.5, .5, 1, 16).translate(0, .5, 0).toNonIndexed(),
    cone5: new THREE.ConeGeometry(.5, 1, 5).translate(0, .5, 0).toNonIndexed(),
    cone7: new THREE.ConeGeometry(.5, 1, 7).translate(0, .5, 0).toNonIndexed(),
    cone10: new THREE.ConeGeometry(.5, 1, 10).translate(0, .5, 0).toNonIndexed(),
    ico: new THREE.IcosahedronGeometry(.5, 0),
    ico1: new THREE.IcosahedronGeometry(.5, 1),
    gable: gableGeo(),
    wedge: wedgeGeo(),
    halfCyl: new THREE.CylinderGeometry(1, 1, 1, 12, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).toNonIndexed(),
};

// a kit: parts in flat colours, merged into one mesh
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();
class Kit {
    constructor() { this.p = []; this.c = []; }
    add(geo, color, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, ry = 0, rx = 0, rz = 0) {
        _m.compose(_v.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz, 'YXZ')), _s.set(sx, sy, sz));
        return this.addM(geo, color, _m);
    }
    addM(geo, color, m) {
        const pos = geo.attributes.position, v = new THREE.Vector3();
        _c.set(color);
        for (let i = 0; i < pos.count; i++) {
            v.fromBufferAttribute(pos, i).applyMatrix4(m);
            this.p.push(v.x, v.y, v.z);
            this.c.push(_c.r, _c.g, _c.b);
        }
        return this;
    }
    box(w, h, d, color, x, y, z, ry = 0, rx = 0, rz = 0) { return this.add(PRIM.box, color, x, y, z, w, h, d, ry, rx, rz); }
    cyl(w, h, d, color, x, y, z, seg = 10, ry = 0, rx = 0, rz = 0) { return this.add(PRIM['cyl' + seg], color, x, y, z, w, h, d, ry, rx, rz); }
    cone(w, h, d, color, x, y, z, seg = 7, ry = 0, rx = 0, rz = 0) { return this.add(PRIM['cone' + seg], color, x, y, z, w, h, d, ry, rx, rz); }
    ball(r, color, x, y, z, sx = 1, sy = 1, sz = 1, smooth1 = false) { return this.add(smooth1 ? PRIM.ico1 : PRIM.ico, color, x, y, z, r * 2 * sx, r * 2 * sy, r * 2 * sz); }
    gable(w, h, d, color, x, y, z, ry = 0) { return this.add(PRIM.gable, color, x, y, z, w, h, d, ry); }
    // another kit, moved and turned
    merge(kit, x, y, z, ry = 0, s = 1) {
        _m.compose(_v.set(x, y, z), _q.setFromEuler(_e.set(0, ry, 0)), _s.set(s, s, s));
        const v = new THREE.Vector3();
        for (let i = 0; i < kit.p.length; i += 3) {
            v.set(kit.p[i], kit.p[i + 1], kit.p[i + 2]).applyMatrix4(_m);
            this.p.push(v.x, v.y, v.z);
            this.c.push(kit.c[i], kit.c[i + 1], kit.c[i + 2]);
        }
        return this;
    }
    geometry() {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
        g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
        g.computeVertexNormals();
        return g;
    }
    mesh(mat) { return new THREE.Mesh(this.geometry(), mat); }
}

// ---------- pictures drawn on canvases ----------
function canvasTex(w, h, draw) {
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const g = cv.getContext('2d');
    draw(g, w, h);
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    t.userData = { cv, g };
    return t;
}
const rr = (g, x, y, w, h, r) => { g.beginPath(); g.roundRect(x, y, w, h, r); };
const FONT = '"Overpass", "Arial Narrow", sans-serif';
const MONO = '"Overpass Mono", ui-monospace, monospace';

function drawDriveIn(g, w, h, mode) {
    g.clearRect(0, 0, w, h);
    const bg = g.createLinearGradient(0, 0, w, h);
    bg.addColorStop(0, '#1c0a45'); bg.addColorStop(1, '#2b1a6b');
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.textAlign = 'center';
    if (mode === 'code') {
        g.fillStyle = 'rgba(255,255,255,.75)'; g.font = `600 30px ${FONT}`; g.fillText('app.robocrax.com', w / 2, 74);
        g.fillStyle = '#fff'; g.font = `800 50px ${FONT}`; g.fillText('Quick Connect', w / 2, 142);
        g.fillStyle = 'rgba(255,255,255,.1)'; rr(g, w / 2 - 190, 170, 380, 116, 16); g.fill();
        g.fillStyle = '#fff'; g.font = `600 84px ${MONO}`; g.fillText('482 913', w / 2, 260);
        g.fillStyle = 'rgba(255,255,255,.72)'; g.font = `500 26px ${FONT}`; g.fillText('Enter this code on your phone or PC', w / 2, 334);
    } else {
        const tri = g.createLinearGradient(w / 2 - 60, h / 2 - 70, w / 2 + 80, h / 2 + 70);
        tri.addColorStop(0, '#AA5CC3'); tri.addColorStop(1, '#00A4DC');
        g.fillStyle = tri; g.strokeStyle = tri; g.lineWidth = 26; g.lineJoin = 'round';
        g.beginPath(); g.moveTo(w / 2 - 52, h / 2 - 78); g.lineTo(w / 2 - 52, h / 2 + 78); g.lineTo(w / 2 + 82, h / 2); g.closePath(); g.fill(); g.stroke();
    }
}

// ---------- the island ----------
function buildTerrain(mat, mobile) {
    const W = 84, D = 72, SX = mobile ? 70 : 92, SZ = mobile ? 60 : 80;
    const geo = new THREE.PlaneGeometry(W, D, SX, SZ);
    geo.rotateX(-Math.PI / 2);
    const p = geo.attributes.position, r = rng(11);
    for (let i = 0; i < p.count; i++) {
        let x = p.getX(i), z = p.getZ(i);
        if (Math.abs(x) < W / 2 - .1 && Math.abs(z) < D / 2 - .1) { x += (r() - .5) * .55; z += (r() - .5) * .55; }
        p.setXYZ(i, x, ground(x, z), z);
    }
    const g = geo.toNonIndexed();
    const pos = g.attributes.position.array, col = new Float32Array(pos.length);
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), cc = new THREE.Color();
    for (let t = 0; t < pos.length; t += 9) {
        a.fromArray(pos, t); b.fromArray(pos, t + 3); c.fromArray(pos, t + 6);
        n.subVectors(b, a).cross(c.clone().sub(a)).normalize();
        const cx = (a.x + b.x + c.x) / 3, cy = (a.y + b.y + c.y) / 3, cz = (a.z + b.z + c.z) / 3;
        const steep = 1 - Math.abs(n.y);
        const vr = Math.hypot(cx - VOLC.x, cz - VOLC.z);
        let hex;
        if (cy < .08) hex = PAL.wetSand;
        else if (cy < .55 && vr > VOLC.r * .8) hex = PAL.sand;
        else if (vr < VOLC.r * .97 && cy > G + .2) hex = cy > G + VOLC.h * .62 ? (vr < 2.4 ? PAL.crater : PAL.basalt) : (r() < .5 ? PAL.volc : PAL.volc2);
        else if (steep > .45) hex = r() < .5 ? PAL.rock : PAL.rock2;
        else hex = [PAL.grass, PAL.grass2, PAL.grass3][Math.floor(r() * 3)];
        cc.set(hex).multiplyScalar(.96 + r() * .08);
        for (let k = 0; k < 3; k++) col.set([cc.r, cc.g, cc.b], t + k * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat);
    m.receiveShadow = true;
    return m;
}

// everything that never moves goes into K; the things that do are returned
function buildWorld(K, mats, tex) {
    const out = { spots: [] };
    const r = rng(7);
    const spot = (id, name, note, x0, y0, z0, x1, y1, z1) => out.spots.push({ id, name, note, box: new THREE.Box3(new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x1, y1, z1)) });

    // ---------- the ring road, and the roads off it ----------
    const N = 72;
    const ringAt = (a, k = 1) => [RING.x + Math.cos(a) * RING.rx * k, RING.z + Math.sin(a) * RING.rz * k];
    for (let i = 0; i < N; i++) {
        const a0 = i / N * Math.PI * 2, a1 = (i + 1) / N * Math.PI * 2;
        const [x0, z0] = ringAt(a0), [x1, z1] = ringAt(a1);
        const len = Math.hypot(x1 - x0, z1 - z0) + .06, ry = -Math.atan2(z1 - z0, x1 - x0);
        K.box(len, .06, 1.6, PAL.road, (x0 + x1) / 2, G, (z0 + z1) / 2, ry);
        if (i % 2 === 0) K.box(len * .5, .075, .1, PAL.dash, (x0 + x1) / 2, G, (z0 + z1) / 2, ry);
    }
    const road = (x0, z0, x1, z1, w = 1.6, dashes = true) => {
        const len = Math.hypot(x1 - x0, z1 - z0), ry = -Math.atan2(z1 - z0, x1 - x0);
        K.box(len, .06, w, PAL.road, (x0 + x1) / 2, G, (z0 + z1) / 2, ry);
        if (dashes) for (let s = .6; s < len - .6; s += 1.4) {
            const t = s / len;
            K.box(.6, .075, .1, PAL.dash, x0 + (x1 - x0) * t, G, z0 + (z1 - z0) * t, ry);
        }
    };
    road(-22.4, 9.8, -4.2, 9.8, 2.6);          // the high street
    road(-4.6, 9.4, -6.6, 6.1, 1.6, false);    // high street to the ring
    road(2, 7.9, 2, 12.3, 1.6);                // ring to the drive-in
    road(-1, -6.7, -1, -8.6, 1.6, false);      // ring to the factory
    road(9.9, .6, 11.6, 2.9, 1.4, false);      // ring to the server shed
    road(-9.5, -.4, -12, -1.1, 1.4, false);    // ring to the workshop

    // ---------- RoboCrax HQ ----------
    K.cyl(10.5, .05, 7.6, PAL.paving, 0, G, .7, 16);
    K.box(5.4, 3, 3.8, PAL.wall, 0, G, -.6);
    K.box(5.8, .28, 4.2, PAL.dark, 0, G + 3, -.6);
    K.box(3, 1.8, 2.6, PAL.wall2, -3.9, G, .2);
    K.box(3.3, .22, 2.9, PAL.dark, -3.9, G + 1.8, .2);
    for (const x of [-2, -.7, .7, 2]) K.box(.92, 1.05, .06, PAL.glass, x, G + 1.65, 1.31);
    for (const x of [-4.6, -3.2]) K.box(.8, .8, .06, PAL.glass, x, G + .7, 1.51);
    K.box(1.2, 1.35, .07, PAL.dark, 0, G, 1.31);
    K.box(1.9, .12, .9, PAL.blue, 0, G + 1.45, 1.72);
    K.box(.12, 1.5, .12, PAL.steel, -.85, G + 3.28, -1.1);
    K.box(.12, 1.5, .12, PAL.steel, .85, G + 3.28, -1.1);
    for (const x of [-2.4, 2.4]) { K.box(.8, .5, .8, PAL.wood, x, G, 2.3); K.ball(.45, PAL.leaf3, x, G + .85, 2.3); }
    spot('how', 'RoboCrax HQ', 'How I work', -5.6, G, -2.6, 3, G + 6.5, 2.6);

    // ---------- the server shed: website hosting ----------
    {
        const sx = 13, sz = 1, w = 5, d = 3.6, h = 2.4, t = .16;
        K.box(w + .4, .1, d + .4, PAL.paving, sx, G, sz);
        K.box(w, h, t, PAL.grey, sx, G, sz + d / 2 - t / 2);
        K.box(w, h, t, PAL.grey, sx, G, sz - d / 2 + t / 2);
        K.box(t, h, d, PAL.grey, sx - w / 2 + t / 2, G, sz);
        K.box(t, h, d, PAL.grey, sx + w / 2 - t / 2, G, sz);
        for (let i = 0; i < 12; i++) K.box(.07, h - .1, .05, PAL.steel, sx - w / 2 + .25 + i * .41, G, sz + d / 2 + .02);
        K.box(1, 1.9, .06, PAL.glass, sx - 1.5, G, sz + d / 2 + .04);
        K.box(.9, .32, .05, PAL.blue, sx - 1.5, G + 2.0, sz + d / 2 + .05);
        for (const i of [-1.45, 0, 1.45]) K.box(1, 1.95, 1.05, PAL.dark, sx + i, G + .1, sz - .55);
        K.cyl(.16, 1.7, .16, PAL.steel, sx + 3.2, G, sz - 1.2, 6);
        K.cone(1.3, .45, 1.3, PAL.white, sx + 3.2, G + 1.7, sz - 1.2, 10, 0, -.7);
        spot('wordpress', 'Server shed', 'Website hosting', sx - w / 2 - .3, G, sz - d / 2 - .3, sx + w / 2 + 1.2, G + 3.4, sz + d / 2 + .4);
        // status lights on the racks, blinking
        const leds = [];
        for (const i of [-1.45, 0, 1.45]) for (let row = 0; row < 8; row++) for (let k = 0; k < 3; k++) {
            leds.push([sx + i - .32 + k * .12, G + .32 + row * .21, sz - .55 + .53, row % 3 === 0 ? 'b' : 'g']);
        }
        out.leds = leds;
        // the roof lifts off to show the racks
        const roof = new Kit();
        roof.box(w + .4, .26, d + .4, PAL.dark, 0, 0, 0);
        for (const x of [-1.2, 1.1]) { roof.box(1, .55, .8, PAL.grey2, x, .26, -.3); roof.cyl(.62, .06, .62, PAL.dark, x, .81, -.3, 10); }
        out.shedRoof = { kit: roof, x: sx, y: G + h, z: sz };
    }

    // ---------- the house: IT support ----------
    {
        const hx = 12, hz = 11, w = 4.4, d = 3.6, h = 2.1, t = .16;
        K.box(w, .12, d, PAL.woodLight, hx, G, hz);
        const fz = hz + d / 2 - t / 2;
        K.box(1.7, h, t, PAL.wall, hx - w / 2 + .85, G, fz);
        K.box(1.7, h, t, PAL.wall, hx + w / 2 - .85, G, fz);
        K.box(1, h - 1.6, t, PAL.wall, hx - w / 2 + 2.2, G + 1.6, fz);
        K.box(w, h, t, PAL.wall, hx, G, hz - d / 2 + t / 2);
        K.box(t, h, d, PAL.wall, hx - w / 2 + t / 2, G, hz);
        K.box(t, h, d, PAL.wall, hx + w / 2 - t / 2, G, hz);
        K.box(.95, .85, .05, PAL.glass, hx + 1.25, G + .8, fz + .1);
        K.box(.95, .85, .05, PAL.glass, hx - 1.3, G + .8, fz + .1);
        K.box(.9, 1.6, .05, PAL.blue, hx + .05, G, fz + .02);
        // inside: the desk, the laptop, a chair, the printer, a plant
        K.box(1.7, .06, .75, PAL.wood, hx + .6, G + .82, hz - .95);
        for (const [dx, dz] of [[-.78, -.32], [.78, -.32], [-.78, .32], [.78, .32]]) K.box(.06, .82, .06, PAL.wood, hx + .6 + dx, G, hz - .95 + dz);
        K.box(.56, .03, .38, PAL.dark, hx + .5, G + .88, hz - .9);
        K.box(.5, .42, .06, PAL.blue, hx + .5, G, hz - .05);
        K.box(.5, .5, .06, PAL.blue, hx + .5, G + .42, hz + .2);
        K.box(.62, .32, .46, PAL.white, hx - 1.2, G + .12, hz - 1.1);
        K.box(.4, .02, .3, PAL.white, hx - 1.2, G + .45, hz - .95);
        K.cyl(.34, .36, .34, PAL.orange, hx - 1.55, G + .12, hz + .9, 10);
        K.ball(.33, PAL.leaf3, hx - 1.55, G + .75, hz + .9);
        K.box(1.8, .02, 1.3, 0x5D8FC9, hx - .1, G + .12, hz + .2);
        out.laptop = { x: hx + .5, y: G + .89, z: hz - 1.08 };
        // a fence, a letterbox and a path
        for (let i = 0; i < 9; i++) K.box(.1, .55, .1, PAL.white, hx - 2.4 + i * .6, G, hz + 3.1);
        K.box(4.9, .07, .06, PAL.white, hx, G + .42, hz + 3.1);
        K.box(.6, .05, 1.2, PAL.paving, hx + .05, G, hz + 2.45);
        K.box(.08, .75, .08, PAL.dark, hx + 1.3, G, hz + 3.35);
        K.box(.32, .26, .4, PAL.red, hx + 1.3, G + .75, hz + 3.35);
        spot('it-support', 'The house', 'IT support', hx - w / 2 - .3, G, hz - d / 2 - .3, hx + w / 2 + .3, G + 4, hz + 3.4);
        const roof = new Kit();
        roof.gable(w + .5, 1.45, d + .6, PAL.red, 0, 0, 0);
        roof.box(.42, 1.1, .42, PAL.rock2, 1.1, .3, -.5);
        out.houseRoof = { kit: roof, x: hx, y: G + h, z: hz };
    }

    // ---------- the factory: data and automation ----------
    {
        const fx = -1, fz = -13;
        K.box(6.6, 2.8, 4.2, PAL.wall2, fx, G, fz);
        for (let k = 0; k < 3; k++) K.add(PRIM.wedge, PAL.roofGrey, fx, G + 2.8, fz - 1.4 + k * 1.4, 6.6, 1.05, 1.4);
        K.cyl(.95, 5.6, .95, PAL.rock2, fx + 2.5, G, fz - 1.3, 10);
        K.cyl(1, .35, 1, PAL.white, fx + 2.5, G + 4.6, fz - 1.3, 10);
        K.cyl(1, .35, 1, PAL.red, fx + 2.5, G + 5.0, fz - 1.3, 10);
        K.box(2, 2, .07, PAL.dark, fx - 1.7, G, fz + 2.12);
        for (const x of [.6, 1.6, 2.6]) K.box(.7, .7, .06, PAL.glass, fx + x, G + 1.5, fz + 2.12);
        K.cyl(.3, .3, 6.4, PAL.steel, fx, G + 2.4, fz + 2.3, 10, 0, Math.PI / 2);
        // the conveyor: boxes of data ride it out of the factory into the dock
        const y0 = G + .62;
        K.box(9.6, .14, 1, PAL.dark, fx + 1.3, y0, fz + 3.6);
        K.box(9.6, .08, .08, PAL.steel, fx + 1.3, y0 + .14, fz + 3.12);
        K.box(9.6, .08, .08, PAL.steel, fx + 1.3, y0 + .14, fz + 4.08);
        for (let i = 0; i < 7; i++) K.box(.12, .62, .8, PAL.steel, fx - 3.2 + i * 1.5, G, fz + 3.6);
        for (const [x, c] of [[-1.6, PAL.blue], [2.6, PAL.green]]) {
            K.box(.3, 1.6, 1.3, c, fx + x - .7, G, fz + 3.6);
            K.box(.3, 1.6, 1.3, c, fx + x + .7, G, fz + 3.6);
            K.box(1.7, .4, 1.3, c, fx + x, G + 1.6, fz + 3.6);
        }
        K.box(1.6, 1.6, 1.8, PAL.grey2, fx + 6.8, G, fz + 3.6);
        out.belt = { x0: fx - 3.4, x1: fx + 6, y: y0 + .14, z: fz + 3.6 };
        out.gear = { x: fx - 1.7, y: G + 2.45, z: fz + 2.2 };
        spot('automations', 'The factory', 'Data and automation', fx - 3.6, G, fz - 2.4, fx + 7.8, G + 6.8, fz + 4.4);
    }

    // ---------- the workshop: tools ----------
    {
        const wx = -14, wz = -3, w = 4.8, d = 3.8, h = 2.4, t = .16;
        K.box(w, .1, d, PAL.paving, wx, G, wz);
        K.box(w, h, t, PAL.grey, wx, G, wz - d / 2 + t / 2);
        K.box(t, h, d, PAL.grey, wx - w / 2 + t / 2, G, wz);
        K.box(t, h, d, PAL.grey, wx + w / 2 - t / 2, G, wz);
        K.box(w, .5, t, PAL.grey, wx, G + h - .5, wz + d / 2 - t / 2);
        K.box(w - .3, .25, .3, PAL.steel, wx, G + h - .55, wz + d / 2 - .2);
        K.gable(w + .5, 1.3, d + .5, PAL.amber, wx, G + h, wz);
        K.box(3.4, .08, .9, PAL.wood, wx, G + .9, wz - d / 2 + .6);
        for (const x of [-1.5, 1.5]) K.box(.1, .9, .7, PAL.wood, wx + x, G, wz - d / 2 + .6);
        K.box(3.4, 1.2, .05, PAL.woodLight, wx, G + 1.05, wz - d / 2 + .18);
        for (let i = 0; i < 7; i++) K.box(.08, .3 + (i % 3) * .12, .05, PAL.dark, wx - 1.4 + i * .45, G + 1.3, wz - d / 2 + .22);
        K.box(.7, .45, .4, PAL.red, wx + 1.2, G + .96, wz - d / 2 + .6);
        K.box(.5, .9, .5, PAL.blue, wx - 1.7, G, wz + .4);
        K.ball(.28, PAL.blue, wx - 1.7, G + 1.15, wz + .4);
        // the sign: a spanner
        K.box(1.7, .24, .12, PAL.dark, wx, G + h + .5, wz + d / 2 + .3, 0, 0, .5);
        K.cyl(.62, .12, .62, PAL.dark, wx + .82, G + h + .95, wz + d / 2 + .24, 10, 0, Math.PI / 2);
        spot('tools', 'The workshop', "Tools I've built", wx - w / 2 - .3, G, wz - d / 2 - .3, wx + w / 2 + .3, G + 4.2, wz + d / 2 + .5);
    }

    // ---------- the hall: the quiz app and the ATEM controller ----------
    {
        const mx = -13, mz = -13;
        K.box(7, .5, 5.6, PAL.stone, mx, G, mz);
        for (let i = 0; i < 3; i++) K.box(2.6 - i * .2, .17, .45, PAL.stone, mx, G + i * .17, mz + 3.2 - i * .4);
        K.box(5.6, 2.3, 4.2, PAL.marble, mx, G + .5, mz - .2);
        for (const x of [-1.8, -.6, .6, 1.8]) K.cyl(.32, 1.9, .32, PAL.marble, mx + x, G + .5, mz + 2.45, 10);
        K.box(4.6, .26, 1.3, PAL.marble, mx, G + 2.4, mz + 2.35);
        let y = G + 2.8;
        for (const [s, hh] of [[3.2, .5], [2.7, .5], [2.2, .5], [1.7, .45], [1.25, .4]]) { K.box(s, hh, s, PAL.marble, mx, y, mz - .4); y += hh; }
        K.cone(1.15, 1.3, 1.15, PAL.marble, mx, y, mz - .4, 10);
        K.ball(.22, PAL.gold, mx, y + 1.4, mz - .4);
        K.cyl(.06, 1.7, .06, PAL.steel, mx + .1, y + 1.2, mz - .4, 6);
        K.box(.75, .46, .03, PAL.saffron, mx + .5, y + 2.25, mz - .4, 0, 0, -.12);
        for (const x of [-2.3, 2.3]) {
            K.box(1.05, .5, 1.05, PAL.marble, mx + x, G + 2.8, mz - 1.4);
            K.ball(.56, PAL.marble, mx + x, G + 3.55, mz - 1.4, 1, 1, 1, true);
            K.cone(.22, .5, .22, PAL.gold, mx + x, G + 3.95, mz - 1.4, 7);
        }
        // the big screen beside the hall
        K.box(.2, 2.3, .2, PAL.dark, mx + 3.65, G, mz + 1.2);
        K.box(.2, 2.3, .2, PAL.dark, mx + 6.75, G, mz + 1.2);
        K.box(3.95, 2.4, .22, PAL.dark, mx + 5.2, G + 1.85, mz + 1.2);
        out.quizScreen = { x: mx + 5.2, y: G + 3.05, z: mz + 1.32, w: 3.6, h: 2.08 };
        // the AV desk and a camera, out the front
        const ax = mx + 1.1, az = mz + 5.6;
        K.box(1.9, .82, .8, PAL.wood, ax - 1.3, G, az);
        K.box(1.5, .08, .55, PAL.dark, ax - 1.3, G + .82, az);
        for (let i = 0; i < 6; i++) {
            K.box(.13, .05, .1, i === 1 ? PAL.red : 0x4A5960, ax - 1.92 + i * .22, G + .9, az - .12);
            K.box(.13, .05, .1, i === 3 ? PAL.green : 0x4A5960, ax - 1.92 + i * .22, G + .9, az + .08);
        }
        K.box(.08, .26, .08, PAL.white, ax - .7, G + .9, az + .05, 0, -.3);
        for (const a of [0, 2.1, 4.2]) K.box(.06, 1.25, .06, PAL.dark, ax + .9 + Math.sin(a) * .22, G, az + .8 + Math.cos(a) * .22, 0, Math.cos(a) * .2, -Math.sin(a) * .2);
        K.box(.5, .42, .85, PAL.dark, ax + .9, G + 1.22, az + .8, -.35);
        K.cyl(.32, .4, .32, 0x3A4A52, ax + .76, G + 1.43 - .16, az + .38, 10, -.35, Math.PI / 2);
        out.tally = { x: ax + .95, y: G + 1.72, z: az + .86 };
        out.onAir = { x: mx, y: G + 2.03, z: mz + 3.03 };
        spot('respond', 'The hall', 'Live quiz app and ATEM controller', mx - 3.6, G, mz - 3, mx + 7, G + 7.5, mz + 6.8);
    }

    // ---------- the radio mast: device ping heartbeats ----------
    {
        const ax = 7, az = -11, ay = ground(ax, az) - .1;
        for (let i = 0; i < 8; i++) {
            const r0 = .34 - i * .03, r1 = .31 - i * .03;
            K.addM(new THREE.CylinderGeometry(r1, r0, 1, 4).translate(0, .5, 0).toNonIndexed(), i % 2 ? PAL.white : PAL.red, _m.makeTranslation(ax, ay + i, az));
        }
        K.cone(.5, .3, .5, PAL.white, ax + .25, ay + 6.3, az, 10, 0, 0, -1.2);
        K.cone(.5, .3, .5, PAL.white, ax - .25, ay + 5.2, az, 10, 0, 0, 1.2);
        out.mastTop = { x: ax, y: ay + 8.15, z: az };
        out.devices = [[ax - 3.2, az + 2.2], [ax - 1.2, az + 3.4], [ax + 2.4, az + 2.6]].map(([x, z]) => {
            const y = ground(x, z);
            K.box(.9, .32, .6, PAL.dark, x, y, z);
            return { x: x + .28, y: y + .2, z: z + .31 };
        });
        spot('heartbeats', 'The radio mast', 'Device Ping Heartbeats', ax - 3.8, ay, az - 1.5, ax + 3.2, ay + 8.6, az + 4);
    }

    // ---------- the warehouse: Magento modules ----------
    {
        const ex = -21.5, ez = -8.5;
        K.box(5, 2.5, 3.4, PAL.grey2, ex, G, ez);
        K.add(PRIM.halfCyl, PAL.orange, ex, G + 2.5, ez, 5.3, .95, 1.85);
        for (const x of [-1.2, 1.2]) {
            K.box(1.6, 1.8, .06, PAL.grey, ex + x, G, ez + 1.72);
            for (let i = 0; i < 6; i++) K.box(1.6, .03, .07, PAL.steel, ex + x, G + .2 + i * .28, ez + 1.74);
        }
        // the modules: crates in the logo's colours, and one on its way in
        const cols = [PAL.red, PAL.amber, PAL.green, PAL.blue];
        for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) for (let k = 0; k < 2 - (i === 2 && j === 1 ? 1 : 0); k++) {
            K.box(.55, .55, .55, cols[(i + j * 2 + k) % 4], ex + 3.3 + i * .62, G + k * .58, ez + 1 + j * .62);
        }
        for (let i = 0; i < 3; i++) K.box(.7, .5, .7, PAL.cardboard, ex + 3, G + i * .52, ez - 1.1, i * .3);
        K.box(1.1, .55, .7, PAL.amber, ex + 1.2, G + .2, ez + 3.1);
        K.box(.5, .5, .55, PAL.dark, ex + 1.05, G + .75, ez + 3.1);
        K.box(.08, 1.5, .5, PAL.dark, ex + .58, G + .1, ez + 3.1);
        for (const z of [-.15, .15]) K.box(.7, .04, .08, PAL.steel, ex + .2, G + .5, ez + 3.1 + z);
        for (const [x, z] of [[.85, 2.85], [1.55, 2.85], [.85, 3.35], [1.55, 3.35]]) K.cyl(.32, .32, .16, PAL.dark, ex + x, G, ez + z, 10, 0, Math.PI / 2);
        K.box(.52, .52, .52, PAL.blue, ex + .2, G + .54, ez + 3.1);
        spot('magento', 'The warehouse', 'Magento 2 modules', ex - 4, G, ez - 2, ex + 5.4, G + 3.8, ez + 3.8);
    }

    // ---------- the drive-in: the streaming server ----------
    {
        const dx = 2, dz = 13.6;
        K.box(10.4, .05, 7.6, PAL.gravel, dx, G, dz + 4.2);
        K.box(.36, 5.6, .36, PAL.dark, dx - 3.7, G, dz);
        K.box(.36, 5.6, .36, PAL.dark, dx + 3.7, G, dz);
        K.box(7.7, 4.3, .3, PAL.dark, dx, G + 1.45, dz);
        for (const x of [-2.5, 0, 2.5]) K.box(.18, 1.45, .18, PAL.dark, dx + x, G, dz);
        out.screen = { x: dx, y: G + 3.6, z: dz + .16, w: 7.2, h: 3.9 };
        const cars = [PAL.red, PAL.amber, PAL.blue, PAL.green, PAL.white, PAL.sky];
        let n = 0;
        for (const z of [dz + 3.6, dz + 6.1]) for (const x of [dx - 3, dx, dx + 3]) {
            K.merge(carKit(cars[n++ % cars.length]), x, G, z, Math.PI / 2);
            K.box(.08, .9, .08, PAL.steel, x + 1.35, G, z - .4);
            K.box(.3, .22, .16, PAL.dark, x + 1.35, G + .9, z - .4);
        }
        // a snack bar, stripes on the awning
        K.box(2.2, 1.6, 1.5, PAL.white, dx + 6.6, G, dz + 6.6);
        for (let i = 0; i < 6; i++) K.box(.4, .1, .8, i % 2 ? PAL.white : PAL.red, dx + 5.7 + i * .38, G + 1.55, dz + 7.6, 0, .35);
        spot('jellyfin', 'The drive-in', 'Jellyfin streaming', dx - 4.2, G, dz - .6, dx + 8, G + 6, dz + 8);
    }

    // ---------- the high street: websites I've worked on ----------
    {
        const shops = [
            ['Kitchenmaker', 0xF4F1EA, 0x3E5560], ['Hari Tiny Homes', 0xE6EFE2, 0x34A851], ['Teamsports', 0xE4EAF4, 0x22407A],
            ['Football HQ', 0xF6F0DF, 0xE94335], ["Vaishnav's", 0xFBE8D2, 0xF58A1F], ['KK Decor', 0xF1E5EE, 0x7A4E8C],
            ['Sweta Furnishing', 0xEFE2D1, 0xB0563A], ['Krishna Solutions', 0xE2EDF2, 0x4285F4], ['Arcon Supplies', 0xE6E6E1, 0x5B646B],
            ['iProvideCare', 0xE8F3F0, 0x2A9D8F], ['Conceptualise', 0xF3EEE4, 0xD89A00], ['Exlan Auto Detailing', 0xECEFF2, 0x222D30],
        ];
        out.signs = [];
        shops.forEach(([name, wall, accent], i) => {
            const north = i < 6, x = -19.9 + (i % 6) * 2.75, h = 1.9 + r() * .8, d = 2.2;
            const face = north ? 8.4 : 11.2, cz = north ? face - d / 2 : face + d / 2, dir = north ? 1 : -1;
            K.box(2.5, h, d, wall, x, G, cz);
            if (i % 3 === 1) K.gable(2.75, .9, d + .25, accent, x, G + h, cz);
            else { K.box(2.6, .18, d + .1, accent, x, G + h, cz); K.box(2.6, .3, .12, wall, x, G + h, face - dir * .06); }
            K.box(.6, 1.2, .05, PAL.dark, x - .65, G, face + dir * .03);
            K.box(1.1, .9, .05, PAL.glass, x + .45, G + .35, face + dir * .03);
            K.box(2.3, .07, .6, accent, x, G + 1.42, face + dir * .3, 0, dir * .22);
            K.box(.06, .06, 1, PAL.dark, x + 1.12, G + 2.3, face + dir * .45);
            out.signs.push({ name, accent, x: x + 1.12, y: G + 2.02, z: face + dir * .66 });
        });
        K.box(.5, .02, .5, PAL.white, -20, G + 2.65, 5.2);
        spot('portfolio', 'High street', "Websites I've worked on", -21.6, G, 6, -4.6, G + 3.6, 13.8);
    }

    // ---------- road signs on the ring road ----------
    {
        const post = (x, z) => K.cyl(.09, 1.5, .09, PAL.steel, x, G, z, 6);
        post(11.2, -3.4);
        K.box(.66, .66, .04, PAL.amber, 11.2, G + 1.25, -3.36, -.5, 0, Math.PI / 4);
        K.box(.52, .52, .04, PAL.dark, 11.2 + .005, G + 1.32, -3.35, -.5, 0, Math.PI / 4);
        K.box(.42, .42, .04, PAL.amber, 11.2 + .01, G + 1.37, -3.34, -.5, 0, Math.PI / 4);
        post(-11.1, 2.6);
        K.cyl(.66, .04, .66, PAL.red, -11.1, G + 1.55, 2.62, 16, .4, Math.PI / 2);
        K.cyl(.48, .04, .48, PAL.white, -11.1, G + 1.55, 2.64, 16, .4, Math.PI / 2);
        post(3.4, 8.4);
        K.cyl(.74, .04, .74, PAL.red, 3.4, G + 1.75, 8.42, 3, 0, Math.PI / 2, Math.PI);
    }

    // ---------- the office: dashboards ----------
    {
        const ox = 20.5, oz = 5.5;
        K.box(4, .14, 3.4, PAL.paving, ox, G, oz);
        K.box(3.6, 2.8, 3, PAL.glass, ox, G + .14, oz);
        for (const x of [-1.8, -.6, .6, 1.8]) K.box(.12, 2.8, .12, PAL.white, ox + x, G + .14, oz + 1.5);
        for (const y of [1.05, 2.0]) K.box(3.62, .1, .1, PAL.white, ox, G + .14 + y, oz + 1.5);
        K.box(3.9, .24, 3.3, PAL.white, ox, G + 2.94, oz);
        K.box(.9, 1.4, .06, PAL.dark, ox - .9, G + .14, oz + 1.53);
        for (const x of [-1.4, 1.4]) K.box(.14, 1.5, .14, PAL.dark, ox + x, G + 3.18, oz - .6);
        out.board = { x: ox, y: G + 4.95, z: oz - .48, w: 3.6, h: 2.1 };
        K.box(3.9, 2.4, .16, PAL.dark, ox, G + 3.75, oz - .62);
        spot('dashboards', 'The office', 'Dashboards and directories', ox - 2.2, G, oz - 1.9, ox + 2.2, G + 6.4, oz + 1.9);
    }

    // ---------- trees: pohutukawa, cabbage trees and bush ----------
    const near = (x, z, x0, z0, x1, z1) => x > x0 && x < x1 && z > z0 && z < z1;
    const clear = (x, z) => {
        if (islandD(x, z) > .79) return false;
        const e = Math.hypot((x - RING.x) / RING.rx, (z - RING.z) / RING.rz);
        if (e > .78 && e < 1.2) return false;
        const vr = Math.hypot(x - VOLC.x, z - VOLC.z);
        if (vr < 3.6) return false;
        const keep = [[-6.2, -3.8, 6.2, 4.8], [9.3, -2.2, 17, 4.6], [8.6, 7.6, 16.4, 15], [-3.8, 12.2, 11, 22], [-22.8, 5.6, -3.4, 14.2],
            [-17.6, -6, -10.2, .8], [-25, -11.6, -15.4, -4], [-10.6, -11.6, -4.4, -2], [16.8, 2, 24.6, 9.8], [-5.8, -16.6, 8.6, -8.4], [-17.4, -17, -5.2, -6.6], [3.2, -14, 10.6, -6.6], [-2.2, 6, 3.6, 13]];
        return !keep.some(([x0, z0, x1, z1]) => near(x, z, x0, z0, x1, z1));
    };
    let planted = 0;
    for (let tries = 0; tries < 2400 && planted < 150; tries++) {
        const x = (r() - .5) * RX * 2, z = (r() - .5) * RZ * 2;
        if (!clear(x, z)) continue;
        const y = ground(x, z) - .05, s = .75 + r() * .55, kind = r(), onCone = Math.hypot(x - VOLC.x, z - VOLC.z) < VOLC.r;
        if (onCone) { K.cone(1.2 * s, 1.9 * s, 1.2 * s, r() < .5 ? PAL.leaf2 : PAL.volc2, x, y, z, 7); K.cone(.8 * s, 1.3 * s, .8 * s, PAL.leaf2, x, y + 1.2 * s, z, 7); }
        else if (kind < .38) { K.cyl(.22 * s, 1 * s, .22 * s, PAL.trunk, x, y, z, 6); K.ball(.85 * s, [PAL.leaf, PAL.leaf3, PAL.leaf2][Math.floor(r() * 3)], x, y + 1.45 * s, z); }
        else if (kind < .58) {   // pohutukawa: wide and dark, with red flowers on top
            K.cyl(.26 * s, .7 * s, .26 * s, PAL.trunk, x, y, z, 6);
            K.ball(1.1 * s, PAL.leaf2, x, y + 1.15 * s, z, 1.3, .72, 1.2);
            for (let k = 0; k < 6; k++) { const a = r() * Math.PI * 2, d2 = r() * .9 * s; K.ball(.16 * s, PAL.flower, x + Math.cos(a) * d2, y + 1.5 * s + r() * .2, z + Math.sin(a) * d2); }
        } else if (kind < .76) {   // cabbage tree: a thin trunk and a spiky tuft
            K.cyl(.12 * s, 1.7 * s, .12 * s, PAL.trunk, x, y, z, 6);
            for (let k = 0; k < 7; k++) { const a = k / 7 * Math.PI * 2; K.cone(.14 * s, .9 * s, .14 * s, PAL.leafLight, x + Math.cos(a) * .12 * s, y + 1.6 * s, z + Math.sin(a) * .12 * s, 5, -a, .9 * Math.cos(a) * 0, 0); }
            K.cone(.18 * s, .9 * s, .18 * s, PAL.leafLight, x, y + 1.62 * s, z, 5);
            for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2 + .3; K.cone(.12 * s, .85 * s, .12 * s, PAL.leafLight, x, y + 1.62 * s, z, 5, a, .85); }
        } else { K.cyl(.2 * s, .7 * s, .2 * s, PAL.trunk, x, y, z, 6); K.cone(1.3 * s, 1.5 * s, 1.3 * s, PAL.leaf2, x, y + .55 * s, z, 7); K.cone(.95 * s, 1.2 * s, .95 * s, PAL.leaf, x, y + 1.35 * s, z, 7); }
        planted++;
    }
    // rocks on the beach
    for (let i = 0; i < 26; i++) {
        const a = r() * Math.PI * 2, d = .9 + r() * .1, c = coast(a), k = d * c / Math.hypot(Math.cos(a) / RX, Math.sin(a) / RZ);
        const x = Math.cos(a) * k, z = Math.sin(a) * k;
        K.ball(.35 + r() * .45, r() < .5 ? PAL.rock : PAL.rock2, x, ground(x, z) + .1, z, 1.2, .7, 1);
    }
    // a jetty and a dinghy on the south-east shore
    for (let i = 0; i < 9; i++) K.box(1.4, .12, .5, PAL.woodLight, 20.5 + i * .25, .55, 16 + i * .55, -.45);
    for (let i = 0; i < 4; i++) K.cyl(.16, 1.4, .16, PAL.wood, 20.1 + i * .7, -.6, 16.2 + i * 1.35, 6);
    return out;
}

// a car, nose toward +x
function carKit(color) {
    const k = new Kit();
    k.box(1.55, .4, .82, color, 0, .18, 0);
    k.box(.88, .36, .74, color, -.1, .58, 0);
    k.box(.9, .26, .76, PAL.glass, -.1, .6, 0);
    for (const [x, z] of [[-.5, -.4], [.5, -.4], [-.5, .4], [.5, .4]]) k.cyl(.34, .18, .34, PAL.dark, x, .17, z - .09 * Math.sign(z), 10, 0, Math.PI / 2);
    return k;
}

// ---------- the robot guide ----------
function makeRobot(mat) {
    const g = new THREE.Group();
    const k = new Kit();
    k.box(1, .78, .82, PAL.white, 0, 0, 0);
    k.box(1.04, .1, .86, PAL.blue, 0, .48, 0);
    k.box(1.16, .82, .92, PAL.white, 0, .86, 0);
    k.box(.9, .56, .05, 0x22313A, 0, 1.0, .46);
    k.cyl(.07, .5, .07, PAL.steel, 0, 1.68, 0, 6);
    k.cone(.64, .42, .64, PAL.dark, 0, 0, 0, 10, 0, Math.PI);
    g.add(k.mesh(mat));
    const arm = (side) => {
        const a = new Kit();
        a.box(.2, .62, .22, PAL.white, 0, -.62, 0);
        a.ball(.15, PAL.blue, 0, -.7, 0);
        const m = a.mesh(mat);
        m.position.set(side * .62, .62, 0);
        g.add(m);
        return m;
    };
    const armL = arm(-1), armR = arm(1);
    const glow = new THREE.MeshBasicMaterial({ color: 0xCFF6FF });
    const eyes = new THREE.Group();
    for (const x of [-.2, .2]) { const e = new THREE.Mesh(new THREE.BoxGeometry(.17, .22, .02), glow); e.position.set(x, 1.28, .49); eyes.add(e); }
    g.add(eyes);
    const led = new THREE.Mesh(new THREE.IcosahedronGeometry(.11, 0), new THREE.MeshBasicMaterial({ color: 0x34A851 }));
    led.position.set(0, 2.24, 0);
    g.add(led);
    const flame = new THREE.Mesh(new THREE.ConeGeometry(.22, .55, 8).rotateX(Math.PI).translate(0, -.72, 0), new THREE.MeshBasicMaterial({ color: 0xFFC94A, transparent: true, opacity: .85 }));
    g.add(flame);
    g.scale.setScalar(1.05);
    g.traverse((o) => { if (o.isMesh && o.material === mat) o.castShadow = true; });
    return { g, armL, armR, eyes, led, flame };
}

// ---------- camera shots, one per section: where the camera is (p) and what it looks at (t) ----------
const KF = {
    home:         { p: [30, 42, 66], t: [0, 0, 2] },
    portfolio:    { p: [3.4, 6.2, 10.6], t: [-16, 2.4, 9.8] },
    services:     { p: [28, 22, 31], t: [6, 1, 4] },
    wordpress:    { p: [21.5, 12.5, 12.5], t: [13, 2.4, .8] },
    'it-support': { p: [18.8, 11.4, 21.4], t: [12, 2.1, 10.8] },
    automations:  { p: [8, 9.4, .4], t: [.6, 2.1, -10.4] },
    how:          { p: [8, 7.6, 15.5], t: [.2, 3.6, .6] },
    tools:        { p: [-8, 7.2, 8.6], t: [-14, 2.1, -3.2] },
    respond:      { p: [-6, 5.6, -3.2], t: [-8.3, 3, -11.8] },
    nzquiz:       { p: [17.5, 6.8, 9.5], t: [9.4, 1.4, .8], chase: true },
    atem:         { p: [-7.4, 4.8, -1], t: [-12.2, 2.1, -8.4] },
    dashboards:   { p: [26, 8.4, 17.5], t: [20.5, 3.8, 5.4] },
    heartbeats:   { p: [-1.5, 11.5, 3.5], t: [6.6, 6, -10.6] },
    magento:      { p: [-17.2, 8.6, 4.6], t: [-21.2, 1.8, -8.2] },
    jellyfin:     { p: [3.4, 6.4, 27.5], t: [2, 3.5, 13.6] },
    'tv-setup':   { p: [2.6, 4.6, 23.4], t: [2, 3.55, 13.6] },
    contact:      { p: [-24, 29, 47], t: [0, 1, 2] },
};
// where the robot waits: wide shots by hand; everywhere else it hovers beside what the camera looks at
const BOT = { home: [3.6, 7.4, 3.2], services: [7, 8, 6.4], how: [3.6, 3.9, 4.6], contact: [2.4, 7.2, 4] };
for (const id in KF) {
    if (BOT[id]) continue;
    const p = new THREE.Vector3().fromArray(KF[id].p), t = new THREE.Vector3().fromArray(KF[id].t);
    const d = t.clone().sub(p), dist = d.length();
    d.y = 0; d.normalize();
    const left = new THREE.Vector3(d.z, 0, -d.x);
    const at = t.clone().addScaledVector(left, dist * .19).addScaledVector(d, dist * .12);
    at.y = Math.max(t.y + dist * .2, ground(at.x, at.z) + 2.4);
    BOT[id] = at.toArray();
}
// the place each section is about, pinned with its name
const PLACE = {
    portfolio: ['High street', -12, 4.6, 9.8], wordpress: ['Server shed', 13, 4.9, 1], 'it-support': ['The house', 12, 5.1, 11],
    automations: ['The factory', -1, 5.2, -13], how: ['RoboCrax HQ', 0, 8.4, -.6], tools: ['The workshop', -14, 5, -3],
    respond: ['The hall', -13, 9.6, -13.4], nzquiz: ['The ring road', 9.6, 2.6, .6], atem: ['The hall', -13, 9.6, -13.4], dashboards: ['The office', 20.5, 7.8, 5.4],
    heartbeats: ['The radio mast', 7, 11.2, -11], magento: ['The warehouse', -21.5, 4.6, -8.5], jellyfin: ['The drive-in', 2, 7.8, 13.6],
    'tv-setup': ['The drive-in', 2, 7.8, 13.6],
};
const WAVE = new Set(['home', 'how', 'contact']);

// ---------- start ----------
async function start() {
    const mobile0 = phoneMQ.matches;
    await Promise.race([
        document.fonts ? Promise.all([document.fonts.load(`800 40px ${FONT}`), document.fonts.load(`600 40px ${MONO}`)]) : Promise.resolve(),
        new Promise((res) => setTimeout(res, 2500)),
    ]).catch(() => {});
    const logo = new Image();
    logo.src = 'logo.svg';
    await logo.decode().catch(() => {});

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: !mobile0, alpha: false, powerPreference: 'high-performance' });
    renderer.shadowMap.enabled = !mobile0;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const scene = new THREE.Scene();
    const HORIZON = new THREE.Color(0xE3F2F2);
    scene.fog = new THREE.Fog(HORIZON, 70, 185);
    const camera = new THREE.PerspectiveCamera(mobile0 ? 44 : 38, 1, .3, 600);

    // sky
    const sky = new THREE.Mesh(new THREE.SphereGeometry(420, 32, 16), new THREE.ShaderMaterial({
        side: THREE.BackSide, depthWrite: false, fog: false,
        uniforms: { top: { value: new THREE.Color(0x6FBCE0) }, mid: { value: new THREE.Color(0xB2DDEE) }, low: { value: HORIZON } },
        vertexShader: 'varying vec3 vP; void main(){ vP = normalize((modelMatrix * vec4(position, 1.)).xyz); gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.); }',
        fragmentShader: 'uniform vec3 top, mid, low; varying vec3 vP; void main(){ float h = vP.y; vec3 c = mix(low, mid, smoothstep(0., .16, h)); c = mix(c, top, smoothstep(.16, .62, h)); gl_FragColor = vec4(c, 1.); \n#include <colorspace_fragment>\n }',
    }));
    scene.add(sky);

    // light: a high sun from over your left shoulder, and a soft sky
    scene.add(new THREE.HemisphereLight(0xE4F4FF, 0x8FA77D, 2.0));
    const sun = new THREE.DirectionalLight(0xFFF1DA, 2.7);
    sun.position.set(-26, 42, 30);
    sun.castShadow = !mobile0;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -38, right: 38, top: 34, bottom: -34, near: 10, far: 120 });
    sun.shadow.camera.updateProjectionMatrix();
    sun.shadow.bias = -.0004;
    sun.shadow.normalBias = .04;
    scene.add(sun);

    const flat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    scene.add(buildTerrain(flat, mobile0));

    // the sea, rolling slowly
    const seaTime = { value: 0 };
    const seaMat = new THREE.MeshLambertMaterial({ color: 0x3BA7C8, transparent: true, opacity: .84, flatShading: true });
    seaMat.onBeforeCompile = (sh) => {
        sh.uniforms.uTime = seaTime;
        sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
            transformed.y += sin(position.x * .42 + uTime * .9) * .09 + cos(position.z * .37 + uTime * .7) * .09 + sin((position.x + position.z) * .21 + uTime * 1.3) * .05;`);
    };
    const seaGeo = new THREE.PlaneGeometry(260, 260, mobile0 ? 56 : 84, mobile0 ? 56 : 84).rotateX(-Math.PI / 2);
    const sea = new THREE.Mesh(seaGeo, seaMat);
    sea.position.y = .02;
    scene.add(sea);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(300, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x1D6F92 }));
    floor.position.y = -3.05;
    scene.add(floor);
    // surf along the shore
    {
        const k = new Kit(), N = 140;
        for (let i = 0; i < N; i++) {
            const a0 = i / N * Math.PI * 2, a1 = (i + 1) / N * Math.PI * 2;
            const at = (a, d) => { const c = coast(a) * d / Math.hypot(Math.cos(a) / RX, Math.sin(a) / RZ); return [Math.cos(a) * c, Math.sin(a) * c]; };
            const [x0, z0] = at(a0, 1.005), [x1, z1] = at(a1, 1.005);
            k.box(Math.hypot(x1 - x0, z1 - z0) + .05, .02, .34, PAL.white, (x0 + x1) / 2, .1, (z0 + z1) / 2, -Math.atan2(z1 - z0, x1 - x0));
        }
        const surf = k.mesh(new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: .55 }));
        scene.add(surf);
    }

    // everything that stands still: one mesh
    const K = new Kit();
    const W = buildWorld(K);
    const world = K.mesh(flat);
    world.castShadow = world.receiveShadow = true;
    scene.add(world);

    // pictures: the logo on HQ, the shop signs, the hall screen, the laptop, ON AIR, the drive-in screen
    const plane = (w, h, mat, x, y, z, ry = 0, rx = 0) => {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
        m.position.set(x, y, z);
        m.rotation.set(rx, ry, 0, 'YXZ');
        scene.add(m);
        return m;
    };
    const logoTex = canvasTex(256, 356, (g, w, h) => g.drawImage(logo, 8, 8, w - 16, h - 16));
    plane(2.1, 2.92, new THREE.MeshLambertMaterial({ map: logoTex, transparent: true, alphaTest: .5, side: THREE.DoubleSide }), 0, G + 3.28 + 1.62, -.98);
    {
        const rowH = 112, signs = W.signs;
        const atlas = canvasTex(512, rowH * signs.length, (g) => {
            signs.forEach((s, i) => {
                const y = i * rowH;
                g.fillStyle = '#' + s.accent.toString(16).padStart(6, '0');
                rr(g, 6, y + 6, 500, rowH - 12, 18); g.fill();
                g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 5; rr(g, 16, y + 16, 480, rowH - 32, 12); g.stroke();
                g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
                let size = 56;
                do { g.font = `800 ${size}px ${FONT}`; size -= 2; } while (g.measureText(s.name).width > 440 && size > 20);
                g.fillText(s.name, 256, y + rowH / 2 + 4);
            });
        });
        const pos = [], uv = [], n = signs.length, w = 1.15, h = .25;
        signs.forEach((s, i) => {
            const v0 = 1 - (i + 1) / n, v1 = 1 - i / n;
            const BL = [s.x, s.y - h, s.z + w / 2], BR = [s.x, s.y - h, s.z - w / 2], TR = [s.x, s.y + h, s.z - w / 2], TL = [s.x, s.y + h, s.z + w / 2];
            pos.push(...BL, ...BR, ...TR, ...BL, ...TR, ...TL);
            uv.push(0, v0, 1, v0, 1, v1, 0, v0, 1, v1, 0, v1);
        });
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        g.computeVertexNormals();
        scene.add(new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: atlas })));
    }
    const quizTex = canvasTex(512, 296, (g, w, h) => {
        g.fillStyle = '#20154A'; g.fillRect(0, 0, w, h);
        g.fillStyle = '#fff'; rr(g, 20, 18, w - 40, 64, 10); g.fill();
        g.fillStyle = '#20154A'; g.font = `800 30px ${FONT}`; g.textAlign = 'center'; g.fillText('Question 4 of 10', w / 2, 61);
        ['#E94335', '#4285F4', '#F5B800', '#34A851'].forEach((c, i) => {
            const x = 20 + (i % 2) * 240, y = 98 + Math.floor(i / 2) * 96;
            g.fillStyle = c; rr(g, x, y, 232, 86, 10); g.fill();
            g.fillStyle = '#fff'; g.beginPath();
            const cx = x + 44, cy = y + 43;
            if (i === 0) { g.moveTo(cx, cy - 20); g.lineTo(cx + 20, cy + 16); g.lineTo(cx - 20, cy + 16); }
            else if (i === 1) { g.moveTo(cx, cy - 21); g.lineTo(cx + 17, cy); g.lineTo(cx, cy + 21); g.lineTo(cx - 17, cy); }
            else if (i === 2) g.arc(cx, cy, 18, 0, Math.PI * 2);
            else g.rect(cx - 16, cy - 16, 32, 32);
            g.fill();
            g.fillStyle = 'rgba(255,255,255,.55)'; rr(g, x + 82, y + 36, 120, 14, 7); g.fill();
        });
    });
    plane(W.quizScreen.w, W.quizScreen.h, new THREE.MeshBasicMaterial({ map: quizTex }), W.quizScreen.x, W.quizScreen.y, W.quizScreen.z);
    const lapTex = canvasTex(256, 160, (g, w, h) => {
        g.fillStyle = '#0F2124'; g.fillRect(0, 0, w, h);
        g.fillStyle = '#143035'; g.fillRect(0, 0, w, 18);
        [['#D7E4E2', .7], ['#8FE0A8', .9], ['#9AB0B1', .5], ['#9AB0B1', .55], ['#D7E4E2', .45], ['#34A851', .8], ['#8FE0A8', .6]].forEach(([c, len], i) => { g.fillStyle = c; g.fillRect(12, 28 + i * 18, (w - 24) * len, 8); });
    });
    const lap = plane(.5, .32, new THREE.MeshBasicMaterial({ map: lapTex }), W.laptop.x, W.laptop.y + .16, W.laptop.z, 0, -.25);
    lap.visible = true;
    const onAirTex = canvasTex(256, 96, (g, w, h) => {
        g.fillStyle = '#E94335'; rr(g, 4, 4, w - 8, h - 8, 14); g.fill();
        g.fillStyle = '#fff'; g.font = `900 52px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('ON AIR', w / 2, h / 2 + 5);
    });
    const onAirMat = new THREE.MeshBasicMaterial({ map: onAirTex, color: 0x777777 });
    plane(1.05, .4, onAirMat, W.onAir.x, W.onAir.y, W.onAir.z);
    const boardTex = canvasTex(512, 300, (g, w, h) => {
        g.fillStyle = '#F1F4F8'; g.fillRect(0, 0, w, h);
        g.fillStyle = '#0F172A'; g.font = `800 26px ${FONT}`; g.fillText('Dashboard', 22, 40);
        ['#3B5BDB', '#2F9E44', '#E8590C'].forEach((c, i) => {
            const x = 22 + i * 160;
            g.fillStyle = '#fff'; rr(g, x, 58, 148, 62, 10); g.fill();
            g.fillStyle = '#CBD5E1'; rr(g, x + 14, 72, 60, 9, 4); g.fill();
            g.fillStyle = c; rr(g, x + 14, 92, 40 + i * 22, 14, 5); g.fill();
        });
        g.fillStyle = '#fff'; rr(g, 22, 134, 300, 148, 10); g.fill(); rr(g, 334, 134, 156, 148, 10); g.fill();
        [['#3B5BDB', 0], ['#E64980', 1.7], ['#2F9E44', 3.4]].forEach(([c, ph]) => {
            g.strokeStyle = c; g.lineWidth = 4; g.beginPath();
            for (let i = 0; i <= 20; i++) { const x = 36 + i * 13.5, y = 222 - Math.sin(i / 3 + ph) * 28 - i * 1.6; i ? g.lineTo(x, y) : g.moveTo(x, y); }
            g.stroke();
        });
        [70, 52, 44, 30, 22].forEach((v, i) => { g.fillStyle = ['#3B5BDB', '#2F9E44', '#F59F00', '#E64980', '#94A3B8'][i]; rr(g, 348, 152 + i * 25, v * 1.7, 13, 6); g.fill(); });
    });
    plane(W.board.w, W.board.h, new THREE.MeshBasicMaterial({ map: boardTex }), W.board.x, W.board.y, W.board.z);
    const screenTex = canvasTex(640, 360, (g, w, h) => drawDriveIn(g, w, h, 'play'));
    plane(W.screen.w, W.screen.h, new THREE.MeshBasicMaterial({ map: screenTex }), W.screen.x, W.screen.y, W.screen.z);
    let screenMode = 'play';
    const setScreen = (mode) => {
        if (mode === screenMode) return;
        screenMode = mode;
        drawDriveIn(screenTex.userData.g, 640, 360, mode);
        screenTex.needsUpdate = true;
    };

    // ---------- the moving parts ----------
    const lambert = (c) => new THREE.MeshLambertMaterial({ color: c, flatShading: true });
    const shedRoof = W.shedRoof.kit.mesh(flat); shedRoof.castShadow = true; scene.add(shedRoof);
    const houseRoof = W.houseRoof.kit.mesh(flat); houseRoof.castShadow = true; scene.add(houseRoof);
    // rack lights
    const ledMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const leds = new THREE.InstancedMesh(new THREE.BoxGeometry(.07, .045, .02), ledMat, W.leds.length);
    const ledCol = { g: new THREE.Color(0x46E06A), b: new THREE.Color(0x6AA8FF), off: new THREE.Color(0x24333A) };
    W.leds.forEach(([x, y, z], i) => { leds.setMatrixAt(i, new THREE.Matrix4().makeTranslation(x, y, z)); leds.setColorAt(i, ledCol.g); });
    scene.add(leds);
    let ledClock = 0;
    const blink = () => {
        const rnd = Math.random;
        W.leds.forEach(([, , , k], i) => leds.setColorAt(i, rnd() < .22 ? ledCol.off : ledCol[k]));
        leds.instanceColor.needsUpdate = true;
    };
    // the conveyor's boxes of data
    const belt = W.belt, NB = 9;
    const crates = new THREE.InstancedMesh(new THREE.BoxGeometry(.46, .46, .46).translate(0, .23, 0), lambert(0xffffff), NB);
    const crateCols = [PAL.red, PAL.amber, PAL.green, PAL.blue].map((c) => new THREE.Color(c));
    for (let i = 0; i < NB; i++) crates.setColorAt(i, crateCols[i % 4]);
    crates.castShadow = true;
    scene.add(crates);
    // the factory's gear
    const gearK = new Kit();
    gearK.cyl(1.1, .18, 1.1, PAL.amber, 0, 0, 0, 10, 0, Math.PI / 2);
    for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2; gearK.box(.2, .22, .22, PAL.amber, Math.cos(a) * .6, Math.sin(a) * .6 - .11, 0, 0, 0, a); }
    gearK.cyl(.32, .2, .32, PAL.dark, 0, 0, .0, 10, 0, Math.PI / 2);
    const gear = gearK.mesh(flat);
    gear.position.set(W.gear.x, W.gear.y, W.gear.z);
    scene.add(gear);
    // the learner driver on the ring road
    const carK = carKit(PAL.sky);
    carK.box(.2, .2, .03, PAL.amber, .79, .3, 0, Math.PI / 2);
    carK.box(.2, .2, .03, PAL.amber, -.79, .3, 0, Math.PI / 2);
    const car = carK.mesh(flat);
    car.castShadow = true;
    scene.add(car);
    // packets of data riding the ring road
    const NP = 10;
    const packets = new THREE.InstancedMesh(new THREE.BoxGeometry(.26, .26, .26), new THREE.MeshBasicMaterial({ color: 0xffffff }), NP);
    const pkCols = [0xE94335, 0xF5B800, 0x34A851, 0x4285F4].map((c) => new THREE.Color(c));
    for (let i = 0; i < NP; i++) packets.setColorAt(i, pkCols[i % 4]);
    scene.add(packets);
    // pings from the radio mast
    const rings = [0, 1, 2].map(() => {
        const m = new THREE.Mesh(new THREE.TorusGeometry(1, .06, 6, 40).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x34A851, transparent: true, opacity: 0, depthWrite: false }));
        m.position.set(W.mastTop.x, W.mastTop.y, W.mastTop.z);
        scene.add(m);
        return m;
    });
    const beacon = new THREE.Mesh(new THREE.IcosahedronGeometry(.2, 0), new THREE.MeshBasicMaterial({ color: 0xFF4A3A }));
    beacon.position.set(W.mastTop.x, W.mastTop.y, W.mastTop.z);
    scene.add(beacon);
    const devLeds = W.devices.map((d) => { const m = new THREE.Mesh(new THREE.BoxGeometry(.1, .08, .02), new THREE.MeshBasicMaterial({ color: 0x46E06A })); m.position.set(d.x, d.y, d.z); scene.add(m); return m; });
    const tally = new THREE.Mesh(new THREE.BoxGeometry(.14, .1, .14), new THREE.MeshBasicMaterial({ color: 0x5A2A26 }));
    tally.position.set(W.tally.x, W.tally.y, W.tally.z);
    scene.add(tally);
    // clouds
    const clouds = [];
    {
        const cr = rng(5);
        for (let i = 0; i < 7; i++) {
            const k = new Kit();
            const n = 4 + Math.floor(cr() * 3);
            for (let j = 0; j < n; j++) k.ball(1.2 + cr() * 1.4, PAL.white, (j - n / 2) * 1.6 + cr(), cr() * .8, (cr() - .5) * 2, 1, .75, 1);
            const m = k.mesh(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, transparent: true, opacity: .95 }));
            m.position.set(-90 + i * 28 + cr() * 10, 15 + cr() * 7, -30 + cr() * 50);
            m.userData.speed = .6 + cr() * .6;
            scene.add(m);
            clouds.push(m);
        }
    }
    // the robot guide
    const bot = makeRobot(flat);
    scene.add(bot.g);

    // ---------- layout: the island fills the space beside the page ----------
    const scenes = window.Site ? window.Site.scenes : [];
    let Wd = 1, Hd = 1, mobile = mobile0, headH = 76, win = 0, colLeft = 0;
    function measure() {
        mobile = phoneMQ.matches;
        headH = header ? header.offsetHeight + 28 : 76;
        win = mobile ? (parseFloat(getComputedStyle(scenes[1] || document.body).paddingTop) || innerHeight * .44) : 0;
        const c = scenes[1] && scenes[1].querySelector('.copy');
        colLeft = c ? c.getBoundingClientRect().left : Wd * .6;
        measureSheets();
    }
    function layout() {
        Wd = canvas.clientWidth || innerWidth; Hd = canvas.clientHeight || innerHeight;
        renderer.setPixelRatio(Math.min(devicePixelRatio || 1, mobile ? 1.5 : 1.75));
        renderer.setSize(Wd, Hd, false);
        camera.aspect = Wd / Hd;
        camera.fov = mobile ? 44 : 38;
        wake();
    }
    const frameCenter = () => mobile
        ? [Wd / 2, headH + win / 2 - 10]
        : [Math.max(Wd * .3, Math.min(Wd * .5, colLeft / 2)), headH / 2 + Hd / 2];

    // ---------- on a phone, stop drawing while a section's page covers the window ----------
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
        if (c !== covered) { covered = c; stageEl.style.visibility = c ? 'hidden' : ''; if (!c) wake(); }
    }

    // ---------- scroll ----------
    let blend = { a: 'home', b: 'home', t: 0 }, active = 'home';
    window.addEventListener('site:frame', (e) => {
        const d = e.detail;
        blend = { a: d.a, b: d.b, t: d.t };
        checkCovered(d.y, d.i);
        wake();
    });
    window.addEventListener('site:section', (e) => { active = e.detail.stage; wake(); });
    window.addEventListener('site:measure', () => { measure(); layout(); });

    // ---------- pointer: look around, hover a building, click it ----------
    const raycaster = new THREE.Raycaster(), ndc = new THREE.Vector2(), hitP = new THREE.Vector3();
    let px = -1, py = -1, lastActive = performance.now(), hovered = null;
    let dragging = false, dragMoved = false, downX = 0, downY = 0, yawOff = 0, pitchOff = 0, tapAt = 0;
    const parallax = { x: 0, y: 0 };
    const free = (el) => !el.closest('.copy, a, button, input, textarea, select, label, iframe, .site-head, .modal, [data-design-switcher]');
    function pick(x, y) {
        const rc = canvas.getBoundingClientRect();
        if (y > rc.bottom) return null;
        ndc.set(((x - rc.left) / rc.width) * 2 - 1, -((y - rc.top) / rc.height) * 2 + 1);
        raycaster.setFromCamera(ndc, camera);
        let best = null, bestD = Infinity;
        for (const s of W.spots) if (raycaster.ray.intersectBox(s.box, hitP)) { const d = hitP.distanceTo(raycaster.ray.origin); if (d < bestD) { bestD = d; best = s; } }
        return best;
    }
    function setHover(s, x, y) {
        hovered = s;
        document.documentElement.classList.toggle('hovering', !!s);
        if (!s) { tipEl.hidden = true; return; }
        tipEl.innerHTML = `<b>${s.name}</b><span>${s.note}</span>`;
        tipEl.hidden = false;
        tipEl.style.transform = `translate(${Math.round(x + 16)}px, ${Math.round(y + 14)}px)`;
    }
    const visit = (id) => {
        const el = document.getElementById(id);
        if (el) el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
    };
    window.addEventListener('pointermove', (e) => {
        px = e.clientX; py = e.clientY;
        parallax.x = (px / innerWidth) * 2 - 1;
        parallax.y = (py / innerHeight) * 2 - 1;
        if (dragging) {
            if (Math.abs(e.clientX - downX) + Math.abs(e.clientY - downY) > 5) dragMoved = true;
            if (dragMoved) { yawOff = Math.max(-1.3, Math.min(1.3, yawOff - e.movementX * .005)); pitchOff = Math.max(-.35, Math.min(.5, pitchOff + e.movementY * .003)); }
            setHover(null);
        } else if (e.pointerType === 'mouse') {
            setHover(free(e.target) ? pick(e.clientX, e.clientY) : null, e.clientX, e.clientY);
        }
        wake();
    }, { passive: true });
    document.addEventListener('mouseout', (e) => { if (!e.relatedTarget) setHover(null); });
    window.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || !free(e.target)) return;
        if (e.pointerType === 'mouse') {
            dragging = true; dragMoved = false; downX = e.clientX; downY = e.clientY;
            document.documentElement.classList.add('dragging');
            e.preventDefault();
        } else { tapAt = performance.now(); downX = e.clientX; downY = e.clientY; }
        wake();
    });
    window.addEventListener('pointerup', (e) => {
        if (dragging) {
            dragging = false;
            document.documentElement.classList.remove('dragging');
            // a click goes where the tooltip says, even if the camera has drifted a touch since it appeared
            if (!dragMoved) { const s = (e.pointerType === 'mouse' && hovered) || pick(e.clientX, e.clientY); if (s) visit(s.id); }
        } else if (tapAt && performance.now() - tapAt < 450 && Math.hypot(e.clientX - downX, e.clientY - downY) < 10) {
            const s = pick(e.clientX, e.clientY);
            if (s) visit(s.id);
        }
        tapAt = 0;
        wake();
    });
    window.addEventListener('pointercancel', () => { tapAt = 0; dragging = false; document.documentElement.classList.remove('dragging'); });

    // ---------- the loop ----------
    const camP = new THREE.Vector3(70, 70, 120), camT = new THREE.Vector3(0, 0, 0);
    if (reduced) { camP.fromArray(KF.home.p); camT.fromArray(KF.home.t); }
    const botP = new THREE.Vector3().fromArray(BOT.home);
    const goalP = new THREE.Vector3(), goalT = new THREE.Vector3(), tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), offset = new THREE.Vector3(), pinV = new THREE.Vector3();
    let raf = 0, last = 0, time = 0, intro = reduced ? 0 : 1, shedLift = 0, houseLift = 0, carA = 0, blinkAt = 3, wave = 0, onAir = 0;
    const visible = true;
    function wake() {
        lastActive = performance.now();
        if (!raf && visible && !document.hidden && !covered) { last = performance.now(); raf = requestAnimationFrame(tick); }
    }
    function tick(now) {
        raf = 0;
        const dt = Math.min(.05, (now - last) / 1000);
        last = now;
        time += dt;
        const anim = reduced ? 0 : 1;

        // the learner driver laps the ring road; for the road code quiz the camera rides along behind
        carA += dt * .16 * anim;
        const ca = carA % (Math.PI * 2);
        car.position.set(RING.x + Math.cos(ca) * (RING.rx - .38), G + .02, RING.z + Math.sin(ca) * (RING.rz - .38));
        car.rotation.y = -Math.atan2(Math.cos(ca) * RING.rz, -Math.sin(ca) * RING.rx);
        {
            const fx = -Math.sin(ca) * RING.rx, fz = Math.cos(ca) * RING.rz, fl = Math.hypot(fx, fz);
            const hx = fx / fl, hz = fz / fl, ox = Math.cos(ca), oz = Math.sin(ca);
            const c = car.position;
            KF.nzquiz.p = [c.x - hx * 6.5 - ox * .9, G + 4.6, c.z - hz * 6.5 - oz * .9];
            KF.nzquiz.t = [c.x + hx * 3.5, G + 1, c.z + hz * 3.5];
            BOT.nzquiz = [c.x + ox * 2.2 + hx * 5, G + 3.4, c.z + oz * 2.2 + hz * 5];
        }

        // camera: the blend of the two shots around the scroll position, with a lift on long flights
        const A = KF[blend.a] || KF.home, B = KF[blend.b] || A, m = smooth(blend.t);
        tmpA.fromArray(A.p); tmpB.fromArray(B.p);
        goalP.lerpVectors(tmpA, tmpB, m);
        goalP.y += Math.sin(m * Math.PI) * Math.min(12, tmpA.distanceTo(tmpB) * .3);
        tmpA.fromArray(A.t); tmpB.fromArray(B.t);
        goalT.lerpVectors(tmpA, tmpB, m);
        // a drag swings the camera around what it is looking at; let go and it drifts back
        if (!dragging) { yawOff *= Math.exp(-dt * 1.2); pitchOff *= Math.exp(-dt * 1.2); }
        offset.subVectors(goalP, goalT);
        offset.applyAxisAngle(THREE.Object3D.DEFAULT_UP, yawOff + parallax.x * .05);
        offset.y += offset.length() * (pitchOff + parallax.y * .03);
        goalP.addVectors(goalT, offset);
        if (intro > 0) intro = Math.max(0, intro - dt / 3);
        const k = 1 - Math.exp(-dt * (intro > 0 ? 1.4 : 3.4));
        camP.lerp(goalP, reduced ? 1 : k);
        camT.lerp(goalT, reduced ? 1 : k);
        camera.position.copy(camP);
        camera.lookAt(camT);
        const [cx, cy] = frameCenter();
        camera.setViewOffset(Wd, Hd, Wd / 2 - cx, Hd / 2 - cy, Wd, Hd);
        camera.updateProjectionMatrix();

        // the reveals: roofs lift off the shed and the house; the drive-in shows the code for TV setup
        const focus = (id) => (blend.a === id ? 1 - m : 0) + (blend.b === id ? m : 0);
        shedLift += (focus('wordpress') - shedLift) * (1 - Math.exp(-dt * 3));
        houseLift += (focus('it-support') - houseLift) * (1 - Math.exp(-dt * 3));
        shedRoof.position.set(W.shedRoof.x, W.shedRoof.y + smooth(shedLift) * 3.4, W.shedRoof.z + smooth(shedLift) * -1.2);
        shedRoof.rotation.x = -smooth(shedLift) * .5;
        houseRoof.position.set(W.houseRoof.x, W.houseRoof.y + smooth(houseLift) * 3, W.houseRoof.z - smooth(houseLift) * 1.4);
        houseRoof.rotation.x = -smooth(houseLift) * .55;
        setScreen(focus('tv-setup') > .5 ? 'code' : 'play');
        onAir += ((focus('atem') > .3 ? 1 : 0) - onAir) * (1 - Math.exp(-dt * 6));
        onAirMat.color.setScalar(.45 + .55 * onAir);
        tally.material.color.setHex(onAir > .5 && (Math.floor(time * 2) % 2 === 0 || reduced) ? 0xFF3B30 : 0x5A2A26);

        // ambient life
        seaTime.value = time * anim;
        clouds.forEach((c) => { c.position.x += c.userData.speed * dt * anim; if (c.position.x > 110) c.position.x = -110; });
        ledClock += dt;
        if (ledClock > .28 && anim) { ledClock = 0; blink(); }
        for (let i = 0; i < NB; i++) {
            const u = ((time * .9 * anim + i * (belt.x1 - belt.x0) / NB) % (belt.x1 - belt.x0));
            crates.setMatrixAt(i, new THREE.Matrix4().makeTranslation(belt.x0 + u, belt.y, belt.z));
        }
        crates.instanceMatrix.needsUpdate = true;
        gear.rotation.z = -time * .8 * anim;
        for (let i = 0; i < NP; i++) {
            const a = (i / NP) * Math.PI * 2 - time * (.1 + (i % 3) * .03) * anim, lane = i % 2 ? .38 : -.38;
            packets.setMatrixAt(i, new THREE.Matrix4().makeTranslation(RING.x + Math.cos(a) * (RING.rx + lane), G + .3 + Math.sin(time * 3 + i) * .05, RING.z + Math.sin(a) * (RING.rz + lane)));
        }
        packets.instanceMatrix.needsUpdate = true;
        rings.forEach((ring, i) => {
            const t = ((time * anim * .5 + i / 3) % 1);
            ring.scale.setScalar(.4 + t * 4.6);
            ring.material.opacity = (1 - t) * .75 * (anim ? 1 : 0);
        });
        beacon.material.color.setHex(Math.floor(time * 1.5) % 2 === 0 || reduced ? 0xFF4A3A : 0x6A2A26);
        devLeds.forEach((l, i) => l.material.color.setHex(Math.floor(time * 2 + i * .7) % 3 === 0 && anim ? 0x24333A : 0x46E06A));

        // the robot: flies to the section's place, faces you, waves hello and goodbye
        const ba = BOT[blend.a] || BOT.home, bb = BOT[blend.b] || ba;
        tmpA.fromArray(ba); tmpB.fromArray(bb);
        tmpA.lerp(tmpB, m);
        botP.lerp(tmpA, 1 - Math.exp(-dt * 2.2));
        bot.g.position.set(botP.x, botP.y + Math.sin(time * 2.1) * .14 * anim, botP.z);
        const face = Math.atan2(camP.x - botP.x, camP.z - botP.z);
        bot.g.rotation.y += (((face - bot.g.rotation.y + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * (1 - Math.exp(-dt * 4));
        bot.g.rotation.z = Math.max(-.25, Math.min(.25, (tmpA.x - botP.x) * -.06));
        wave += ((WAVE.has(active) ? 1 : 0) - wave) * (1 - Math.exp(-dt * 4));
        bot.armR.rotation.z = wave * (2.5 + Math.sin(time * 8) * .35 * anim);
        bot.armL.rotation.z = -.08;
        if (time > blinkAt) { bot.eyes.scale.y = .15; if (time > blinkAt + .12) { bot.eyes.scale.y = 1; blinkAt = time + 2.6 + Math.random() * 2.4; } }
        bot.led.material.color.setHex(Math.floor(time * 1.2) % 2 === 0 ? 0x46E06A : 0x1F6A33);
        bot.flame.scale.y = .8 + Math.sin(time * 22) * .15 * anim;

        // the pin over the section's place
        const pl = PLACE[active];
        if (pl && !mobile) {
            pinV.set(pl[1], pl[2], pl[3]).project(camera);
            const sx = (pinV.x * .5 + .5) * Wd, sy = (-pinV.y * .5 + .5) * Hd;
            const onScreen = pinV.z < 1 && sx > 20 && sx < colLeft - 30 && sy > headH && sy < Hd - 20;
            pinEl.hidden = false;
            pinEl.firstChild.textContent = pl[0];
            pinEl.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px) translate(-50%, -100%)`;
            pinEl.classList.toggle('off', !onScreen || intro > .2);
        } else pinEl.hidden = true;

        renderer.render(scene, camera);

        const chasing = blend.a === 'nzquiz' || blend.b === 'nzquiz';
        const settling = intro > 0 || (!chasing && camP.distanceToSquared(goalP) > 1e-4) || camT.distanceToSquared(goalT) > 1e-4 || dragging || Math.abs(yawOff) > .002 || (!chasing && botP.distanceToSquared(tmpA) > 1e-4);
        if (settling || (!reduced && now - lastActive < HOLD_MS)) raf = requestAnimationFrame(tick);
    }
    document.addEventListener('visibilitychange', () => { if (document.hidden) { cancelAnimationFrame(raf); raf = 0; } else wake(); });
    window.addEventListener('resize', () => { measure(); layout(); });
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); document.documentElement.classList.add('no-stage'); });

    measure();
    layout();
    if (window.Site) window.Site.update();
    document.documentElement.classList.add('stage-ready');
    wake();
}

function hasWebGL() {
    try { const c = document.createElement('canvas'); return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl'))); }
    catch (e) { return false; }
}
if (!canvas || !hasWebGL()) document.documentElement.classList.add('no-stage');
else start().catch((err) => { console.error(err); document.documentElement.classList.add('no-stage'); });
