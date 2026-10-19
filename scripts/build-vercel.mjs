import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const output = resolve(root, 'public');
await mkdir(output, { recursive: true });
for (const file of ['app.js', 'styles.css', 'crew-dashboard.html', 'crew-dashboard.css', 'crew-dashboard.js', 'home.css', 'home.js', 'home-data.mjs']) {
  await cp(resolve(root, 'prototype', file), resolve(output, file));
}
await cp(resolve(root, 'prototype/assets'), resolve(output, 'assets'), { recursive: true });
await cp(resolve(root, 'Documents/knowledge'), resolve(output, 'knowledge'), { recursive: true });
let html = await readFile(resolve(root, 'prototype/index.html'), 'utf8');
html = html.replace('<html lang="en">', '<html lang="en" data-vercel-preview="true">');
html = html.replace('<p class="demo-note">', '<p class="demo-note">You can review microphone transcripts before sending. Browser speech recognition may use your browser provider. Chatterbox playback is available when connected. Email scheduling is unavailable here.</p>\n          <p class="demo-note">');
await writeFile(resolve(output, 'flight-demo.html'), html);
await cp(resolve(root, 'prototype', 'home.html'), resolve(output, 'index.html'));
