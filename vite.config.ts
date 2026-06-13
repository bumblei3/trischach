import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'js/main.js'),
      name: 'TriSchach',
      fileName: 'trischach',
      formats: ['es', 'umd'],
    },
    outDir: 'dist',
    sourcemap: true,
    minify: 'terser',
    target: 'es2022',
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'js'),
    },
  },
});