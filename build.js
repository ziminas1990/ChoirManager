// build.js
import { build } from 'esbuild';
import path from 'path';
import { fileURLToPath } from 'url';
import { builtinModules } from 'module';

// Get __dirname in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

build({
  entryPoints: ['./dist/app.js'],
  bundle: true,
  target: 'node18', // Adjust this to your Node version
  platform: 'node',
  format: 'cjs',
  outfile: 'dist/app.cjs',
//   external: ['plotly.js'], // Don't bundle plotly.js
  external: [...builtinModules],
  resolveExtensions: ['.ts', '.js'],
  alias: {
    '@src': path.resolve(__dirname, 'src'),
  },
  loader: {
    '.ts': 'ts',
  },
}).catch(() => process.exit(1));
