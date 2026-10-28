// Real Electron Updater HTTP download and checksum verification. Installers are
// synthetic bytes and quitAndInstall is intercepted; nothing is executed.
import { _electron as electron } from 'playwright';
import { expect } from '@playwright/test';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const data = await mkdtemp(join(tmpdir(), 'apdf-updater-test-'));
const installer = Buffer.alloc(256 * 1024, 'aPDF update test');
let corrupt = false, downloads = 0;
const server = createServer((request, response) => {
  if (request.url.split('?')[0].endsWith('.yml')) {
    response.setHeader('Content-Type', 'text/yaml');
    response.end(JSON.stringify({ version: '99.0.0', files: [{ url: 'test-setup.exe', sha512: createHash('sha512').update(installer).digest('base64'), size: installer.length }], releaseDate: new Date().toISOString() }));
  } else if (request.url === '/test-setup.exe') {
    downloads++;
    response.setHeader('Content-Length', installer.length);
    response.end(corrupt ? Buffer.alloc(installer.length, 'wrong') : installer);
  } else { response.statusCode = 404; response.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let app;
try {
  const args = process.env.CI && process.platform === 'linux' ? ['--no-sandbox', '.'] : ['.'];
  app = await electron.launch({ args, env: { ...process.env, APDF_TEST_DATA: data } });
  const page = await app.firstWindow();
  await expect(page.getByRole('heading', { name: 'Your library', exact: true })).toBeVisible();
  async function run(cacheName) {
    return app.evaluate(async ({ app, BrowserWindow }, { url, data, cacheName }) => {
      const req = process.getBuiltinModule('node:module').createRequire(joinPath(app.getAppPath(), 'package.json'));
      function joinPath(...parts) { return process.getBuiltinModule('node:path').join(...parts); }
      const fs = process.getBuiltinModule('node:fs/promises');
      const { NsisUpdater } = req('electron-updater');
      const { UpdateController } = req('./electron/update-controller.cjs');
      const config = joinPath(data, `${cacheName}.yml`);
      await fs.writeFile(config, JSON.stringify({ provider: 'generic', url, updaterCacheDirName: cacheName }));
      const updater = new NsisUpdater({ provider: 'generic', url });
      updater.app = { version: app.getVersion(), name: 'apdf-updater-test', isPackaged: true, appUpdateConfigPath: config, userDataPath: data, baseCachePath: data, whenReady: () => app.whenReady() };
      updater.disableDifferentialDownload = true;
      updater.disableWebInstaller = true;
      const messages = [], phases = [], calls = [];
      updater.quitAndInstall = () => calls.push('install');
      const replies = [0, 1];
      const controller = new UpdateController({
        getRelease: async () => ({ status: 'available', latestVersion: '99.0.0', updateFiles: ['test.yml'] }),
        unsupportedReason: async () => '', metadataName: 'test.yml', getUpdater: () => updater,
        show: async options => { messages.push(options); return { response: replies.shift() ?? 1 }; },
        openExternal: async () => { throw new Error('Unexpected manual download'); },
        publish: state => { phases.push(state.phase); BrowserWindow.getAllWindows()[0].webContents.send('app:update-state', state); },
        beforeInstall: async () => calls.push('flush')
      });
      await controller.check();
      return { messages, phases, calls, state: controller.state };
    }, { url: `http://127.0.0.1:${server.address().port}`, data, cacheName });
  }
  const success = await run('verified');
  expect(success.messages.map(m => m.message)).toEqual(['aPDF 99.0.0 is available', 'Update ready to install']);
  expect(success.state.phase).toBe('downloaded');
  expect(success.phases).toContain('downloading');
  expect(success.calls).toEqual([]);
  await expect(page.getByRole('button', { name: 'Restart and install…', exact: true })).toBeVisible();
  corrupt = true;
  const rejected = await run('corrupt');
  expect(rejected.messages.at(-1).type).toBe('error');
  expect(rejected.messages.at(-1).detail).toContain('checksum');
  expect(rejected.state.phase).toBe('idle');
  expect(rejected.calls).toEqual([]);
  expect(downloads).toBe(2);
  console.log('PASS: real Electron Updater HTTP download, verified checksum, ready banner, deferred installation, and corrupted-download rejection. No installer executed.');
} finally {
  if (app) await app.close();
  await new Promise(resolve => server.close(resolve));
  await rm(data, { recursive: true, force: true });
}
