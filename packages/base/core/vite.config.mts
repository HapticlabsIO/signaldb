import path from 'path'
import { defineConfig } from 'vite'
import typescript from '@rollup/plugin-typescript'

export default defineConfig({
  build: {
    minify: false,
    sourcemap: false,
    reportCompressedSize: true,
    lib: {
      name: 'SignalDB',
      entry: path.resolve(__dirname, 'src/index.ts'),
      // With preserveModules, every module needs its own name: rollup numbers colliding
      // names (index2.mjs, ...) in module-resolution order, which varies between builds.
      fileName: (format, entryName) => (format === 'es' ? `${entryName}.mjs` : `${entryName}.${format}.js`),
      formats: ['es', 'cjs'],
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: false,
        preserveModules: true,
        format: 'es',
      },
      external: [
        'fast-sort',
        'mingo',
        'mingo/updater',
      ],
      plugins: [
        typescript({
          sourceMap: false,
          declaration: true,
          outDir: 'dist',
        }),
      ],
    },
  },
})
