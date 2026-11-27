// 打包：把 src/ 打成一个内联模块，three.js 走 CDN，输出可直接发布的单页 dist/index.html
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const THREE_CDN = 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js';

const result = await build({
  entryPoints: [join(root, 'src/main.js')],
  bundle: true, format: 'esm', external: ['three'], minify: true, write: false, target: 'es2020',
  legalComments: 'none',
});
const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');

const html = readFileSync(join(root, 'index.html'), 'utf8');
const head = html.match(/<head>([\s\S]*?)<\/head>/)[1]
  .replace(/<meta charset[^>]*>\s*/, '')
  .replace(/<meta name="viewport"[^>]*>\s*/, '')
  .trim();
const body = html.match(/<body>([\s\S]*?)<\/body>/)[1]
  .replace(/<script type="importmap">[\s\S]*?<\/script>/, `<script type="importmap">{ "imports": { "three": "${THREE_CDN}" } }</script>`)
  .replace(/<script type="module" src="[^"]*"><\/script>/, () => `<script type="module">\n${js}</script>`)
  .trim();

mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist/index.html'), `${head}\n${body}\n`);
console.log(`dist/index.html  ${(Buffer.byteLength(head + body) / 1024).toFixed(1)} KB`);
