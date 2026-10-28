import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { compareVersions, getUpdateStatus } = createRequire(import.meta.url)('../electron/updates.cjs');
const release = tag => async () => new Response(JSON.stringify({ tag_name: tag, draft: false, prerelease: false }));

test('update versions compare numerically and respect semantic prerelease precedence', () => {
  for (const [newer, older] of [['0.10.0', '0.9.9'], ['1.0.0', '1.0.0-rc.1'], ['1.0.0-rc.10', '1.0.0-rc.2'], ['2.0.0-beta', '2.0.0-1'], ['1.0.0-beta.1', '1.0.0-beta']]) {
    assert.equal(compareVersions(newer, older), 1);
    assert.equal(compareVersions(older, newer), -1);
  }
  assert.equal(compareVersions('v0.1.0+build.1', '0.1.0'), 0);
  for (const tag of ['latest', '1.2', '01.2.3', '1.2.3-01', 'https://evil.test']) assert.throws(() => compareVersions(tag, '0.1.0'));
});
test('checks the fixed public endpoint without credentials and returns trusted release links', async () => {
  const result = await getUpdateStatus('0.1.0', async (url, options) => {
    assert.equal(url, 'https://api.github.com/repos/xuyao00/apdf/releases/latest');
    assert.ok(options.signal instanceof AbortSignal);
    assert.equal(options.headers.Authorization, undefined);
    return new Response(JSON.stringify({ tag_name: 'v0.2.0', html_url: 'https://evil.test' }));
  });
  assert.equal(result.status, 'available');
  assert.equal(result.releaseUrl, 'https://github.com/xuyao00/apdf/releases/tag/v0.2.0');
  assert.equal((await getUpdateStatus('0.2.0', release('v0.2.0'))).status, 'current');
  assert.equal((await getUpdateStatus('0.3.0', release('v0.2.0'))).status, 'current');
});
test('no releases, drafts and prereleases do not offer an update', async () => {
  assert.equal((await getUpdateStatus('0.1.0', async () => new Response('', { status: 404 }))).status, 'no-release');
  for (const field of ['draft', 'prerelease']) assert.equal((await getUpdateStatus('0.1.0', async () => new Response(JSON.stringify({ tag_name: 'v1.0.0', [field]: true })))).status, 'no-release');
});
test('network, rate limits, server errors and malformed releases have useful errors', async () => {
  await assert.rejects(getUpdateStatus('0.1.0', async () => { throw new Error('offline'); }), /internet connection/);
  for (const status of [403, 429]) await assert.rejects(getUpdateStatus('0.1.0', async () => new Response('', { status })), /limiting update checks/);
  await assert.rejects(getUpdateStatus('0.1.0', async () => new Response('', { status: 500 })), /try again later/);
  for (const body of ['bad json', 'null', '{}', '{"tag_name":"latest"}']) await assert.rejects(getUpdateStatus('0.1.0', async () => new Response(body)));
});
