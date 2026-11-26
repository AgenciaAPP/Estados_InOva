import { defineConfig } from 'vite'

export default defineConfig({
  root: 'frontend',
  envDir: false,
  envPrefix: [],
  build: { outDir: '../dist/client', emptyOutDir: true },
})
