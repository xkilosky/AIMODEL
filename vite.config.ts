import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function makeCrc32Table(): Uint32Array {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
}

const CRC_TABLE = makeCrc32Table();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function generateLocalPng(size: number, round = false): Buffer {
  const scale = 256 / size;
  const distSeg = (px: number, py: number, ax: number, ay: number, bx: number, by: number) => {
    const vx = bx - ax;
    const vy = by - ay;
    const wx = px - ax;
    const wy = py - ay;
    const c1 = vx * wx + vy * wy;
    if (c1 <= 0) return Math.hypot(px - ax, py - ay);
    const c2 = vx * vx + vy * vy;
    if (c2 <= c1) return Math.hypot(px - bx, py - by);
    const b = c1 / c2;
    return Math.hypot(px - (ax + b * vx), py - (ay + b * vy));
  };

  const raw = Buffer.alloc(size * (1 + size * 4));
  let ptr = 0;
  for (let y = 0; y < size; y++) {
    raw[ptr++] = 0;
    const ny = (y + 0.5) * scale;
    for (let x = 0; x < size; x++) {
      const nx = (x + 0.5) * scale;
      let r = 255;
      let g = 255;
      let b = 255;

      // Linor's app mark stays monochrome: white field, black icon. Keep this generator
      // deterministic so web/PWA and legacy Android launcher icons share the same palette.
      const ar = 0;
      const ag = 0;
      const ab = 0;

      const dx = nx - 128;
      const dy = ny - 128;
      const rad = Math.hypot(dx, dy);
      const ang = (Math.atan2(dy, dx) * 180) / Math.PI;
      let adist: number;
      if (!(ang > -85 && ang < 36)) {
        adist = Math.abs(rad - 80);
      } else {
        const a1 = (-85 * Math.PI) / 180;
        const a2 = (36 * Math.PI) / 180;
        adist = Math.min(
          Math.hypot(nx - (128 + 80 * Math.cos(a1)), ny - (128 + 80 * Math.sin(a1))),
          Math.hypot(nx - (128 + 80 * Math.cos(a2)), ny - (128 + 80 * Math.sin(a2)))
        );
      }
      if (adist < 8.2) {
        const aa = Math.max(0, Math.min(1, (8.2 - adist) / 1.4));
        r = Math.round(r * (1 - aa) + ar * aa);
        g = Math.round(g * (1 - aa) + ag * aa);
        b = Math.round(b * (1 - aa) + ab * aa);
      }

      const sdist = Math.hypot(nx - 176, ny - 92);
      if (sdist < 15.2) {
        const aa = Math.max(0, Math.min(1, (15.2 - sdist) / 1.4));
        r = Math.round(r * (1 - aa) + ar * aa);
        g = Math.round(g * (1 - aa) + ag * aa);
        b = Math.round(b * (1 - aa) + ab * aa);
      }

      const dl = Math.min(
        distSeg(nx, ny, 106, 88, 106, 154),
        distSeg(nx, ny, 106, 154, 162, 154)
      );
      if (dl < 9.0) {
        const aa = Math.max(0, Math.min(1, (9.0 - dl) / 1.4));
        r = Math.round(r * (1 - aa));
        g = Math.round(g * (1 - aa));
        b = Math.round(b * (1 - aa));
      }

      raw[ptr++] = r;
      raw[ptr++] = g;
      raw[ptr++] = b;
      raw[ptr++] = round && Math.hypot(nx - 128, ny - 128) > 124 ? 0 : 255;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

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
      // Ensure PWA PNG icons exist in dist even if deployed from text-only file manifest
      const icon192 = path.join(outDir, 'icon-192.png');
      const icon512 = path.join(outDir, 'icon-512.png');
      // Always overwrite copied public PNGs so the brand assets cannot be stale after a rebrand.
      fs.writeFileSync(icon192, generateLocalPng(192));
      fs.writeFileSync(icon512, generateLocalPng(512));
      fs.writeFileSync(path.resolve(__dirname, 'public/icon-192.png'), generateLocalPng(192));
      fs.writeFileSync(path.resolve(__dirname, 'public/icon-512.png'), generateLocalPng(512));

      if (fs.existsSync(wllamaPath)) {
        const destWllama = path.join(outDir, 'wasm/wllama.wasm');
        fs.mkdirSync(path.dirname(destWllama), { recursive: true });
        fs.copyFileSync(wllamaPath, destWllama);
      }
      // Capacitor's stock mipmap PNGs are not regenerated by `cap sync`; write the
      // monochrome Linor launcher art at Android's standard density sizes during build.
      const androidResDir = path.resolve(__dirname, 'android/app/src/main/res');
      const launcherSizes: Array<[string, number]> = [
        ['mdpi', 48],
        ['hdpi', 72],
        ['xhdpi', 96],
        ['xxhdpi', 144],
        ['xxxhdpi', 192],
      ];
      for (const [density, size] of launcherSizes) {
        const mipmapDir = path.join(androidResDir, `mipmap-${density}`);
        fs.mkdirSync(mipmapDir, { recursive: true });
        const icon = generateLocalPng(size);
        fs.writeFileSync(path.join(mipmapDir, 'ic_launcher.png'), icon);
        fs.writeFileSync(path.join(mipmapDir, 'ic_launcher_round.png'), generateLocalPng(size, true));
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
