# aPDF

A minimal desktop PDF reader for Linux, Windows, and macOS. Built with Electron, React, TypeScript, and PDF.js. Documents are rendered locally; no account, backend, or API key is needed.

This project is fully vibe coded.

The name is **aPDF**, as in “a PDF file.” Its icon is a greyscale paper book on a graphite tile.

## Download

Get macOS, Windows, and Linux installers from [GitHub Releases](https://github.com/xuyao00/apdf/releases/latest). Windows and macOS builds are unsigned; Windows and Linux packages have not yet been tested on those operating systems.

## Run

Use **Node.js 22.12+** (Node 24 LTS recommended) and npm.

```sh
npm ci
npm run dev
```

For a production build:

```sh
npm run build
npm start
```

Electron downloads its native runtime on first use. The initial run needs network access. Subsequent reading, search, and library operations work offline.

## Implemented

- Native file picker, PDF drag and drop, and opening a PDF passed on the command line or through OS file associations.
- Continuous, high-DPI viewing with selectable/copyable text, page navigation, zoom, fit width/page, rotation, focus mode, document outline, and thumbnails. Pages outside the visible area release their render surfaces.
- Floating previews of internal PDF links, including linked figures, tables, and bibliography entries. Hover to peek, click to keep a preview open, and jump to its destination with a return-to-page button.
- For PDFs without links, select a reference such as `Figure 2`, `Table 1`, or `[12]` and choose **Preview reference**. Caption/bibliography lookup is heuristic; linked destinations are more reliable, especially in multi-column papers.
- Full-document literal, case-sensitive/insensitive, and regular-expression search, with snippets and on-page highlights. Regex runs in an isolated worker and is terminated after 1.8 seconds. Searches return up to 5,000 matches. Regex uses JavaScript syntax with Unicode/global flags and optional case insensitivity. Zero-width matches are omitted.
- A local library containing independent PDF copies, metadata, reading position, and BibTeX. Identical files are deduplicated by SHA-256. Save a PDF with the **Save** button; opening alone does not add it to the library.
- Google Scholar title search and BibTeX paste/import, validation, copy, export, and persistence alongside the PDF. The citation title and authors become the library metadata.
- Original-PDF export, a separate Chromium print viewer, password-protected PDF opening, and light/dark application themes.
- A unified title bar and reader toolbar with native window controls, draggable background, and matching native light/dark appearance. Theme switching is available in both the library and reader. Focus mode retains the title and window controls; narrow windows move additional actions into the toolbar's more menu.

### Google Scholar workflow

Open **Citation details** (`{ }` in the reader toolbar), choose **Find on Scholar**, locate the paper, then choose **Cite → BibTeX**. Paste that entry into aPDF or import its `.bib` file and save. This can save both the PDF and its citation in one step.

Scholar lookup opens in the system browser. aPDF does **not** automatically scrape Scholar or claim to retrieve BibTeX automatically. Google supports citation export but restricts automated queries. See [Scholar search help](https://scholar.google.com/intl/en/scholar/help.html). BibTeX entry validation supports the braced/quoted fields used by Scholar exports, including nested braces; BibTeX macros and concatenated values are not expanded.

### Keyboard shortcuts

| Action | Shortcut |
| --- | --- |
| Open PDF | Cmd/Ctrl + O |
| Find in PDF | Cmd/Ctrl + F |
| Save to library | Cmd/Ctrl + S |
| Open print viewer | Cmd/Ctrl + P |
| Zoom | Cmd/Ctrl + `+` / `-` |
| Fit width | Cmd/Ctrl + 0 |
| Previous / next page | Left / Right or Page Up / Page Down |
| First / last page | Home / End |
| Next / previous search result | Enter / Shift + Enter in search |
| Toggle focus mode | F |
| Close preview / exit focus | Esc |

### Storage

aPDF uses Electron's per-user application-data directory, under `library/`:

- macOS: `~/Library/Application Support/apdf/library/`
- Windows: `%APPDATA%/apdf/library/`
- Linux: `$XDG_CONFIG_HOME/apdf/library/` (normally `~/.config/apdf/library/`)

The directory contains `<sha256>.pdf` files and a versioned `library.json`. Metadata writes are serialized and replaced atomically. A corrupt index is reported rather than overwritten. Back up the entire directory to preserve the library. Stored PDFs retain their original bytes, including any original encryption; metadata and BibTeX are ordinary local files. Removing a document deletes aPDF's copy and citation, leaving the source file alone.

## Build desktop packages

To create the macOS installer on a Mac, including a universal app for Apple Silicon and Intel:

```sh
npm run dist:mac
```

Open `release/aPDF-0.1.0-macOS-universal.dmg`, then drag **aPDF** into **Applications**. The same directory also contains a ZIP of the universal app. These local builds have no Developer ID signature or Apple notarization; distribution to other users requires signing/notarization credentials.

The icon source, PNG, and ICNS are in `build/`. `npm run icons:mac` regenerates the native icon sizes using macOS tools. See [icon design and generation prompt](build/icon-design.md).

Run packaging on the target OS:

```sh
npm run dist
```

For Windows and Linux releases, including both x64 and ARM64:

```sh
npm run dist:win      # NSIS installers and portable EXEs
npm run dist:linux    # Debian installers and portable tar.gz archives
npm run dist:desktop  # both platforms from a supported build host
```

Windows installers support installation for the current user and let you choose the installation folder. The portable EXEs run without installation. The installers are unsigned.

On Debian or Ubuntu, install the package for your architecture with `sudo apt install ./aPDF-0.1.0-Linux-amd64.deb` (or the `arm64` package). This installs the application, icon, desktop entry, and PDF file association. Removing the package preserves your personal library. The Debian packager uses the existing project author label; it adds no maintainer email or project website. The portable Linux archives contain the `apdf` executable and its resources.

Outputs in `release/`:

| OS | Packages |
| --- | --- |
| Linux | Debian package, tar.gz archive |
| Windows | NSIS installer, portable executable |
| macOS | DMG, ZIP |

`npm run dist:dir` creates an unpacked app for testing. The GitHub Actions workflow builds on all three operating systems, runs unit and native integration tests, and uploads unpacked apps. Its manual **Build installers** option produces installer artifacts too. The workflow has been supplied but has not been run here. Windows/Linux binaries still need validation on their target systems. Production distribution also needs appropriate macOS signing/notarization and Windows signing credentials; no credentials are included. Local development packages are unsigned.

## Verification

```sh
npm test          # storage, search, offsets, reference lookup, BibTeX
npm run build     # TypeScript + production renderer + bundled PDF resources
npm run test:e2e  # native Electron; run after build
npm run test:e2e:dev # same flows against the Vite development server
```

The native test uses an isolated temporary application-data directory, creates its own PDF fixture, checks search/highlights/previews, saves a PDF and citation, closes Electron, and verifies persistence after a real restart. It does not touch your regular aPDF library. Screenshots and a demo PDF are left in `test-results/`. Linux integration tests need a display (`xvfb-run -a npm run test:e2e` on headless machines).

## Architecture and next steps

- `electron/main.cjs`: native windows, dialogs, custom app protocol, validated IPC, file access.
- `electron/preload.cjs`: narrow, typed renderer bridge. Node integration is disabled; context isolation and renderer sandboxing are enabled. External destinations are limited to HTTP/HTTPS and opened by explicit user action in the system browser. See [Electron security guidance](https://www.electronjs.org/docs/latest/tutorial/security).
- `electron/library.cjs`: local content-addressed storage and atomic JSON metadata.
- `src/components/Reader.tsx`, `PdfPage.tsx`, `ReferencePreview.tsx`: reading, lazy rendering, selection, link/caption previews.
- `src/pdf.ts`, `src/search.worker.ts`, `src/core/`: PDF text indexing, bounded worker search, reference resolution, BibTeX parsing. PDF.js resources ship with the app; no CDN is required.

AI summaries and semantic search are intentionally deferred. A future provider can consume the page-indexed text from `buildIndex` without changing the PDF renderer. Add background chunking and an embedding index keyed by PDF hash; return page/offset references for semantic hits so results navigate and highlight like current search. Summaries should cite pages, cache by document hash/model, and make any transfer of document text an explicit user choice. Provider credentials belong in the OS credential store rather than the renderer or library index.

Current limits: 300 MB per PDF; no OCR for image-only scans, annotation editing, form filling, PDF modification, cloud sync, or AI requests. Search and heuristic reference previews require an extractable text layer. Only one document is active at a time.

## Updates

Choose **Check for updates** in the library sidebar, the reader’s **More reader actions** menu, or the native **Help** menu. aPDF checks the latest stable GitHub release and opens its download page when a newer version is available. Checks run only when requested; updates are installed manually. No published release, connection errors, and GitHub rate limits are reported explicitly.

## License

aPDF is licensed under [GNU LGPL version 3.0](LICENSE) (LGPL-3.0-only). See [COPYING](COPYING) for the incorporated GPL terms and [NOTICE](NOTICE) for attribution. Third-party components retain their own licenses.
