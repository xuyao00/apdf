import { _electron as electron } from 'playwright';
import { expect } from '@playwright/test';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { makeFixture } from './fixture.mjs';

const results = resolve('test-results');
await mkdir(results, { recursive: true });
const data = await mkdtemp(join(tmpdir(), 'apdf-e2e-'));
const fixture = join(results, 'research-demo.pdf');
await makeFixture(fixture);
const errors = [];
let app;
let devServer;
if (process.argv.includes('--dev')) {
  const { createServer } = await import('vite');
  devServer = await createServer();
  await devServer.listen();
}
async function launch() {
  const executablePath = process.env.APDF_PACKAGED_EXEC;
  const args = executablePath ? [] : ['.'];
  if (process.env.CI && process.platform === 'linux') args.unshift('--no-sandbox');
  const instance = await electron.launch({ executablePath, args, env: { ...process.env, APDF_TEST_DATA: data, ...(devServer ? { APDF_DEV_URL: 'http://127.0.0.1:5173' } : {}) }, timeout: 30000 });
  const page = await instance.firstWindow();
  page.on('pageerror', e => errors.push(e.message));
  return { instance, page };
}
try {
  let launched = await launch(); app = launched.instance; let page = launched.page;
  await expect(page.getByRole('heading', { name: 'Your library', exact: true })).toBeVisible();
  const appVersion = await app.evaluate(({ app }) => app.getVersion());
  // Exercise the actual preload/IPC action without blocking on native dialogs.
  await app.evaluate(({ dialog, shell }) => {
    globalThis.apdfUpdateTest = { fetch: globalThis.fetch, dialog: dialog.showMessageBox, external: shell.openExternal, messages: [], opened: [], reply: 0 };
    dialog.showMessageBox = async (...args) => { globalThis.apdfUpdateTest.messages.push(args.at(-1)); return { response: globalThis.apdfUpdateTest.reply }; };
    shell.openExternal = async url => { globalThis.apdfUpdateTest.opened.push(url); };
  });
  try {
    for (const [status, body, message] of [
      [200, { tag_name: `v${appVersion}` }, 'aPDF is up to date'],
      [404, {}, 'No release is available yet'],
      [200, { tag_name: 'v99.0.0' }, 'aPDF 99.0.0 is available'],
      [429, {}, 'Could not update aPDF']
    ]) {
      await app.evaluate((_electron, { status, body }) => { globalThis.fetch = async () => new Response(JSON.stringify(body), { status }); }, { status, body });
      await page.getByRole('button', { name: 'Check for updates', exact: true }).click();
      await expect.poll(() => app.evaluate(() => globalThis.apdfUpdateTest.messages.at(-1)?.message)).toBe(message);
    }
    expect(await app.evaluate(() => globalThis.apdfUpdateTest.opened)).toEqual(['https://github.com/xuyao00/apdf/releases/tag/v99.0.0']);
  } finally {
    await app.evaluate(({ dialog, shell }) => {
      const original = globalThis.apdfUpdateTest;
      globalThis.fetch = original.fetch; dialog.showMessageBox = original.dialog; shell.openExternal = original.external;
      delete globalThis.apdfUpdateTest;
    });
  }
  await page.screenshot({ path: join(results, 'library-empty.png') });
  await page.getByRole('button', { name: 'Use dark theme', exact: true }).click();
  await expect.poll(() => app.evaluate(({ nativeTheme }) => nativeTheme.shouldUseDarkColors)).toBe(true);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.screenshot({ path: join(results, 'library-dark-titlebar.png'), animations: 'disabled' });
  // Rapid reference traversal can batch an older exit and a newer entry for
  // one page in the same observer callback. The newest entry must win.
  await page.evaluate(() => {
    const NativeObserver = window.IntersectionObserver;
    window.IntersectionObserver = class extends NativeObserver {
      constructor(callback, options) {
        super((entries, observer) => callback(entries.flatMap(entry => entry.isIntersecting && entry.target.classList.contains('pdf-page') ? [new Proxy(entry, { get(target, key) { return key === 'isIntersecting' ? false : Reflect.get(target, key, target); } }), entry] : [entry]), observer), options);
      }
    };
  });
  await app.evaluate(({ app }, file) => app.emit('open-file', { preventDefault() {} }, file), fixture);
  await expect(page.getByText('All pages ready')).toBeVisible({ timeout: 30000 });
  await expect(page.locator('.document-name strong')).toHaveText('A quieter way to read research');
  await expect(page.locator('.document-scroll [data-page="1"] canvas')).toBeVisible();
  await expect(page.locator('.document-scroll .textLayer').first()).toContainText('Attention attention ATTENTION');
  // The toolbar occupies the top of the content, including the title-bar area.
  const chrome = await page.locator('.reader-toolbar').evaluate(el => ({
    top: el.getBoundingClientRect().top,
    height: el.getBoundingClientRect().height,
    background: getComputedStyle(el).backgroundColor,
    draggable: getComputedStyle(el).getPropertyValue('-webkit-app-region'),
    buttonDraggable: getComputedStyle(el.querySelector('button')).getPropertyValue('-webkit-app-region')
  }));
  expect(chrome).toEqual({ top: 0, height: 64, background: 'rgb(34, 34, 34)', draggable: 'drag', buttonDraggable: 'no-drag' });
  if (process.platform === 'darwin') {
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getWindowButtonPosition())).toEqual({ x: 16, y: 24 });
  }
  // Narrow windows still expose actions, without overlapping native controls.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(800, 700));
  await expect(page.getByRole('button', { name: 'More reader actions' })).toBeVisible();
  await page.getByRole('button', { name: 'More reader actions' }).click();
  await expect(page.getByRole('button', { name: 'Rotate clockwise', exact: true })).toBeVisible();
  const buttonBounds = await page.getByRole('button', { name: 'Save', exact: true }).boundingBox();
  expect(buttonBounds.x + buttonBounds.width).toBeLessThanOrEqual(800);
  await page.getByRole('button', { name: 'More reader actions' }).press('Escape');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1320, 900));
  await page.getByRole('button', { name: 'Search document', exact: true }).click();
  await page.getByRole('textbox', { name: 'Search query' }).fill('attention');
  await expect(page.locator('.search-status')).toHaveText('4 results');
  await expect(page.locator('.document-scroll .match').first()).toBeVisible();
  await page.getByRole('button', { name: 'Case sensitive', exact: true }).click();
  await expect(page.locator('.search-status')).toHaveText('1 results');
  await page.getByRole('button', { name: 'Regular expression', exact: true }).click();
  await page.getByRole('textbox', { name: 'Search query' }).fill('Figure\\s+1');
  await expect(page.locator('.search-status')).toHaveText('3 results');
  await page.getByRole('textbox', { name: 'Search query' }).fill('[');
  await expect(page.locator('.search-status')).toContainText('Invalid regular expression');
  await page.getByRole('textbox', { name: 'Search query' }).fill('(a+)+$');
  await expect(page.locator('.search-status')).toContainText('took too long', { timeout: 10000 });
  await page.getByRole('textbox', { name: 'Search query' }).fill('Table\\s+1');
  await expect(page.locator('.search-status')).toHaveText('3 results');
  await page.getByRole('button', { name: 'Close navigation' }).click();
  await page.getByRole('textbox', { name: 'Page number', exact: true }).fill('1');
  await page.getByRole('textbox', { name: 'Page number', exact: true }).press('Enter');
  const documentScroll = page.locator('.document-scroll');
  const preview = page.getByRole('dialog', { name: 'Reference preview' });
  const position = () => documentScroll.evaluate(el => ({ top: el.scrollTop, left: el.scrollLeft }));
  const reference = page.getByRole('button', { name: 'Preview figure 1', exact: true }).first();
  await reference.hover();
  await expect(preview.locator('[data-preview-mode="crop"]')).toBeVisible();
  const figureCrop = JSON.parse(await preview.locator('.cropped-reference').getAttribute('data-crop'));
  expect(figureCrop.top).toBeGreaterThan(100); expect(figureCrop.top).toBeLessThan(142);
  expect(figureCrop.top + figureCrop.height).toBeGreaterThan(415);
  expect(figureCrop.top + figureCrop.height).toBeLessThan(460);
  expect(figureCrop.width).toBeGreaterThan(470); expect(figureCrop.width).toBeLessThan(550);
  await reference.click();
  await expect(page.getByRole('button', { name: 'Pin preview' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Show full page', exact: true }).click();
  await expect(preview.locator('[data-preview-mode="page"]')).toBeVisible();
  await page.getByRole('button', { name: 'Show cropped reference', exact: true }).click();
  await expect(preview.locator('[data-preview-mode="crop"] canvas')).toBeVisible();
  await page.screenshot({ path: join(results, 'reader-reference.png') });
  const originalPosition = await position();
  await page.getByRole('button', { name: 'Go to page', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Page number', exact: true })).toHaveValue('2');
  const samePageLink = documentScroll.locator('[data-page="2"]').getByRole('button', { name: 'Preview table 1', exact: true });
  await samePageLink.hover(); await expect(preview.locator('[data-preview-mode="crop"]')).toBeVisible();
  await samePageLink.click(); const samePageOrigin = await position();
  await page.getByRole('button', { name: 'Go to page', exact: true }).click();
  await expect.poll(async () => Math.abs((await position()).top - samePageOrigin.top)).toBeGreaterThan(5);
  const citationLink = documentScroll.getByRole('button', { name: 'Preview cite 1', exact: true });
  await citationLink.hover();
  await expect(preview).toContainText('page 3');
  await expect(preview.locator('[data-preview-mode="page"]')).toBeVisible();
  await citationLink.click(); const nestedPosition = await position();
  await page.getByRole('button', { name: 'Go to page', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Page number', exact: true })).toHaveValue('3');
  const tableLink = documentScroll.getByRole('button', { name: /^Preview table 1$/i }).last();
  await tableLink.hover();
  await expect(preview.locator('[data-preview-mode="crop"]')).toBeVisible();
  const tableCrop = JSON.parse(await preview.locator('.cropped-reference').getAttribute('data-crop'));
  expect(tableCrop.top).toBeGreaterThan(440); expect(tableCrop.top).toBeLessThan(480);
  expect(tableCrop.top + tableCrop.height).toBeGreaterThan(565);
  expect(tableCrop.top + tableCrop.height).toBeLessThan(600);
  await tableLink.click(); const thirdPosition = await position();
  await page.screenshot({ path: join(results, 'reader-table-reference.png') });
  await page.getByRole('button', { name: 'Go to page', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Page number', exact: true })).toHaveValue('2');
  for (const [expectedPage, expectedPosition] of [[3, thirdPosition], [2, nestedPosition], [2, samePageOrigin], [1, originalPosition]]) {
    await page.getByRole('button', { name: `Back to page ${expectedPage}`, exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Page number', exact: true })).toHaveValue(String(expectedPage));
    await expect.poll(async () => Math.abs((await position()).top - expectedPosition.top)).toBeLessThan(2);
    await expect.poll(async () => Math.abs((await position()).left - expectedPosition.left)).toBeLessThan(2);
  }
  await page.keyboard.press('Alt+ArrowRight');
  await expect(page.getByRole('textbox', { name: 'Page number', exact: true })).toHaveValue('2');
  await expect.poll(async () => Math.abs((await position()).top - samePageOrigin.top)).toBeLessThan(2);
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(page.getByRole('textbox', { name: 'Page number', exact: true })).toHaveValue('1');
  // Select an unlinked reference using the actual PDF.js text layer.
  await page.getByRole('textbox', { name: 'Page number', exact: true }).fill('1');
  await page.getByRole('textbox', { name: 'Page number', exact: true }).press('Enter');
  await expect(page.locator('.document-scroll [data-page="1"] .textLayer')).toContainText('Select Figure 1');
  await page.evaluate(() => {
    const span = Array.from(document.querySelectorAll('.document-scroll [data-page="1"] .textLayer span')).find(el => el.textContent?.startsWith('Select Figure 1'));
    if (!span?.firstChild) throw new Error('Unlinked-reference text missing.');
    const range = document.createRange(); range.setStart(span.firstChild, 7); range.setEnd(span.firstChild, 15);
    const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    span.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await page.getByRole('button', { name: 'Preview reference', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Reference preview' })).toContainText('page 2');
  await page.getByRole('button', { name: 'Go to page' }).click();
  await expect(page.getByRole('textbox', { name: 'Page number', exact: true })).toHaveValue('2');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Saved', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Citation details', exact: true }).click();
  await page.getByRole('textbox', { name: 'BibTeX entry' }).fill('@article{research2026,\n title={A quieter way to read research},\n author={Researcher, Jane},\n year={2026}\n}');
  await page.getByRole('button', { name: 'Save citation', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Citation details', exact: true })).not.toBeVisible();
  await page.getByRole('button', { name: 'Back to library' }).click();
  await expect(page.locator('.document-card')).toHaveCount(1);
  await expect(page.locator('.citation-badge')).toHaveText('BibTeX');
  await page.screenshot({ path: join(results, 'library-saved.png') });
  await app.close(); app = undefined;
  // Verify an actual process restart, not just a renderer state transition.
  launched = await launch(); app = launched.instance; page = launched.page;
  await expect(page.locator('.document-card')).toHaveCount(1);
  await expect.poll(() => app.evaluate(({ nativeTheme }) => nativeTheme.themeSource)).toBe('dark');
  await page.getByRole('button', { name: 'Open A quieter way to read research', exact: true }).click();
  await expect(page.getByText('All pages ready')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Page number', exact: true })).toHaveValue('2');
  await page.getByRole('button', { name: 'Citation details', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'BibTeX entry' })).toContainText('research2026');
  await page.getByRole('button', { name: 'Close citation details' }).click();
  await page.getByRole('button', { name: 'Rotate clockwise' }).click();
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await page.getByRole('button', { name: 'Focus mode', exact: true }).click();
  await expect(page.locator('.reader-toolbar')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Exit focus' })).toBeVisible();
  await page.screenshot({ path: join(results, 'reader-focus-titlebar.png') });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Back to library' })).toBeVisible();
  await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Results', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Page thumbnails', exact: true }).click();
  await expect(page.locator('.thumbnail')).toHaveCount(3);
  await page.getByRole('button', { name: 'Go to page 3', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Page number', exact: true })).toHaveValue('3');
  await page.getByRole('button', { name: 'Use light theme', exact: true }).click();
  await expect.poll(() => app.evaluate(({ nativeTheme }) => nativeTheme.shouldUseDarkColors)).toBe(false);
  await expect(page.locator('.reader-toolbar')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  const index = JSON.parse(await readFile(join(data, 'library/library.json'), 'utf8'));
  expect(index.entries[0].bibtex).toContain('research2026');
  expect(errors).toEqual([]);
  console.log('PASS: cropped figure/table previews, explicit PDF destinations, same-page and four-level nested jumps with exact Back/Forward restoration, merged title bar, native theme synchronization/restart, narrow-window actions, focus title bar, PDF rendering/search/previews, library and BibTeX persistence, navigation.');
  console.log(`Screenshots and demo PDF: ${results}`);
} catch (e) {
  if (app) { const windows = app.windows(); if (windows[0]) await windows[0].screenshot({ path: join(results, 'failure.png') }).catch(() => {}); }
  console.error('Renderer errors:', errors); throw e;
} finally {
  if (app) await app.close();
  await devServer?.close();
  await rm(data, { recursive: true, force: true });
}
