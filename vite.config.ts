import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function localWasmAssetsPlugin(): Plugin {
  const wllamaPath = path.resolve(__dirname, 'node_modules/@wllama/wllama/esm/wasm/wllama.wasm');
  const ortDirs = [
    path.resolve(__dirname, 'node_modules/onnxruntime-web/dist'),
    path.resolve(__dirname, 'node_modules/@huggingface/transformers/dist'),
  ];

  const resolveOrtFile = (fileName: string): string | null => {
    const cleanName = path.basename(fileName);
    for (const dir of ortDirs) {
      const candidate = path.join(dir, cleanName);
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
    return null;
  };

  return {
    name: 'local-wasm-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const urlPath = (req.url || '').split('?')[0];
        if (urlPath === '/wasm/wllama.wasm' && fs.existsSync(wllamaPath)) {
          res.setHeader('Content-Type', 'application/wasm');
          res.setHeader('Cache-Control', 'public, max-age=3600');
          fs.createReadStream(wllamaPath).pipe(res);
          return;
        }
        if (urlPath.startsWith('/ort-wasm/')) {
          const target = resolveOrtFile(urlPath.slice('/ort-wasm/'.length));
          if (target) {
            const ext = path.extname(target);
            res.setHeader(
              'Content-Type',
              ext === '.wasm' ? 'application/wasm' : 'text/javascript; charset=utf-8'
            );
            res.setHeader('Cache-Control', 'public, max-age=3600');
            fs.createReadStream(target).pipe(res);
            return;
          }
        }
        next();
      });
    },
    writeBundle(options) {
      const outDir = options.dir || path.resolve(__dirname, 'dist');
      if (fs.existsSync(wllamaPath)) {
        const destWllama = path.join(outDir, 'wasm/wllama.wasm');
        fs.mkdirSync(path.dirname(destWllama), { recursive: true });
        fs.copyFileSync(wllamaPath, destWllama);
      }
      const destOrt = path.join(outDir, 'ort-wasm');
      fs.mkdirSync(destOrt, { recursive: true });
      for (const dir of ortDirs) {
        if (!fs.existsSync(dir)) continue;
        for (const name of fs.readdirSync(dir)) {
          if (
            (name.startsWith('ort-wasm') && (name.endsWith('.wasm') || name.endsWith('.mjs'))) ||
            (name.endsWith('.wasm') && name.includes('ort'))
          ) {
            fs.copyFileSync(path.join(dir, name), path.join(destOrt, name));
          }
        }
        break;
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), localWasmAssetsPlugin()],
  optimizeDeps: {
    exclude: ['@wllama/wllama', '@huggingface/transformers', 'onnxruntime-web'],
  },
  worker: {
    format: 'es',
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    allowedHosts: true,
  },
});
