import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packageAvatar } from './package-avatar.mjs';

const runtime = fileURLToPath(new URL('../prototype/live2d/noor-v6/', import.meta.url));
async function fixture(run, bundle = runtime) {
  const temp = await mkdtemp(join(tmpdir(), 'noor-bundle-'));
  try {
    const source = join(temp, 'source'), output = join(temp, 'output');
    await cp(bundle, source, { recursive: true });
    await run({ source, output });
  } finally { await rm(temp, { recursive: true, force: true }); }
}

const approvedRuntime = fileURLToPath(new URL('../prototype/live2d/noor-v7/', import.meta.url));
test('approved V7 bundle pins the exact model and includes required native physics', async () => fixture(async ({ source, output }) => {
  const manifest = await packageAvatar(source, output);
  assert.equal(manifest.version, 'noor-v7');
  assert.equal(manifest.nativePose.mocSHA256, '821bfcb1fa35cb50675c2d33423904c0ecd10c5ff7dea2214f14a258e87d708d');
  assert.equal(manifest.sha256[manifest.physics.file], '667912216f2096ab1fe937d811b2cd02fedf3ee8c19566c1fddd04cf067ae940');
  await readFile(join(output, manifest.physics.file));
  manifest.files = manifest.files.filter(name => name !== manifest.physics.file);
  await writeFile(join(source, 'manifest.json'), JSON.stringify(manifest));
  await assert.rejects(packageAvatar(source, output), /Incomplete avatar model/);
}, approvedRuntime));

test('bundled V6 assets, model references and module imports are complete and pinned', async () => fixture(async ({ source, output }) => {
  await writeFile(join(source, 'private.env'), 'must not ship');
  const manifest = await packageAvatar(source, output);
  assert.equal(manifest.version, 'noor-v6');
  assert.equal(manifest.nativePose.mocSHA256, manifest.sha256['models/noor-v6/noor-talk-v6.moc3']);
  assert.equal(manifest.mouthRigVerified, true);
  await assert.rejects(readFile(join(output, 'private.env')), { code: 'ENOENT' });
  const names = new Set(manifest.files);
  for (const name of names) {
    assert.equal(Buffer.compare(await readFile(join(source, name)), await readFile(join(output, name))), 0, name);
    assert.doesNotMatch(name, /\.cmo3$|\.psd$|\.zip$|models\/noor-v[45]\//);
    if (!name.startsWith('framework/')) continue;
    const module = await readFile(join(output, name), 'utf8');
    for (const [, dependency] of module.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)) {
      assert.equal(names.has(posix.normalize(`${posix.dirname(name)}/${dependency}`)), true, `${name} imports ${dependency}`);
    }
  }
  assert.equal((await readdir(output)).includes('licenses'), true);
}));

test('build rejects drift and missing assets instead of shipping a silent fallback', async () => fixture(async ({ source, output }) => {
  await writeFile(join(source, 'models/noor-v6/noor-talk-v6.moc3'), 'invalid');
  await assert.rejects(packageAvatar(source, output), /integrity mismatch/);
  await rm(join(source, 'models/noor-v6/noor-talk-v6.moc3'));
  await assert.rejects(packageAvatar(source, output), { code: 'ENOENT' });
}));

test('build rejects a manifest that omits an imported framework module', async () => fixture(async ({ source, output }) => {
  const path = join(source, 'manifest.json');
  const manifest = JSON.parse(await readFile(path));
  manifest.files = manifest.files.filter(name => name !== 'framework/effect/cubismbreath.js');
  await writeFile(path, JSON.stringify(manifest));
  await assert.rejects(packageAvatar(source, output), /Missing avatar module dependency/);
}));

test('bundle paths cannot traverse directories or follow symlinks', async () => fixture(async ({ source, output }) => {
  const path = join(source, 'manifest.json');
  const manifest = JSON.parse(await readFile(path));
  manifest.files.push('licenses/../../private.env');
  await writeFile(path, JSON.stringify(manifest));
  await assert.rejects(packageAvatar(source, output), /Invalid bundled avatar path/);
  manifest.files.pop();
  await writeFile(path, JSON.stringify(manifest));
  const core = join(source, 'core/live2dcubismcore.min.js');
  await rm(core);
  await symlink(join(runtime, 'core/live2dcubismcore.min.js'), core);
  await assert.rejects(packageAvatar(source, output), /Avatar symlink/);
}));
