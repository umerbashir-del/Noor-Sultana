import { cp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { packageAvatar } from './package-avatar.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const output = resolve(root, 'public');
// public/ is generated output. Do not retain stale bundles from a prior build.
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const file of ['design-tokens.css', 'ui-controls.js', 'app.js', 'avatar.js', 'avatar-pose.mjs', 'avatar-motion.mjs', 'speech-mouth.js', 'styles.css', 'crew-dashboard.html', 'crew-dashboard.css', 'crew-dashboard.js', 'home.css', 'home.js', 'home-data.mjs', 'journeys.mjs']) {
  await cp(resolve(root, 'prototype', file), resolve(output, file));
}
await packageAvatar(resolve(root, 'prototype/live2d/noor-v7'), resolve(output, 'live2d/noor-v7'));
// Editable rigs, the SDK workbench and historical local exports stay excluded.
await cp(resolve(root, 'prototype/assets'), resolve(output, 'assets'), { recursive: true });
await cp(resolve(root, 'Documents/knowledge'), resolve(output, 'knowledge'), { recursive: true });
let html = await readFile(resolve(root, 'prototype/index.html'), 'utf8');
html = html.replace('<html lang="en">', '<html lang="en" data-vercel-preview="true">');
await writeFile(resolve(output, 'flight-demo.html'), html);
await cp(resolve(root, 'prototype', 'home.html'), resolve(output, 'index.html'));
