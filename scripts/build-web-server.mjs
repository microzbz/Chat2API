import { build } from 'esbuild'

await build({
  entryPoints: ['src/web/index.ts'],
  outfile: 'dist/web/server/web/index.js',
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: ['node18'],
  packages: 'external',
  sourcemap: false,
  legalComments: 'none',
  tsconfig: 'tsconfig.web.json',
  logLevel: 'info',
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'production'),
  },
})
