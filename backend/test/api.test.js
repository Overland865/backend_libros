const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { adaptarLibro } = require('../src/libro_adapter');

// Configuramos variables de entorno para pruebas antes de cargar el servidor
process.env.PORT = '0'; // Puerto efímero aleatorio
process.env.API_KEY = 'test-secret-token-123';
process.env.NODE_ENV = 'test';
process.env.DB_NAME = 'biblioteca_digital';
process.env.MONGO_URI = 'mongodb://127.0.0.1:1';
process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS = '100';
delete process.env.COLLECTION_NAME;

const app = require('../src/server');
const { cerrar } = require('../src/db');

describe('Adaptación de libros de biblioteca_digital.libros', () => {
  test('mapea el esquema de catálogo al formato consumido por la app', () => {
    const libro = adaptarLibro({
      _id: 'libro-1',
      titulo: 'Título',
      autor: 'Autora',
      isbn: '9780000000001',
      editorial: 'Editorial',
      anio_publicacion: 1924,
      categorias: ['Historia', 'Religión'],
      total_paginas: 120,
      fecha_creacion: '2024-01-01T00:00:00.000Z',
    });

    assert.strictEqual(libro._id, 'libro-1');
    assert.strictEqual(libro.isbn_o_codigo, '9780000000001');
    assert.strictEqual(libro.tipo_libro, 'Historia, Religión');
    assert.deepStrictEqual(libro.palabras_clave, ['Historia', 'Religión']);
    assert.deepStrictEqual(libro.periodo, { anio_inicio: 1924, anio_fin: 1924 });
    assert.strictEqual(libro.fecha_procesamiento, '2024-01-01T00:00:00.000Z');
    assert.strictEqual(libro.iglesia, '');
    assert.strictEqual(libro.total_paginas, 120);
  });

  test('conserva los campos normalizados de libros eclesiásticos', () => {
    const libro = adaptarLibro({
      _id: 'libro-2',
      isbn_o_codigo: 'COD-2',
      iglesia: 'Parroquia',
      tipo_libro: 'Bautismos',
      periodo: { anio_inicio: 1800, anio_fin: 1810 },
      palabras_clave: ['bautismo'],
    });

    assert.strictEqual(libro.isbn_o_codigo, 'COD-2');
    assert.strictEqual(libro.iglesia, 'Parroquia');
    assert.strictEqual(libro.tipo_libro, 'Bautismos');
    assert.deepStrictEqual(libro.periodo, { anio_inicio: 1800, anio_fin: 1810 });
    assert.deepStrictEqual(libro.palabras_clave, ['bautismo']);
  });
});

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
    assert.strictEqual(body.base_datos, 'biblioteca_digital');
    assert.strictEqual(body.coleccion, 'libros');
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

  test('Security: Authorization Bearer accepts the valid key', async () => {
    const res = await fetch(`${baseUrl}/api/libros`, {
      headers: { 'Authorization': 'Bearer test-secret-token-123' }
    });
    assert.notStrictEqual(res.status, 401);
  });

  test('Security: Authorization without Bearer scheme returns 401', async () => {
    const res = await fetch(`${baseUrl}/api/libros`, {
      headers: { 'Authorization': 'test-secret-token-123' }
    });
    assert.strictEqual(res.status, 401);
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
