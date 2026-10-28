// Minimal Debian packages, without inventing a maintainer email or homepage.
// electron-builder prepares the platform app; GNU tar + the standard ar format
// produce the Debian archive using the project's existing metadata.
import { readFile, writeFile, mkdir, mkdtemp, cp, chmod, symlink, stat, lstat, readdir, open, rm } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, join, basename, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

export async function writeDebArchive(output, members) {
  const file = await open(output, 'w', 0o644);
  async function writeAll(buffer) {
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesWritten } = await file.write(buffer, offset, buffer.length - offset, null);
      if (!bytesWritten) throw new Error('Unable to write Debian package.');
      offset += bytesWritten;
    }
  }
  try {
    await writeAll(Buffer.from('!<arch>\n'));
    for (const member of members) {
      const name = basename(member), size = (await stat(member)).size;
      if (name.length > 15 || size > 9999999999) throw new Error('Unsupported ar member.');
      const header = name.padEnd(16) + '0'.padEnd(12) + '0'.padEnd(6) + '0'.padEnd(6) + '100644'.padEnd(8) + String(size).padEnd(10) + '`\n';
      await writeAll(Buffer.from(header));
      for await (const chunk of createReadStream(member)) await writeAll(chunk);
      if (size % 2) await writeAll(Buffer.from('\n'));
    }
  } finally { await file.close(); }
}
export async function writeDebUpdateInfo(output, arch, metadata) {
  const hash = createHash('sha512');
  for await (const chunk of createReadStream(output)) hash.update(chunk);
  const filename = basename(output), sha512 = hash.digest('base64');
  const info = { version: metadata.version, files: [{ url: filename, sha512, size: (await stat(output)).size }], path: filename, sha512, releaseDate: new Date().toISOString() };
  const manifest = join(dirname(output), `latest-linux${arch === 'x64' ? '' : '-' + arch}.yml`);
  // JSON is also valid YAML; no new packaging dependency is needed.
  await writeFile(manifest, JSON.stringify(info, null, 2) + '\n');
  return manifest;
}
async function bytesIn(directory) {
  let size = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) size += await bytesIn(file);
    else size += (await lstat(file)).size;
  }
  return size;
}
async function execute(command, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`)));
  });
}
export async function packageDeb(arch, metadata, tar) {
  const debArch = { x64: 'amd64', arm64: 'arm64' }[arch];
  if (!debArch) throw new Error('Expected x64 or arm64.');
  const name = metadata.name;
  const product = metadata.build.productName;
  const executable = metadata.build.linux.executableName;
  if (![name, product, executable].every(value => /^[\w.-]+$/.test(value))) throw new Error('Invalid package path.');
  const unpacked = resolve('release', arch === 'x64' ? 'linux-unpacked' : 'linux-arm64-unpacked');
  const binary = await open(join(unpacked, executable), 'r');
  const elf = Buffer.alloc(20);
  try { await binary.read(elf, 0, 20, 0); } finally { await binary.close(); }
  if (elf.subarray(0, 4).toString() !== '\x7fELF' || elf.readUInt16LE(18) !== (arch === 'x64' ? 62 : 183)) throw new Error('Linux app architecture does not match the package.');
  const temporary = await mkdtemp(resolve('release', '.deb-stage-'));
  try {
    const root = join(temporary, 'data'), control = join(temporary, 'control');
    const app = join(root, 'opt', product);
    await cp(unpacked, app, { recursive: true, verbatimSymlinks: true });
    await writeFile(join(app, 'resources/package-type'), 'deb\n');
    await writeFile(join(app, 'resources/app-update.yml'), JSON.stringify({ ...metadata.build.publish, updaterCacheDirName: `${name}-updater` }, null, 2) + '\n');
    const { normalizeLinuxPermissions } = createRequire(import.meta.url)('./after-pack.cjs');
    await normalizeLinuxPermissions(root);
    await chmod(join(app, 'chrome-sandbox'), 0o4755);
    await mkdir(join(root, 'usr/bin'), { recursive: true });
    await symlink(`/opt/${product}/${executable}`, join(root, 'usr/bin', executable));
    await mkdir(join(root, 'usr/share/applications'), { recursive: true });
    await writeFile(join(root, 'usr/share/applications', `${name}.desktop`), `[Desktop Entry]\nName=${product}\nComment=${metadata.description}\nExec=/opt/${product}/${executable} %U\nTerminal=false\nType=Application\nIcon=${name}\nCategories=Office;Viewer;\nMimeType=application/pdf;\nStartupWMClass=${name}\n`);
    await mkdir(join(root, 'usr/share/pixmaps'), { recursive: true });
    await cp('build/icon.png', join(root, 'usr/share/pixmaps', `${name}.png`));
    await mkdir(join(root, 'usr/share/doc', name), { recursive: true });
    await cp('LICENSE', join(root, 'usr/share/doc', name, 'copyright'));
    for (const file of ['COPYING', 'NOTICE']) await cp(file, join(root, 'usr/share/doc', name, file));
    await mkdir(control, { recursive: true });
    const maintainer = typeof metadata.author === 'string' ? metadata.author : metadata.author.name;
    const depends = ['libc6', 'libgtk-3-0 | libgtk-3-0t64', 'libnotify4', 'libnss3', 'libxss1', 'libxtst6', 'xdg-utils', 'libatspi2.0-0 | libatspi2.0-0t64', 'libuuid1', 'libsecret-1-0', 'libgbm1', 'libdrm2', 'libxkbcommon0', 'libasound2 | libasound2t64'];
    await writeFile(join(control, 'control'), `Package: ${name}\nVersion: ${metadata.version}\nSection: graphics\nPriority: optional\nArchitecture: ${debArch}\nMaintainer: ${maintainer}\nInstalled-Size: ${Math.ceil(await bytesIn(root) / 1024)}\nDepends: ${depends.join(', ')}\nDescription: ${metadata.description}\n`);
    // Debian installs these archive members as root; preserve Chromium's normal
    // setuid sandbox rather than adding a --no-sandbox flag to the app launcher.
    await writeFile(join(control, 'postinst'), `#!/bin/sh\nset -e\nif [ "$1" = configure ]; then\n  chmod 4755 '/opt/${product}/chrome-sandbox'\n  if command -v update-desktop-database >/dev/null 2>&1; then update-desktop-database -q /usr/share/applications || true; fi\nfi\nexit 0\n`, { mode: 0o755 });
    await writeFile(join(control, 'postrm'), '#!/bin/sh\nset -e\nif command -v update-desktop-database >/dev/null 2>&1; then update-desktop-database -q /usr/share/applications || true; fi\nexit 0\n', { mode: 0o755 });
    const tarOptions = ['--format=gnu', '--owner=0', '--group=0', '--numeric-owner', '--sort=name', '--mtime=@0'];
    const controlTar = join(temporary, 'control.tar.gz'), dataTar = join(temporary, 'data.tar.gz');
    await execute(tar, [...tarOptions, '-czf', controlTar, '-C', control, '.']);
    await execute(tar, [...tarOptions, '-czf', dataTar, '-C', root, '.']);
    const version = join(temporary, 'debian-binary'); await writeFile(version, '2.0\n');
    const output = resolve('release', `${product}-${metadata.version}-Linux-${debArch}.deb`);
    await writeDebArchive(output, [version, controlTar, dataTar]);
    await writeDebUpdateInfo(output, arch, metadata);
    console.log(`Built ${output}`);
    return output;
  } finally { await rm(temporary, { recursive: true, force: true }); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const metadata = JSON.parse(await readFile('package.json', 'utf8'));
  let tar = 'tar';
  if (process.platform === 'darwin') {
    const { getLinuxToolsMacToolset } = createRequire(import.meta.url)('app-builder-lib/out/toolsets/linux');
    tar = (await getLinuxToolsMacToolset()).gtar;
  }
  for (const arch of process.argv.slice(2).length ? process.argv.slice(2) : ['x64', 'arm64']) await packageDeb(arch, metadata, tar);
}
