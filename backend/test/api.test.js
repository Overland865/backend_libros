const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

// Configuramos variables de entorno para pruebas antes de cargar el servidor
process.env.PORT = '0'; // Puerto efímero aleatorio
process.env.API_KEY = 'test-secret-token-123';
process.env.NODE_ENV = 'test';

const app = require('../src/server');
const { cerrar } = require('../src/db');

describe('API Backend - Tests Automatizados', () => {
  let server;
  let baseUrl;

  before((_, done) => {
    server = app.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      done();
    });
  });

  after(async () => {
    await cerrar();
    await new Promise((resolve) => server.close(resolve));
  });

  test('Liveness check: GET /healthz responde 200 inmediatamente', async () => {
    const res = await fetch(`${baseUrl}/healthz`);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.status, 'ok');
    assert.strictEqual(typeof body.uptime, 'number');
    assert.ok(body.timestamp);
  });

  test('Ruta raíz: GET / responde 200 con mapa de endpoints', async () => {
    const res = await fetch(`${baseUrl}/`);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.status, 'ok');
    assert.ok(body.endpoints.liveness_hosting);
    assert.ok(body.endpoints.listar_libros);
  });

  test('Readiness probe: GET /api/salud responde con estructura de estado', async () => {
    const res = await fetch(`${baseUrl}/api/salud`);
    // Puede responder 200 o 503 dependiendo de si Atlas está conectado
    assert.ok(res.status === 200 || res.status === 503);
    const body = await res.json();
    assert.strictEqual(body.servidor, 'ok');
    assert.ok('mongo' in body);
  });

  test('Seguridad: GET /api/libros sin token devuelve 401 Unauthorized', async () => {
    const res = await fetch(`${baseUrl}/api/libros`);
    assert.strictEqual(res.status, 401);
    const body = await res.json();
    assert.strictEqual(body.success, false);
    assert.match(body.error, /No autorizado/i);
  });

  test('Seguridad: GET /api/libros con token inválido devuelve 401 Unauthorized', async () => {
    const res = await fetch(`${baseUrl}/api/libros`, {
      headers: { 'X-API-Key': 'token-equivocado' }
    });
    assert.strictEqual(res.status, 401);
    const body = await res.json();
    assert.strictEqual(body.success, false);
  });

  test('Seguridad: Header Authorization Bearer es aceptado con clave válida', async () => {
    const res = await fetch(`${baseUrl}/api/libros`, {
      headers: { 'Authorization': 'Bearer test-secret-token-123' }
    });
    // Debe haber pasado la autenticación (no 401). Puede responder 200 si hay DB o 500 si no hay conexión
    assert.notStrictEqual(res.status, 401);
  });

  test('Transcripción: POST /api/transcribir sin imagen devuelve 400', async () => {
    const res = await fetch(`${baseUrl}/api/transcribir`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': 'test-secret-token-123'
      },
      body: JSON.stringify({})
    });
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.strictEqual(body.success, false);
  });
});
