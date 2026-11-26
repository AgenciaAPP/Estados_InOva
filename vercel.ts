// La importación inicial desde main y cualquier entorno distinto de Preview quedan cerrados.
export const config = {
  framework: 'vite',
  installCommand: 'npm ci',
  buildCommand: 'npm run build:frontend',
  outputDirectory: 'dist/client',
  functions: { 'api/index.ts': { maxDuration: 30 } },
  routes: process.env.VERCEL_ENV === 'preview'
    ? [{ src: '/api/([a-z/-]+)', dest: '/api/index?__ruta=$1' }]
    : [{ src: '/(.*)', status: 403, headers: { 'Cache-Control': 'no-store' } }],
}
