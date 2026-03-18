import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';
import type { Plugin } from 'vite';

const QUICKLATEX_PREAMBLE = [
  '\\usepackage{tikz}',
  '\\usepackage{pgfplots}',
  '\\pgfplotsset{compat=1.18}',
  '\\usetikzlibrary{arrows.meta,calc,angles,quotes,patterns,decorations.pathmorphing,positioning}',
].join('\n')

/**
 * Dev-only proxy: intercepts POST /api/quicklatex and forwards to quicklatex.com.
 * In production this is handled by the Vercel Edge Function at api/quicklatex.ts.
 */
function quicklatexDevProxy(): Plugin {
  return {
    name: 'quicklatex-dev-proxy',
    configureServer(server) {
      server.middlewares.use('/api/quicklatex', (req, res) => {
        if (req.method === 'OPTIONS') {
          res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS' })
          res.end()
          return
        }
        if (req.method !== 'POST') { res.writeHead(405); res.end(); return }

        const chunks: Buffer[] = []
        req.on('data', (chunk: Buffer) => chunks.push(chunk))
        req.on('end', async () => {
          try {
            const { formula } = JSON.parse(Buffer.concat(chunks).toString()) as { formula?: string }
            if (!formula) { res.writeHead(400); res.end('Missing formula'); return }

            const params = new URLSearchParams({
              formula, fsize: '17px', fcolor: '000000', bcolor: 'ffffff',
              mode: '0', out: '1', errors: '1', preamble: QUICKLATEX_PREAMBLE,
            })
            const qlRes = await fetch('https://quicklatex.com/latex3.f', {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: params.toString(),
            })
            const text = await qlRes.text()
            res.writeHead(200, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' })
            res.end(text)
          } catch (err) {
            res.writeHead(500); res.end(String(err))
          }
        })
      })
    },
  }
}

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), quicklatexDevProxy()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
      },
    },
    test: {
      environment: 'jsdom',
    },
  };
});
