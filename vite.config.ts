import { defineConfig } from 'vite'

export default defineConfig({
  root: 'frontend',
  envDir: false,
  build: { outDir: '../dist/client', emptyOutDir: true },
})
