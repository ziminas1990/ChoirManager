// build.js
import { build } from 'esbuild';
import path from 'path';
import { fileURLToPath } from 'url';
import { builtinModules } from 'module';

// Get __dirname in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const shared = {
  bundle: true,
  target: 'node18',
  platform: 'node',
  format: 'cjs',
  external: [...builtinModules],
  resolveExtensions: ['.ts', '.js'],
  alias: {
    '@src': path.resolve(__dirname, 'src'),
  },
  loader: {
    '.ts': 'ts',
  },
};

Promise.all([
  build({
    ...shared,
    entryPoints: ['./dist/app.js'],
    outfile: 'dist/app.cjs',
  })
]).catch(() => process.exit(1));
