import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
const { UpdateController } = createRequire(import.meta.url)('../electron/update-controller.cjs');

function fixture(overrides = {}) {
  const calls = [], messages = [], states = [], replies = [];
  const updater = Object.assign(new EventEmitter(), {
    async checkForUpdates() { calls.push('check'); return { isUpdateAvailable: true, updateInfo: { version: '0.2.0' } }; },
    async downloadUpdate() { calls.push('download'); this.emit('download-progress', { percent: 42 }); return ['/verified-update']; },
    quitAndInstall(silent, relaunch) { calls.push(['install', silent, relaunch]); }
  });
  const controller = new UpdateController({
    getRelease: async () => ({ status: 'available', currentVersion: '0.1.0', latestVersion: '0.2.0', updateFiles: ['latest-x64.yml'], releaseUrl: 'https://github.com/xuyao00/apdf/releases/tag/v0.2.0' }),
    getUpdater: () => updater, unsupportedReason: async () => '', metadataName: 'latest-x64.yml',
    show: async options => { messages.push(options); return { response: replies.shift() ?? 1 }; },
    openExternal: async url => { calls.push(url); }, publish: state => { states.push(state); },
    beforeInstall: async () => { calls.push('flush'); }, ...overrides
  });
  return { controller, updater, calls, messages, states, replies };
}
test('declining download never downloads or installs; concurrent checks share one prompt', async () => {
  const f = fixture();
  const first = f.controller.check(), second = f.controller.check();
  assert.equal(first, second);
  await first;
  assert.deepEqual(f.calls, ['check']);
  assert.equal(f.messages.length, 1);
  assert.equal(f.updater.autoDownload, false);
  assert.equal(f.updater.autoInstallOnAppQuit, false);
  assert.equal(f.updater.allowPrerelease, false);
  assert.equal(f.updater.allowDowngrade, false);
});
test('download progress, deferred install and explicit restart confirmation preserve order', async () => {
  const f = fixture(); f.replies.push(0, 1);
  await f.controller.check();
  assert.deepEqual(f.calls, ['check', 'download']);
  assert.equal(f.controller.state.phase, 'downloaded');
  assert.ok(f.states.some(s => s.phase === 'downloading' && s.percent === 42));
  // Re-check prompts to install the cached, verified download, without a new download.
  f.replies.push(0); await f.controller.check();
  assert.deepEqual(f.calls, ['check', 'download', 'flush', ['install', false, true]]);
  await f.controller.check();
  assert.deepEqual(f.calls, ['check', 'download', 'flush', ['install', false, true]]);
});
test('failed downloads (including checksum rejection) never install and can be retried', async () => {
  const f = fixture(); f.replies.push(0);
  f.updater.downloadUpdate = async () => { f.updater.emit('error', new Error('checksum mismatch')); throw new Error('checksum mismatch'); };
  await f.controller.check();
  assert.equal(f.controller.state.phase, 'idle');
  assert.equal(f.messages.at(-1).type, 'error');
  assert.equal(f.messages.at(-1).detail, 'checksum mismatch');
  assert.deepEqual(f.calls, ['check']);
});
test('install failure reports an error and retains the downloaded update', async () => {
  const f = fixture(); f.replies.push(0, 0);
  f.updater.quitAndInstall = () => { f.updater.emit('error', new Error('Authorization cancelled')); };
  await f.controller.check();
  assert.equal(f.controller.state.phase, 'downloaded');
  assert.equal(f.messages.at(-1).message, 'Could not install the update');
});
test('unsupported builds and releases without metadata keep manual downloads', async () => {
  for (const overrides of [{ unsupportedReason: async () => 'Unsigned macOS build.' }, { metadataName: 'missing.yml' }]) {
    const f = fixture(overrides); f.replies.push(0);
    await f.controller.check();
    assert.deepEqual(f.calls, ['https://github.com/xuyao00/apdf/releases/tag/v0.2.0']);
    assert.equal(f.messages[0].buttons[0], 'View release');
  }
});
test('no release, current version and network failures never initialize the updater', async () => {
  for (const status of ['no-release', 'current']) {
    const f = fixture({ getRelease: async () => ({ status, currentVersion: '0.1.0' }) });
    await f.controller.check(); assert.deepEqual(f.calls, []);
  }
  const f = fixture({ getRelease: async () => { throw new Error('Offline'); } });
  await f.controller.check(); assert.equal(f.messages[0].detail, 'Offline'); assert.deepEqual(f.calls, []);
});
