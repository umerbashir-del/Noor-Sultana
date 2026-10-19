import { createHash } from 'node:crypto';
import { cp, lstat, mkdir, readFile, rm } from 'node:fs/promises';
import { dirname, posix, resolve } from 'node:path';

// Copy only the reviewed application runtime. Missing/drifted assets fail the
// build instead of silently deploying a static character again.
export async function packageAvatar(source, destination) {
  const manifestBytes = await readFile(resolve(source, 'manifest.json'));
  const manifest = JSON.parse(manifestBytes);
  if (manifest.version !== 'noor-v6' || manifest.renderAdapter !== null || !Array.isArray(manifest.files) || !manifest.files.length) {
    throw new Error('Missing verified Noor runtime manifest');
  }
  const names = new Set(manifest.files);
  if (names.size !== manifest.files.length) throw new Error('Duplicate avatar asset');
  for (const name of names) {
    if (typeof name !== 'string' || !/^(?:core|framework|shaders|models\/noor-v6|licenses)\/[a-zA-Z0-9_./-]+$/.test(name) || name.split('/').some(part => !part || part === '.' || part === '..') || !/\.(?:js|frag|vert|moc3|png|json|md|txt)$/.test(name)) {
      throw new Error('Invalid bundled avatar path');
    }
    // Reject symlinks in every component, not only the final file.
    let path = source;
    for (const part of name.split('/')) {
      path = resolve(path, part);
      if ((await lstat(path)).isSymbolicLink()) throw new Error(`Avatar symlink: ${name}`);
    }
    const bytes = await readFile(path);
    const actual = createHash('sha256').update(bytes).digest('hex');
    if (manifest.sha256?.[name] !== actual) throw new Error(`Avatar integrity mismatch: ${name}`);
    if (name.startsWith('framework/')) {
      for (const [, dependency] of bytes.toString('utf8').matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)) {
        if (!dependency.startsWith('.') || !names.has(posix.normalize(`${posix.dirname(name)}/${dependency}`))) {
          throw new Error(`Missing avatar module dependency: ${name} -> ${dependency}`);
        }
      }
    }
  }
  for (const required of ['core/live2dcubismcore.min.js', 'licenses/Core-LICENSE.md', 'licenses/Framework-LICENSE.md', 'licenses/Core-RedistributableFiles.txt', 'licenses/DISTRIBUTION-NOTICE.md', manifest.model]) {
    if (!names.has(required)) throw new Error(`Missing avatar dependency: ${required}`);
  }
  const setting = JSON.parse(await readFile(resolve(source, manifest.model), 'utf8'));
  const modelDirectory = dirname(manifest.model);
  for (const name of [setting.FileReferences?.Moc, ...setting.FileReferences?.Textures ?? [], setting.FileReferences?.DisplayInfo]) {
    if (typeof name !== 'string' || name.includes('..') || !names.has(`${modelDirectory}/${name}`)) throw new Error('Incomplete avatar model');
  }
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });
  for (const name of ['manifest.json', ...names]) {
    await mkdir(dirname(resolve(destination, name)), { recursive: true });
    await cp(resolve(source, name), resolve(destination, name));
  }
  return manifest;
}
