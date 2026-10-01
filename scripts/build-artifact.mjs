// Bundles the Vite build (dist/) into one self-contained HTML file that can be
// hosted anywhere, including as a claude.ai Artifact. Run after `vite build`.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const dist = 'dist';
const html = readFileSync(join(dist, 'index.html'), 'utf8');

const css = [...html.matchAll(/<link rel="stylesheet"[^>]*href="\.?\/?([^"]+)"[^>]*>/g)].map((m) => readFileSync(join(dist, m[1]), 'utf8'));
const js = [...html.matchAll(/<script type="module"[^>]*src="\.?\/?([^"]+)"[^>]*><\/script>/g)].map((m) => readFileSync(join(dist, m[1]), 'utf8'));
const title = html.match(/<title>[\s\S]*?<\/title>/)?.[0] ?? '<title>Fireflow</title>';
const body = html
  .match(/<body>([\s\S]*)<\/body>/)[1]
  .replace(/<script type="module"[^>]*><\/script>/g, '')
  .trim();

const safeJs = js.join('\n').replaceAll('</script', '<\\/script');
const out = `${title}
<style>
${css.join('\n')}
</style>
${body}
<script type="module">
${safeJs}
</script>
`;

mkdirSync('artifact', { recursive: true });
writeFileSync('artifact/fireflow.html', out);
console.log(`artifact/fireflow.html — ${(out.length / 1024).toFixed(1)} KB`);
