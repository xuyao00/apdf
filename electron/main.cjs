const { app, BrowserWindow, ipcMain, dialog, shell, Menu, protocol, net, session, nativeTheme } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { randomUUID } = require('node:crypto');
const { Library, validatePdf, MAX_PDF_BYTES } = require('./library.cjs');
const { getUpdateStatus } = require('./updates.cjs');
const { UpdateController } = require('./update-controller.cjs');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

protocol.registerSchemesAsPrivileged([{ scheme: 'apdf', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
let window, library, pendingFile;
let initialized = false;
let theme = 'light';
let themeWrites = Promise.resolve();
const TITLE_BAR_HEIGHT = 64;
const documents = new Map();
const devUrl = process.env.APDF_DEV_URL === 'http://127.0.0.1:5173' ? process.env.APDF_DEV_URL : undefined;
// The display name can change without moving existing libraries/preferences.
app.setPath('userData', process.env.APDF_TEST_DATA || path.join(app.getPath('appData'), 'apdf'));
app.setName('aPDF');
if (process.platform === 'linux') app.setDesktopName('apdf.desktop');
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

function isTrusted(event) {
  const url = event.senderFrame?.url;
  return event.sender === window?.webContents && event.senderFrame === event.sender.mainFrame && (devUrl ? url?.startsWith(devUrl + '/') : url?.startsWith('apdf://app/'));
}
function handle(name, fn) {
  ipcMain.handle(name, async (event, ...args) => {
    if (!isTrusted(event)) throw new Error('Untrusted request.');
    return fn(...args);
  });
}
async function openFile(file) {
  if (typeof file !== 'string' || path.extname(file).toLowerCase() !== '.pdf') throw new Error('Please choose a PDF file.');
  if ((await fs.stat(file)).size > MAX_PDF_BYTES) throw new Error('Choose a PDF smaller than 300 MB.');
  const bytes = await fs.readFile(file);
  validatePdf(bytes);
  const token = randomUUID();
  documents.set(token, { bytes, filename: path.basename(file) });
  return { token, filename: path.basename(file), bytes: new Uint8Array(bytes) };
}
function current(token) {
  const doc = documents.get(token);
  if (!doc) throw new Error('Please reopen this document.');
  return doc;
}
function safeName(title) { return String(title).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 160) || 'document'; }
async function external(url) {
  const parsed = new URL(url);
  if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('Only HTTP and HTTPS links can be opened.');
  await shell.openExternal(parsed.href);
}
const updateMetadataName = process.platform === 'win32' ? `latest-${process.arch}.yml` : process.platform === 'darwin' ? 'latest-mac.yml' : `latest-linux${process.arch === 'x64' ? '' : '-' + process.arch}.yml`;
async function unsupportedUpdateReason() {
  if (!app.isPackaged) return 'Development builds are updated manually.';
  if (process.env.PORTABLE_EXECUTABLE_FILE) return 'Portable builds are updated manually.';
  if (process.platform === 'darwin') {
    try {
      const { stderr } = await promisify(execFile)('/usr/bin/codesign', ['-dv', '--verbose=4', app.getPath('exe').replace(/\/Contents\/MacOS\/[^/]+$/, '')], { timeout: 5000 });
      if (!/^TeamIdentifier=(?!not set)[A-Z0-9]+$/m.test(stderr)) return 'This macOS build is unsigned. Install the new version manually.';
    } catch { return 'This macOS build is unsigned. Install the new version manually.'; }
  } else if (process.platform === 'linux') {
    const type = await fs.readFile(path.join(process.resourcesPath, 'package-type'), 'utf8').catch(() => '');
    if (type.trim() !== 'deb') return 'This Linux archive is updated manually. Debian installations support in-app updates.';
  } else if (process.platform !== 'win32') return 'Install the new version manually on this platform.';
  return '';
}
const updates = new UpdateController({
  getRelease: () => getUpdateStatus(app.getVersion()),
  getUpdater: () => require('electron-updater').autoUpdater,
  unsupportedReason: unsupportedUpdateReason,
  metadataName: updateMetadataName,
  show: options => {
    const settings = { title: 'aPDF updates', defaultId: 0, cancelId: 0, noLink: true, ...options };
    return window && !window.isDestroyed() ? dialog.showMessageBox(window, settings) : dialog.showMessageBox(settings);
  },
  openExternal: external,
  publish: state => {
    window?.webContents.send('app:update-state', state);
    window?.setProgressBar(state.phase === 'downloading' ? state.percent / 100 : -1);
  },
  beforeInstall: async () => { await library.queue; await themeWrites; }
});
const checkForUpdates = () => updates.check();
function createWindow() {
  window = new BrowserWindow({
    width: 1320, height: 900, minWidth: 800, minHeight: 600,
    show: false, backgroundColor: theme === 'dark' ? '#222222' : '#ffffff', title: 'aPDF',
    icon: path.join(__dirname, '../build/icon.png'),
    titleBarStyle: 'hidden', autoHideMenuBar: true,
    ...(process.platform === 'darwin'
      ? { trafficLightPosition: { x: 16, y: 24 } }
      : { titleBarOverlay: { height: TITLE_BAR_HEIGHT, color: theme === 'dark' ? '#222222' : '#ffffff', symbolColor: theme === 'dark' ? '#e5e5e5' : '#303030' } }),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  window.once('ready-to-show', () => window?.show());
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  if (devUrl) window.loadURL(devUrl); else window.loadURL('apdf://app/index.html');
  window.on('closed', () => { window = null; documents.clear(); });
}
app.on('open-file', (event, file) => {
  event.preventDefault(); pendingFile = file;
  window?.webContents.send('pdf:available');
});
app.on('second-instance', (_event, argv) => {
  pendingFile = argv.find(arg => arg.toLowerCase().endsWith('.pdf'));
  if (!initialized) return;
  if (!window) createWindow();
  window.restore(); window.focus();
  window.webContents.send('pdf:available');
});
if (gotLock) app.whenReady().then(async () => {
  try {
    const preferences = JSON.parse(await fs.readFile(path.join(app.getPath('userData'), 'appearance.json'), 'utf8'));
    if (preferences.theme === 'dark') theme = 'dark';
  } catch { /* First launch uses the application's light theme. */ }
  nativeTheme.themeSource = theme;
  if (!app.isPackaged) app.dock?.setIcon(path.join(__dirname, '../build/icon.png'));
  library = new Library(path.join(app.getPath('userData'), 'library'));
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  protocol.handle('apdf', request => {
    const url = new URL(request.url);
    if (url.host !== 'app') return new Response('Not found', { status: 404 });
    const root = path.resolve(__dirname, '../dist');
    const file = path.resolve(root, '.' + decodeURIComponent(url.pathname));
    if (!file.startsWith(root + path.sep)) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(file).href);
  });
  handle('pdf:open', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(window, { filters: [{ name: 'PDF documents', extensions: ['pdf'] }], properties: ['openFile'] });
    return canceled ? null : openFile(filePaths[0]);
  });
  handle('pdf:drop', openFile);
  handle('pdf:pending', async () => {
    if (!pendingFile) return null;
    const file = pendingFile; pendingFile = undefined;
    return openFile(file);
  });
  handle('library:list', () => library.read());
  handle('library:load', async id => {
    const { bytes, entry } = await library.get(id);
    const token = randomUUID(); documents.set(token, { bytes, filename: entry.filename });
    return { token, filename: entry.filename, bytes: new Uint8Array(bytes), entry };
  });
  handle('library:save', (token, metadata) => { const doc = current(token); return library.add(doc.bytes, doc.filename, metadata); });
  handle('pdf:release', token => { documents.delete(token); });
  handle('library:update', (id, patch) => library.update(id, patch));
  handle('library:remove', id => library.remove(id));
  handle('pdf:export', async token => {
    const doc = current(token);
    const result = await dialog.showSaveDialog(window, { defaultPath: doc.filename, filters: [{ name: 'PDF', extensions: ['pdf'] }] });
    if (!result.canceled && result.filePath) await fs.writeFile(result.filePath, doc.bytes);
  });
  handle('bibtex:export', async (title, bibtex) => {
    if (typeof bibtex !== 'string' || bibtex.length > 100000) throw new Error('Invalid BibTeX.');
    const result = await dialog.showSaveDialog(window, { defaultPath: safeName(title) + '.bib', filters: [{ name: 'BibTeX', extensions: ['bib'] }] });
    if (!result.canceled && result.filePath) await fs.writeFile(result.filePath, bibtex, 'utf8');
  });
  handle('bibtex:import', async () => {
    const result = await dialog.showOpenDialog(window, { filters: [{ name: 'BibTeX', extensions: ['bib', 'bibtex', 'txt'] }], properties: ['openFile'] });
    if (result.canceled) return null;
    if ((await fs.stat(result.filePaths[0])).size > 100000) throw new Error('BibTeX file is too large (100 KB maximum).');
    return fs.readFile(result.filePaths[0], 'utf8');
  });
  handle('app:external', external);
  handle('app:check-updates', checkForUpdates);
  handle('app:update-state', () => updates.state);
  handle('app:theme', requested => {
    if (requested !== 'light' && requested !== 'dark') throw new Error('Invalid theme.');
    theme = requested;
    nativeTheme.themeSource = theme;
    const color = theme === 'dark' ? '#222222' : '#ffffff';
    window.setBackgroundColor(color);
    if (process.platform !== 'darwin') window.setTitleBarOverlay({ color, symbolColor: theme === 'dark' ? '#e5e5e5' : '#303030', height: TITLE_BAR_HEIGHT });
    // Keep native chrome in sync on the next launch, before the renderer loads.
    const preferences = JSON.stringify({ theme });
    const write = themeWrites.catch(() => {}).then(async () => {
      const file = path.join(app.getPath('userData'), 'appearance.json');
      await fs.mkdir(app.getPath('userData'), { recursive: true });
      await fs.writeFile(file + '.tmp', preferences, { mode: 0o600 });
      await fs.rename(file + '.tmp', file);
    });
    themeWrites = write;
    return write;
  });
  handle('pdf:print', async token => {
    const doc = current(token);
    // Chromium's native PDF viewer prints the original document at print quality.
    const printWindow = new BrowserWindow({ width: 1000, height: 800, title: 'Print PDF', webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } });
    const temporary = path.join(app.getPath('temp'), `apdf-print-${randomUUID()}.pdf`);
    await fs.writeFile(temporary, doc.bytes);
    printWindow.on('closed', () => { fs.unlink(temporary).catch(() => {}); });
    printWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    await printWindow.loadURL(pathToFileURL(temporary).href);
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    { label: 'File', submenu: [{ label: 'Open PDF…', accelerator: 'CmdOrCtrl+O', click: () => window?.webContents.send('pdf:available', 'dialog') }, { role: 'close' }] },
    { role: 'editMenu' },
    { label: 'View', submenu: [{ role: 'togglefullscreen' }, ...(devUrl ? [{ role: 'toggleDevTools' }] : [])] },
    { role: 'windowMenu' },
    { role: 'help', submenu: [{ label: 'Check for Updates…', click: () => { void checkForUpdates(); } }] }
  ]));
  pendingFile ||= process.argv.slice(1).find(arg => arg.toLowerCase().endsWith('.pdf'));
  initialized = true;
  createWindow();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (initialized && !window) createWindow(); });
