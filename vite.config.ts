import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { cpSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

export default defineConfig({
  base: './',
  plugins: [react(), {
    name: 'pdf-resources',
    transformIndexHtml(html, context) {
      // React's development refresh preamble is inline. Production retains
      // the strict policy from index.html and loads only bundled scripts.
      return context.server ? html.replace("script-src 'self';", "script-src 'self' 'unsafe-inline';") : html;
    },
    closeBundle() {
      for (const directory of ['cmaps', 'standard_fonts', 'wasm']) {
        const target = resolve('dist', directory);
        mkdirSync(target, { recursive: true });
        cpSync(resolve('node_modules/pdfjs-dist', directory), target, { recursive: true });
      }
    },
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!/^\/(cmaps|standard_fonts|wasm)\//.test(req.url || '')) return next();
        const { readFile } = await import('node:fs/promises');
        try {
          const file = resolve('node_modules/pdfjs-dist', '.' + new URL(req.url!, 'http://localhost').pathname);
          if (!file.startsWith(resolve('node_modules/pdfjs-dist') + '/')) return next();
          res.setHeader('Content-Type', file.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream');
          res.end(await readFile(file));
        } catch { next(); }
      });
    }
  }],
  server: { host: '127.0.0.1', port: 5173, strictPort: true }
});
