import { defineConfig } from 'tsup';
import { copyFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

export default defineConfig({
  entry: {
    'nodes/Scopebound/Scopebound.node': 'nodes/Scopebound/Scopebound.node.ts',
    'credentials/ScopeboundApi.credentials': 'credentials/ScopeboundApi.credentials.ts',
  },
  format: ['cjs'],
  dts: false,
  // n8n-workflow is provided by the host n8n install at runtime.
  external: ['n8n-workflow'],
  outDir: 'dist',
  clean: true,
  shims: false,
  splitting: false,
  sourcemap: true,
  target: 'node18',
  // Copy the icon SVG after build — tsup doesn't handle static assets.
  onSuccess: async () => {
    const dest = 'dist/nodes/Scopebound/scopebound.svg';
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync('nodes/Scopebound/scopebound.svg', dest);
    console.log('✔ Copied scopebound.svg to dist/nodes/Scopebound/');
  },
});
