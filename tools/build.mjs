#!/usr/bin/env node
/**
 * 配布用の単一ファイルを生成する。
 *
 *   node tools/build.mjs
 *   → dist/index.html （CSS / JS / 天文データ / 月面画像をすべて内包）
 *
 * dist/index.html はそのまま GitHub Pages などに
 * 置くだけで動く（ローカルファイルとして開いても動く）。
 */
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT_DIR = join(ROOT, 'dist');

const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const html = read('index.html');
const css = read('styles.css');
const app = read('app.js');
const data = read('data/2027.js');
const moon = readFileSync(join(ROOT, 'assets', 'moon.jpg'));

const moonUri = `data:image/jpeg;base64,${moon.toString('base64')}`;

// 元のマークアップから外部参照を外し、インライン化する
let out = html
  .replace(/\s*<link rel="preconnect"[^>]*>\s*/g, '\n')
  .replace(/\s*<link href="https:\/\/fonts\.googleapis\.com[^>]*>\s*/g, '\n')
  .replace(/\s*<link rel="stylesheet" href="styles\.css"\s*\/?>\s*/g, '\n<style>\n' + minifyCss(css) + '\n</style>\n')
  .replace(/\s*<script src="data\/2027\.js" defer><\/script>\s*/g, '\n<script>' + data.trim() + '</script>\n')
  .replace(/\s*<script src="app\.js" defer><\/script>\s*/g, '\n<script>' + app + '</script>\n');

// JS 内の画像参照を data URI に置き換え
out = out.replace(/assets\/moon\.jpg/g, moonUri);

if (/<link[^>]+href="styles\.css"/.test(out) || /<script[^>]+src=/.test(out)) {
  console.error('外部参照が残っています。index.html の構造を確認してください。');
  process.exit(1);
}

mkdirSync(OUT_DIR, { recursive: true });
const target = join(OUT_DIR, 'index.html');
writeFileSync(target, out, 'utf8');

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
console.log(`書き出しました: ${target}`);
console.log(`  ${kb(statSync(target).size)}（gzip 前 / 画像・データ込みの単一ファイル）`);

/** CSS の軽い圧縮（コメントと余分な空白のみ） */
function minifyCss(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .replace(/\s*([{}:;,])\s*/g, '$1')
    .replace(/;}/g, '}')
    .trim();
}
