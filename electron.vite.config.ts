import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const alias = { '@shared': resolve(import.meta.dirname, 'shared') }

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias },
    build: { rollupOptions: { input: resolve(import.meta.dirname, 'electron/main/index.ts') } }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias },
    build: {
      rollupOptions: {
        input: resolve(import.meta.dirname, 'electron/preload/index.ts'),
        output: { format: 'cjs', entryFileNames: '[name].cjs' }
      }
    }
  },
  renderer: {
    root: 'src',
    plugins: [react(), tailwindcss()],
    resolve: { alias: { ...alias, '@': resolve(import.meta.dirname, 'src') } },
    build: { rollupOptions: { input: resolve(import.meta.dirname, 'src/index.html') } }
  }
})
