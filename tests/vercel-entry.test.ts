import assert from 'node:assert/strict'
import { once } from 'node:events'
import { randomBytes } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { test } from 'node:test'
import { generarHash } from '../backend/supervisor/cuenta.ts'

test('La entrada serverless recompone la ruta de Vercel y sirve la configuración sin app.listen propio', async () => {
  const clave = randomBytes(24).toString('base64url')
  const hash = await generarHash(clave)
  const nombres = [
    'CONTRACT_SOURCE', 'INOVA_SOURCE', 'PORT', 'SUPERVISOR_HASH',
    'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'VERCEL_URL',
    'VERCEL_ENV', 'VERCEL_PROJECT_ID', 'SUPERVISOR_ORIGIN',
    'SUPERVISOR_CONCURRENCY', 'SUPERVISOR_SCOPE', 'SUPERVISOR_PILOT_CONTRACTS',
  ]
  const anteriores = new Map(nombres.map(nombre => [nombre, process.env[nombre]]))
  Object.assign(process.env, {
    CONTRACT_SOURCE: 'mock',
    INOVA_SOURCE: 'mock',
    PORT: '3001',
    SUPERVISOR_HASH: hash,
    UPSTASH_REDIS_REST_URL: 'https://redis.example',
    UPSTASH_REDIS_REST_TOKEN: 'token-de-prueba',
    VERCEL_URL: 'preview.vercel.app',
    VERCEL_ENV: 'preview',
    VERCEL_PROJECT_ID: 'proyecto-de-prueba',
    SUPERVISOR_ORIGIN: 'https://preview.vercel.app',
    SUPERVISOR_CONCURRENCY: '2',
    SUPERVISOR_SCOPE: 'pilot',
    SUPERVISOR_PILOT_CONTRACTS: '[]',
  })

  let server: Server | undefined
  try {
    execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'backend/tsconfig.json'], {
      cwd: process.cwd(),
      stdio: 'pipe',
    })
    const rutaEntrada: string = '../api/index.js'
    const modulo = await import(rutaEntrada) as typeof import('../api/handler.ts')
    const servidor = modulo.default.listen(0, '127.0.0.1')
    server = servidor
    await once(servidor, 'listening')
    const base = 'http://127.0.0.1:' + (servidor.address() as AddressInfo).port
    const respuesta = await fetch(base + '/api/index?__ruta=configuracion')
    assert.equal(respuesta.status, 200)
    assert.deepEqual(await respuesta.json(), {
      demostracion: true,
      fuentes: { contratos: 'mock', informes: 'mock' },
    })
  } finally {
    if (server) await new Promise<void>(resolve => server!.close(() => resolve()))
    for (const [nombre, valor] of anteriores) {
      if (valor === undefined) delete process.env[nombre]
      else process.env[nombre] = valor
    }
  }
})
