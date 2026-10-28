import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, stat, symlink, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { writeDebArchive, writeDebUpdateInfo } from '../scripts/package-deb.mjs';
const { normalizeLinuxPermissions } = createRequire(import.meta.url)('../scripts/after-pack.cjs');

test('Linux permissions preserve execution without world writes or following symlinks', { skip: process.platform === 'win32' }, async t => {
  const temporary = await mkdtemp(join(tmpdir(), 'apdf-permissions-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const root = join(temporary, 'app'); await mkdir(root);
  const executable = join(root, 'apdf'), resource = join(root, 'data.pak'), outside = join(temporary, 'outside');
  await writeFile(executable, 'binary', { mode: 0o777 });
  await writeFile(resource, 'resource', { mode: 0o666 });
  await writeFile(outside, 'untouched', { mode: 0o777 });
  await chmod(executable, 0o777); await chmod(resource, 0o666); await chmod(outside, 0o777);
  const outsideMode = (await stat(outside)).mode & 0o777;
  await symlink(outside, join(root, 'link'));
  await normalizeLinuxPermissions(root);
  assert.equal((await stat(executable)).mode & 0o777, 0o755);
  assert.equal((await stat(resource)).mode & 0o777, 0o644);
  assert.equal((await stat(outside)).mode & 0o777, outsideMode);
});

test('Debian ar container is readable by the system ar tool, including odd-sized members', { skip: process.platform === 'win32' }, async t => {
  const temporary = await mkdtemp(join(tmpdir(), 'apdf-deb-test-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const members = ['debian-binary', 'control.tar.gz', 'data.tar.gz'];
  const contents = [Buffer.from('2.0\n'), Buffer.from('12345'), Buffer.from('1234567')];
  for (let i = 0; i < members.length; i++) await writeFile(join(temporary, members[i]), contents[i]);
  const output = join(temporary, 'test.deb');
  await writeDebArchive(output, members.map(name => join(temporary, name)));
  assert.equal((await readFile(output)).subarray(0, 8).toString(), '!<arch>\n');
  for (let i = 0; i < members.length; i++) {
    const extracted = spawnSync('ar', ['-p', output, members[i]]);
    assert.equal(extracted.status, 0, extracted.stderr.toString());
    assert.deepEqual(extracted.stdout, contents[i]);
  }
});


test('Debian update feeds select one architecture and hash the exact installer bytes', async t => {
  const temporary = await mkdtemp(join(tmpdir(), 'apdf-update-feed-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  for (const [arch, suffix] of [['x64', ''], ['arm64', '-arm64']]) {
    const output = join(temporary, `aPDF-Linux-${arch}.deb`), bytes = Buffer.from(`Debian installer ${arch}`);
    await writeFile(output, bytes);
    const manifest = await writeDebUpdateInfo(output, arch, { version: '0.2.0' });
    assert.equal(manifest, join(temporary, `latest-linux${suffix}.yml`));
    const info = JSON.parse(await readFile(manifest, 'utf8'));
    assert.equal(info.version, '0.2.0');
    assert.equal(info.files.length, 1);
    assert.deepEqual(info.files[0], { url: `aPDF-Linux-${arch}.deb`, sha512: createHash('sha512').update(bytes).digest('base64'), size: bytes.length });
  }
});
