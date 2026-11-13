// Budgets for the build, run after `pnpm build` (optional arg: another outDir):
// - gzip size of the initial entry + preloaded JS referenced by index.html;
// - gzip size of all built JS chunks combined;
// - raw bytes of the self-hosted woff2 fonts, which are all fetched on first load.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const INITIAL_KB = 150;
const TOTAL_KB = 360;
const CHUNK_KB = 150;
const FONT_KB = 120;
const dist = process.argv[2] ?? new URL("../dist/", import.meta.url).pathname;
const dir = join(dist, "assets");

const chunks = readdirSync(dir)
	.filter((f) => f.endsWith(".js"))
	.map((f) => ({ f, kb: gzipSync(readFileSync(join(dir, f))).length / 1024 }))
	.sort((a, b) => b.kb - a.kb);
const chunkByName = new Map(chunks.map((c) => [c.f, c.kb]));
const total = chunks.reduce((sum, c) => sum + c.kb, 0);
const over = chunks.filter((c) => c.kb > CHUNK_KB);

const indexHtmlPath = join(dist, "index.html");
let initialKb = null;
if (existsSync(indexHtmlPath)) {
	const html = readFileSync(indexHtmlPath, "utf-8");
	const entryFiles = new Set();
	for (const match of html.matchAll(/<script\b[^>]*\bsrc=["']\/?assets\/([^"']+\.js)["'][^>]*>/gi)) {
		entryFiles.add(match[1]);
	}
	for (const match of html.matchAll(/<link\b[^>]*\brel=["']modulepreload["'][^>]*\bhref=["']\/?assets\/([^"']+\.js)["'][^>]*>/gi)) {
		entryFiles.add(match[1]);
	}
	for (const match of html.matchAll(/<link\b[^>]*\bhref=["']\/?assets\/([^"']+\.js)["'][^>]*\brel=["']modulepreload["'][^>]*>/gi)) {
		entryFiles.add(match[1]);
	}
	initialKb = [...entryFiles].reduce((sum, f) => sum + (chunkByName.get(f) ?? 0), 0);
}

const fontDir = join(dist, "fonts");
const fonts = existsSync(fontDir)
	? readdirSync(fontDir)
			.filter((f) => f.endsWith(".woff2"))
			.map((f) => ({ f, kb: statSync(join(fontDir, f)).size / 1024 }))
	: [];
const fontTotal = fonts.reduce((sum, c) => sum + c.kb, 0);

for (const c of chunks.slice(0, 5)) console.log(`${c.kb.toFixed(1).padStart(7)} KB  ${c.f}`);
if (initialKb !== null) {
	console.log(`${initialKb.toFixed(1).padStart(7)} KB  initial (budget ${INITIAL_KB})`);
}
console.log(`${total.toFixed(1).padStart(7)} KB  total (budget ${TOTAL_KB}, per chunk ${CHUNK_KB})`);
for (const c of fonts) console.log(`${c.kb.toFixed(1).padStart(7)} KB  fonts/${c.f}`);
console.log(`${fontTotal.toFixed(1).padStart(7)} KB  fonts (budget ${FONT_KB})`);

const initialOver = initialKb !== null && initialKb > INITIAL_KB;
if (initialOver || total > TOTAL_KB || over.length > 0 || fontTotal > FONT_KB) {
	for (const c of over) console.error(`over budget: ${c.f} ${c.kb.toFixed(1)} KB`);
	if (initialOver) console.error(`over budget: initial ${initialKb.toFixed(1)} KB`);
	if (total > TOTAL_KB) console.error(`over budget: total ${total.toFixed(1)} KB`);
	if (fontTotal > FONT_KB) console.error(`over budget: fonts ${fontTotal.toFixed(1)} KB`);
	process.exit(1);
}
