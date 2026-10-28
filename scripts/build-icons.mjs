import { mkdir, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

if (process.platform !== 'darwin') throw new Error('Generate the macOS icon set on macOS. The generated PNG and ICNS are committed for other builds.');
const source = resolve('build/icon-master.png');
const iconset = resolve('build/icon.iconset');
await access(source);
await mkdir(iconset, { recursive: true });
function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr || result.error || result.stdout}`);
}
run('/usr/bin/sips', ['-z', '1024', '1024', source, '--out', resolve('build/icon.png')]);
for (const size of [16, 32, 128, 256, 512]) {
  for (const ratio of [1, 2]) {
    const pixels = size * ratio;
    run('/usr/bin/sips', ['-z', String(pixels), String(pixels), source, '--out', resolve(iconset, `icon_${size}x${size}${ratio === 2 ? '@2x' : ''}.png`)]);
  }
}
run('/usr/bin/iconutil', ['-c', 'icns', iconset, '-o', resolve('build/icon.icns')]);
console.log('Generated build/icon.png and build/icon.icns (16–1024px, including Retina sizes).');
