// bento.mjs — turns the site's <main> (built from rack.html) into the Bento design's slides.
// Every section becomes one bento box of tiles; the portfolio becomes three, so every site gets a tile.
// The copy is untouched: a recipe per section only decides which parts share a tile and how big each tile is.
// Anything a recipe doesn't place still gets a tile of its own, with a warning, so new copy never goes missing.
// Tile sizes are classes: cN spans N of 12 columns and rN spans N rows on wider screens; m1 is half width on phones.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ICONS = JSON.parse(fs.readFileSync(path.join(here, 'bento-icons.json'), 'utf8'));

// ---------- a small parser: enough for rack.html, which is well formed ----------
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const RAW = new Set(['pre', 'script', 'style', 'textarea']);
let SRC = '';

function parse(src) {
    const root = { type: 'el', tag: '#root', attrs: '', start: 0, innerStart: 0, innerEnd: src.length, end: src.length, children: [] };
    const stack = [root];
    const re = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
    let m, last = 0;
    while ((m = re.exec(src))) {
        const parent = stack[stack.length - 1];
        if (m.index > last) parent.children.push({ type: 'text', start: last, end: m.index });
        last = re.lastIndex;
        if (m[0].startsWith('<!--')) { parent.children.push({ type: 'comment', start: m.index, end: last }); continue; }
        const tag = m[2].toLowerCase();
        if (m[1]) {
            if (parent.tag !== tag) throw new Error(`bento: </${tag}> closes <${parent.tag}> at ${m.index}`);
            stack.pop();
            parent.innerEnd = m.index;
            parent.end = last;
            continue;
        }
        const node = { type: 'el', tag, attrs: m[3], start: m.index, innerStart: last, innerEnd: last, end: last, children: [] };
        parent.children.push(node);
        if (VOID.has(tag) || /\/\s*$/.test(m[3])) continue;
        if (RAW.has(tag)) {
            const close = src.indexOf(`</${tag}>`, last);
            node.innerEnd = close;
            node.end = close + tag.length + 3;
            re.lastIndex = last = node.end;
            continue;
        }
        stack.push(node);
    }
    if (stack.length !== 1) throw new Error(`bento: <${stack[stack.length - 1].tag}> is never closed`);
    return root;
}

const attr = (n, name) => { const m = n.attrs.match(new RegExp(`\\s${name}="([^"]*)"`)); return m ? m[1] : null; };
const classes = (n) => (attr(n, 'class') || '').split(/\s+/).filter(Boolean);
// simple selectors only: tag, .class, #id and combinations of them, with commas between alternatives
function is(n, sel) {
    if (!n || n.type !== 'el') return false;
    return sel.split(',').some((s) => {
        const m = s.trim().match(/^([a-z0-9]*)((?:[.#][\w-]+)*)$/i);
        if (!m) throw new Error(`bento: can't read the selector "${s}"`);
        if (m[1] && m[1] !== n.tag) return false;
        return (m[2].match(/[.#][\w-]+/g) || []).every((p) => (p[0] === '.' ? classes(n).includes(p.slice(1)) : attr(n, 'id') === p.slice(1)));
    });
}
const kids = (n, sel) => n.children.filter((c) => c.type === 'el' && (!sel || is(c, sel)));
function find(n, sel) {
    for (const c of n.children || []) {
        if (is(c, sel)) return c;
        const d = find(c, sel);
        if (d) return d;
    }
    return null;
}
const text = (n) => SRC.slice(n.innerStart, n.innerEnd).replace(/<[^>]*>/g, '').trim();
const openTag = (n) => SRC.slice(n.start, n.innerStart);

// ---------- writing markup back out, re-indented to where it now sits ----------
const pad = (n) => ' '.repeat(n);
const col = (pos) => pos - SRC.lastIndexOf('\n', pos - 1) - 1;
// every line after the first moves by `by` spaces, except the lines inside a <pre>
function shift(str, by) {
    let inPre = false;
    return str.split('\n').map((line, i) => {
        const out = i === 0 || inPre ? line : by >= 0 ? pad(by) + line : line.replace(new RegExp(`^ {0,${-by}}`), '');
        const opens = (line.match(/<pre[\s>]/g) || []).length, closes = (line.match(/<\/pre>/g) || []).length;
        if (opens !== closes) inPre = opens > closes;
        return out;
    }).join('\n');
}
// a node at `indent`, optionally with a different opening tag
function emit(n, indent, open) {
    const body = SRC.slice(open ? n.innerStart : n.start, n.end);
    return pad(indent) + (open || '') + shift(body, indent - col(n.start));
}
const withClass = (n, add) => {
    const o = openTag(n);
    return / class="/.test(o) ? o.replace(/ class="([^"]*)"/, (_, c) => ` class="${c} ${add}"`) : o.replace(/^<([\w-]+)/, `<$1 class="${add}"`);
};

const I = 20;   // tiles sit inside section > .slide > .bento
const list = (...c) => c.filter(Boolean).join(' ');
// a new tile around parts of the copy (nodes, or markup already indented for inside a tile)
function tile(parts, { span = 'c12', cls = '', attrs = '' } = {}) {
    const body = parts.filter(Boolean).map((p) => (typeof p === 'string' ? p : emit(p, I + 4))).join('\n');
    return `${pad(I)}<div class="${list('tile', span, cls)}"${attrs}>\n${body}\n${pad(I)}</div>`;
}
// a part of the copy that is a card already becomes a tile as it is, with an icon in front if there is one
function asTile(n, span, cls = '', lead = '') {
    const open = withClass(n, list('tile', span, cls));
    return emit(n, I, open + (lead ? `\n${pad(I + 4)}${lead}` : ''));
}

// ---------- icons (decorative: the text beside them says the same) ----------
function icon(name, tone = '') {
    const body = ICONS.icons[name];
    if (!body) throw new Error(`bento: no icon ${name}`);
    const [kind, id] = name.split(':');
    const paint = kind === 'lu' ? ' fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"' : ' fill="currentColor"';
    const colour = kind === 'si' && ICONS.colours[id] ? ` style="color:${ICONS.colours[id]}"` : '';
    return `<svg class="${list('ic', tone)}" viewBox="0 0 24 24"${paint}${colour} aria-hidden="true">${body}</svg>`;
}
// the cards that lead to a section get that section's icon, in the colour of its LED on the rack:
// green for the paid services, blue for the tools, amber for the streaming server
const CARD_ICON = {
    '#wordpress': ['lu:globe', 'g'], '#it-support': ['lu:headset', 'g'], '#automations': ['lu:workflow', 'g'], '#jellyfin': ['lu:video', 'a'],
    '#respond': ['lu:list-checks', 'b'], '#nzquiz': ['lu:route', 'b'], '#atem': ['lu:video', 'b'], '#dashboards': ['lu:chart-column', 'b'],
    '#heartbeats': ['lu:activity', 'b'], '#magento': ['si:magento', 'b'],
};
const GLANCE_ICON = { Focus: 'lu:layers', Clients: 'lu:map-pin', Contact: 'lu:phone' };
const MODULE_ICON = {
    'Product pages': 'lu:layers', Search: 'lu:search', 'Wholesale ordering': 'lu:users', 'Stock and accounting sync': 'lu:arrow-right-left',
    'Multi-store management': 'lu:network', 'Partner rebates': 'lu:heart-handshake', 'Orders and paperwork': 'lu:mail', 'Back office': 'lu:activity',
    'Google and marketing': 'lu:chart-column', 'Security and reliability': 'lu:shield-check',
};
const CHIP_ICON = { Linux: 'si:linux', Proxmox: 'si:proxmox', Docker: 'si:docker', Cloudflare: 'si:cloudflare', WordPress: 'si:wordpress', Go: 'si:go', Python: 'si:python', 'Node.js': 'si:nodedotjs', Claude: 'si:claude' };

function cardIcon(n) {
    const a = find(n, 'a');
    const href = a && attr(a, 'href');
    if (CARD_ICON[href]) return icon(...CARD_ICON[href]);
    return a && /wa\.me/.test(href) ? icon('lu:wrench', 'b') : '';
}

// n tiles in rows of up to four, as even as possible, the fuller rows first
function rows(n, max = 4) {
    const out = [];
    const count = Math.ceil(n / max);
    for (let r = 0; r < count; r++) {
        const k = Math.floor(n / count) + (r < n % count ? 1 : 0);
        for (let j = 0; j < k; j++) out.push(`c${12 / k}`);
    }
    return out;
}

// ---------- decorative tiles ----------
const PULSE = `${pad(I + 4)}<svg class="pulse-line" viewBox="0 0 400 120" preserveAspectRatio="none" aria-hidden="true"><path d="M0 70h120l12-26 16 52 20-92 18 106 14-58 12 18h188"/></svg>
${pad(I + 4)}<ul class="pulse-leds" aria-hidden="true"><li></li><li></li><li></li><li class="quiet"></li></ul>`;
const MODULES = `${pad(I + 4)}${icon('si:magento', 'big')}
${pad(I + 4)}<ul class="bricks" aria-hidden="true">${'<li></li>'.repeat(12)}</ul>`;

// ---------- one recipe per section ----------
// c: take(sel) and takeAll(sel) remove direct children of the section's copy; head() takes the opening lines
function context(sec) {
    const copy = kids(sec).find((n) => is(n, '.copy'));
    if (!copy) throw new Error(`bento: #${attr(sec, 'id')} has no .copy`);
    const parts = kids(copy);
    const used = new Set();
    const take = (sel) => { const n = parts.find((p) => !used.has(p) && is(p, sel)); if (n) used.add(n); return n || null; };
    const takeAll = (sel) => parts.filter((p) => !used.has(p) && is(p, sel)).map((p) => (used.add(p), p));
    return { take, takeAll, head: () => takeAll('.kicker, h1, h2.title, h3.title, .lede, .where'), left: () => parts.filter((p) => !used.has(p)) };
}
const panelOf = (block) => (block && find(block, '.panel')) || block;

const RECIPES = {
    home(c) {
        const hero = tile([...c.head(), c.take('.actions')], { span: 'c8 r2', cls: 't-hero' });
        const profile = c.take('.profile');
        const me = asTile(find(profile, '.profile-top'), 'c4', 't-me');
        const spans = ['c2 m1', 'c2 m1', 'c4', 'c8'];
        const glance = kids(find(profile, 'dl')).map((row, k) => {
            const dt = find(row, 'dt'), dd = find(row, 'dd');
            const name = text(dt);
            let line = emit(row, I + 8);
            // the toolbox reads as a row of chips, each with its logo
            if (name === 'Toolbox') {
                const chips = text(dd).split(/,\s*/).map((t) => `<li>${CHIP_ICON[t] ? icon(CHIP_ICON[t]) : ''}${t}</li>`).join('');
                line = `${pad(I + 8)}<div>${SRC.slice(dt.start, dt.end)}<dd><ul class="chips">${chips}</ul></dd></div>`;
            }
            const lead = GLANCE_ICON[name] ? `${pad(I + 4)}${icon(GLANCE_ICON[name])}` : '';
            return tile([lead, `${pad(I + 4)}<dl>`, line, `${pad(I + 4)}</dl>`], { span: spans[k] || 'c4', cls: `t-glance g-${name.toLowerCase()}` });
        });
        return [{ layout: 'home', tiles: [hero, me, ...glance] }];
    },

    // three boxes: the bigger sites with the title, then the rest in two halves, the last with "And more"
    portfolio(c) {
        const head = tile(c.head(), { span: 'c4 r2', cls: 't-head' });
        const large = kids(c.take('.sites-2'));
        const small = c.take('.sites-3');
        const more = panelOf(c.take('.block'));
        const cards = [];   // each small site with any comment after it (a card waiting to be published)
        for (const n of small.children) {
            if (n.type === 'el') cards.push([n]);
            else if (n.type === 'comment' && cards.length) cards[cards.length - 1].push(n);
        }
        const half = Math.ceil(cards.length / 2);
        const P2 = cards.slice(0, half), P3 = cards.slice(half);
        // five in the middle box: the third is the big one
        const feature = P2.length === 5;
        const spans2 = feature ? ['c3', 'c3', 'c6 r2', 'c3', 'c3'] : rows(P2.length);
        const spans3 = rows(P3.length + 1);
        const site = ([n, ...notes], span, cls) => [asTile(n, span, cls), ...notes.map((cm) => emit(cm, I))].join('\n');
        return [
            { layout: 'work', tiles: [head, ...large.map((n) => asTile(n, 'c4'))] },
            { id: 'portfolio-2', label: 'Websites I\'ve worked on, continued', layout: 'work', tiles: P2.map((g, k) => site(g, spans2[k], feature && k === 2 ? 't-feature' : '')) },
            { id: 'portfolio-3', label: 'Websites I\'ve worked on, continued', layout: 'work', tiles: [...P3.map((g, k) => site(g, spans3[k])), asTile(more, spans3[P3.length], 't-more')] },
        ];
    },

    services(c) {
        const head = tile(c.head(), { span: 'c4 r2', cls: 't-head' });
        const cards = kids(c.take('.services')).map((n) => asTile(n, 'c4', '', cardIcon(n)));
        return [{ layout: 'services', tiles: [head, ...cards] }];
    },

    wordpress(c) {
        const head = tile(c.head(), { span: 'c8', cls: 't-head' });
        const icons = ['lu:map-pin', 'lu:shield-check', 'lu:phone'];
        const items = kids(c.take('.grid')).map((n, k) => asTile(n, 'c4', '', icons[k] ? icon(icons[k], 'g') : ''));
        const price = asTile(panelOf(c.take('.block')), 'c4', 't-price');
        return [{ layout: 'hosting', tiles: [head, ...items, price] }];
    },

    'it-support'(c) {
        const head = tile([...c.head(), c.take('.actions')], { span: 'c7', cls: 't-head' });
        const [fix, steps] = c.takeAll('.block');
        return [{ layout: 'it', tiles: [head, asTile(fix, 'c5 r2', 't-list'), asTile(steps, 'c7', 't-steps')] }];
    },

    automations(c) {
        const head = tile([...c.head(), c.take('.actions')], { span: 'c6 r2', cls: 't-head' });
        const icons = ['lu:code-xml', 'lu:arrow-right-left'];
        const panels = kids(c.take('.grid')).map((n, k) => asTile(n, 'c3', '', icons[k] ? icon(icons[k], 'g') : ''));
        const self = asTile(c.take('.block'), 'c6', 't-self', icon('lu:database-backup', 'g'));
        return [{ layout: 'auto', tiles: [head, ...panels, self] }];
    },

    how(c) {
        const head = tile([...c.head(), `${pad(I + 4)}<img class="mark" src="logo.svg" alt="" width="120" height="166">`], { span: 'c4 r2', cls: 't-head' });
        const icons = ['lu:heart-handshake', 'lu:map-pin', 'lu:shield-check'];
        const items = kids(c.take('.grid')).map((n, k) => asTile(n, k === 0 ? 'c8' : 'c4', k === 0 ? 't-lead' : '', icons[k] ? icon(icons[k]) : ''));
        return [{ layout: 'how', tiles: [head, ...items] }];
    },

    // the tools list is open-ended: four beside the title, then full rows of three below
    tools(c) {
        const head = tile(c.head(), { span: 'c4 r2', cls: 't-head' });
        const cards = kids(c.take('.services'));
        const spans = [...cards.slice(0, 4).map(() => 'c4'), ...rows(Math.max(0, cards.length - 4), 3)];
        return [{ layout: 'tools', tiles: [head, ...cards.map((n, k) => asTile(n, spans[k], '', cardIcon(n)))] }];
    },

    respond(c) {
        const kicker = c.take('.kicker');
        const [words, phone] = kids(c.take('.app-layout'));
        const head = tile([kicker, ...kids(words)], { span: 'c5', cls: 't-head' });
        const shot = tile([phone], { span: 'c3 r2', cls: 't-phone' });
        const items = asTile(c.take('.grid'), 'c4 r2', 't-list');
        const cta = asTile(panelOf(c.take('.block')), 'c5', 't-cta');
        return [{ layout: 'respond', tiles: [head, shot, items, cta] }];
    },

    nzquiz(c) {
        const head = tile(c.head(), { span: 'c6', cls: 't-head' });
        const icons = ['lu:list-checks', 'lu:clock', 'lu:layers', 'lu:laptop'];
        const items = kids(c.take('.grid')).map((n, k) => asTile(n, 'c3 m1', '', icons[k] ? icon(icons[k], 'b') : ''));
        const cta = asTile(panelOf(c.take('.block')), 'c6', 't-cta');
        return [{ layout: 'quiz', tiles: [head, ...items, cta] }];
    },

    atem(c) {
        const head = tile(c.head(), { span: 'c5', cls: 't-head' });
        const shot = asTile(c.take('figure'), 'c7', 't-shot');
        const [map, cta] = c.takeAll('.block');
        return [{ layout: 'atem', tiles: [head, shot, asTile(map, 'c7', 't-map'), asTile(panelOf(cta), 'c5', 't-cta')] }];
    },

    dashboards(c) {
        const head = tile(c.head(), { span: 'c4 r2', cls: 't-head' });
        const shots = c.takeAll('figure').map((n) => asTile(n, 'c4', 't-shot'));
        const items = asTile(c.take('.grid'), 'c4', 't-list');
        const cta = asTile(panelOf(c.take('.block')), 'c4', 't-cta');
        return [{ layout: 'dash', tiles: [head, ...shots, items, cta] }];
    },

    heartbeats(c) {
        const head = tile([...c.head(), c.take('.actions')], { span: 'c7 r2', cls: 't-head' });
        const code = asTile(c.take('.block'), 'c5', 't-code');
        const pulse = tile([PULSE], { span: 'c5', cls: 't-pulse', attrs: ' aria-hidden="true"' });
        return [{ layout: 'beats', tiles: [head, code, pulse] }];
    },

    magento(c) {
        const head = tile(c.head(), { span: 'c7', cls: 't-head' });
        const bricks = tile([MODULES], { span: 'c5 r2', cls: 't-bricks', attrs: ' aria-hidden="true"' });
        const cta = asTile(panelOf(c.take('.block')), 'c7', 't-cta');
        // what the modules cover: a box of six cards, then a box of the rest
        const areas = kids(c.take('.grid'));
        const cards = (group) => {
            const spans = rows(group.length, 3);
            return group.map((n, k) => asTile(n, spans[k], '', icon(MODULE_ICON[text(find(n, 'h4'))] || 'lu:wrench', 'b')));
        };
        return [
            { layout: 'magento', tiles: [head, bricks, cta] },
            { id: 'magento-2', label: 'What the Magento 2 modules cover', layout: 'modules', tiles: cards(areas.slice(0, 6)) },
            { id: 'magento-3', label: 'What the Magento 2 modules cover, continued', layout: 'modules', tiles: cards(areas.slice(6)) },
        ];
    },

    jellyfin(c) {
        const head = tile([...c.head(), c.take('.actions')], { span: 'c7 r2', cls: 't-head t-cinema' });
        const stages = c.takeAll('.stage').map((n) => asTile(n, 'c5'));
        return [{ layout: 'jellyfin', tiles: [head, ...stages] }];
    },

    // the steps stay one list; each step is a tile, laid on the box's own grid
    'tv-setup'(c) {
        const head = tile([...c.head(), c.take('.actions')], { span: 'c6 r2', cls: 't-head' });
        const ol = c.take('ol.steps');
        const steps = `${pad(I)}${withClass(ol, 'sub c6 r2')}\n${kids(ol).map((li) => emit(li, I + 4, withClass(li, 'tile'))).join('\n')}\n${pad(I)}</ol>`;
        return [{ layout: 'tv', tiles: [head, steps] }];
    },

    // the footer: on phones the design switcher joins the end of the .copy tile (designs/switcher.js)
    contact(c) {
        const h2 = c.take('h2');
        const [meta, why] = c.takeAll('.meta');
        const head = tile([h2, meta, c.take('.foot-actions')], { span: 'c8', cls: 't-head' });
        const mark = `${pad(I + 4)}<img class="mark" src="logo.svg" alt="" width="120" height="166">`;
        return [{ layout: 'contact', tiles: [head, tile([mark, why], { span: 'c4', cls: 't-why' }), tile([c.take('.fine')], { span: 'c12', cls: 'copy t-fine' })] }];
    },
};

// anything else: the opening lines, then a tile for each part
function generic(c) {
    return [{ layout: 'generic', tiles: [tile(c.head(), { span: 'c12', cls: 't-head' })] }];
}

function slideMarkup(sec, s, first) {
    let open = openTag(sec).replace(/ class="([^"]*)"/, (_, c) => ` class="${list('bs', /\bsite-foot\b/.test(c) && 'site-foot')}"`);
    if (!first) open = open.replace(/ id="[^"]*"/, ` id="${s.id}"`).replace(/ aria-labelledby="[^"]*"/, ` aria-label="${s.label}"`);
    return [
        `${pad(8)}${open}`,
        `${pad(12)}<div class="slide">`,
        `${pad(16)}<div class="bento b-${s.layout}">`,
        ...s.tiles,
        `${pad(16)}</div>`,
        `${pad(12)}</div>`,
        `${pad(8)}</section>`,
    ].join('\n');
}

export function bentoMain(main) {
    SRC = main;
    const mainEl = find(parse(main), 'main');
    const out = [];
    for (const n of mainEl.children) {
        if (n.type === 'comment') { out.push(`\n${pad(8)}${SRC.slice(n.start, n.end)}`); continue; }
        if (n.type !== 'el') continue;
        const id = attr(n, 'id');
        const c = context(n);
        const slides = (RECIPES[id] || generic)(c);
        const left = c.left();
        if (left.length) {
            console.warn(`bento: #${id} has parts no recipe places; each gets a tile at the end: ${left.map((p) => `<${p.tag} class="${attr(p, 'class') || ''}">`).join(', ')}`);
            slides[slides.length - 1].tiles.push(...left.map((p) => tile([p], { span: 'c12' })));
        }
        out.push(slides.map((s, k) => slideMarkup(n, s, k === 0)).join('\n\n'));
    }
    return `    <main id="main">\n${out.join('\n')}\n\n    </main>\n`;
}
