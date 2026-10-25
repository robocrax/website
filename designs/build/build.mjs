// Builds the other designs' pages from rack.html, which holds the site's copy.
// Every page gets the same <main> and request modal as rack.html; only the edits listed in RULES differ,
// except Bento, which then regroups <main> into bento boxes of tiles (bento.mjs) with the same copy.
// jellyfin.html is not built here: it is its own page, in the Signal design only, edited by hand.
// Edit the copy in rack.html, then run from the repo root: node designs/build/build.mjs [design ...]
// It writes index.html (Signal) and bento.html from the tpl-*.html templates beside it.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bentoMain } from './bento.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
const src = fs.readFileSync(path.join(repo, 'rack.html'), 'utf8').replace(/\r\n/g, '\n');

const cut = (from, to) => {
    const a = src.indexOf(from), b = src.indexOf(to, a);
    if (a < 0 || b < 0) throw new Error(`markers not found: ${from} .. ${to}`);
    return src.slice(a, b);
};
const MAIN = cut('    <main id="main">', '\n\n    <!-- ================= REQUEST ACCESS MODAL') + '\n';
const MODAL = cut('    <!-- ================= REQUEST ACCESS MODAL', '    <script>');
const META = cut('    <meta name="viewport"', '    <link rel="preconnect"')
    .replace(/    <meta name="theme-color"[^\n]*\n/g, '');
const WA = src.match(/<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12\.04[^"]*"\/><\/svg>/)[0];

const RACK_SERVICES = 'Each one lives on its own shelf in the rack; scroll on to see them one at a time.';
const RACK_FINE = 'The rack on this page is a model of the kind of cabinet your site lives in: switch and firewall up top, web and automation servers in the middle, the Jellyfin media server and its drives below, all on a battery backup.';

// [find, replace] pairs, each must match exactly once; { section } limits a pair to one section
const RULES = {
    signal: [
        [RACK_SERVICES, 'Scroll on to see them one at a time.'],
        [RACK_FINE, 'Every shape on this page is drawn by the same cloud of light. Move your pointer through it, drag to turn it, or click beside the text to send a pulse through it.'],
    ],
    bento: [
        [RACK_SERVICES, 'Each one has a box of its own; scroll on to open them one at a time.'],
        [RACK_FINE, 'Every section on this page is one bento box of tiles, in the style of Apple\'s keynote slides: each opens on its main card, which zooms out as the rest slide in around it.'],
    ],
};
// designs whose <main> is regrouped after the rules
const TRANSFORM = { bento: bentoMain };

function sectionBounds(html, id) {
    const a = html.indexOf(`<section id="${id}"`);
    if (a < 0) throw new Error(`section ${id} not found`);
    const b = html.indexOf('</section>', a);
    return [a, b];
}

function applyRules(html, rules, design) {
    for (const r of rules) {
        const [find, replace, section] = Array.isArray(r) ? [r[0], r[1], null] : [r.find, r.replace, r.section];
        let [a, b] = section ? sectionBounds(html, section) : [0, html.length];
        const scope = html.slice(a, b);
        const count = scope.split(find).length - 1;
        if (count !== 1) throw new Error(`[${design}] expected 1 match, found ${count}: ${find.slice(0, 60)}${section ? ` in #${section}` : ''}`);
        html = html.slice(0, a) + scope.replace(find, () => replace) + html.slice(b);
    }
    return html;
}

// Signal is the default landing page
const OUT = { signal: 'index.html' };

const only = process.argv.slice(2);
for (const design of Object.keys(RULES)) {
    if (only.length && !only.includes(design)) continue;
    const tplPath = path.join(here, `tpl-${design}.html`);
    if (!fs.existsSync(tplPath)) { console.log(`skip ${design} (no template)`); continue; }
    const tpl = fs.readFileSync(tplPath, 'utf8').replace(/\r\n/g, '\n');
    let main = applyRules(MAIN, RULES[design], design);
    if (TRANSFORM[design]) main = TRANSFORM[design](main);
    // a template may splice extra markup into a section: <!--@INTO:id:position-->...<!--@END-->
    const extras = [...tpl.matchAll(/<!--@INTO:([\w-]+):(start|end)-->\n?([\s\S]*?)<!--@END-->\n?/g)];
    for (const [, id, where, markup] of extras) {
        const [a, b] = sectionBounds(main, id);
        if (where === 'end') main = main.slice(0, b) + markup.replace(/\s+$/, '\n') + '        ' + main.slice(b);
        else { const open = main.indexOf('>', a) + 1; main = main.slice(0, open) + '\n' + markup.replace(/\s+$/, '') + main.slice(open); }
    }
    let out = tpl.replace(/<!--@INTO:[\s\S]*?<!--@END-->\n?/g, '').replaceAll('<!--@WA-->', WA);
    for (const [key, val] of [['META', META], ['MAIN', main], ['MODAL', MODAL]]) {
        if (!out.includes(`<!--@${key}-->`)) throw new Error(`[${design}] template is missing <!--@${key}-->`);
        out = out.replace(`<!--@${key}-->`, () => val.replace(/\s+$/, ''));
    }
    const file = OUT[design] || `${design}.html`;
    fs.writeFileSync(path.join(repo, file), out);
    console.log(`wrote ${file} (${out.length} bytes)`);
}
