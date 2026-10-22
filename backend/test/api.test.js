const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const { adaptarLibro } = require('../src/libro_adapter');
const { construirFiltroBusqueda } = require('../src/libro_search');
const { detectarCamposImagen } = require('../src/libro_validation');
const { PROMPT_PALEOGRAFICO } = require('../src/gemini');

process.env.PORT = '0';
process.env.APP_USERNAME = 'test-user';
process.env.APP_PASSWORD = 'test-password-for-tests';
process.env.NODE_ENV = 'test';
process.env.DB_NAME = 'biblioteca_digital';
process.env.MONGO_URI = 'mongodb://127.0.0.1:1';
process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS = '100';
delete process.env.COLLECTION_NAME;

const app = require('../src/server');
const { cerrar } = require('../src/db');

const authorization = (
  username = process.env.APP_USERNAME,
  password = process.env.APP_PASSWORD
) => 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');

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
      fecha_creacion: '2024-01-01T00:00:00.000Z'
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
      palabras_clave: ['bautismo']
    });

    assert.strictEqual(libro.isbn_o_codigo, 'COD-2');
    assert.strictEqual(libro.iglesia, 'Parroquia');
    assert.strictEqual(libro.tipo_libro, 'Bautismos');
    assert.deepStrictEqual(libro.periodo, { anio_inicio: 1800, anio_fin: 1810 });
    assert.deepStrictEqual(libro.palabras_clave, ['bautismo']);
  });
});

describe('Búsqueda específica de libros', () => {
  test('restringe la búsqueda editorial al campo seleccionado', () => {
    const filtro = construirFiltroBusqueda('Planeta', 'editorial');
    assert.deepStrictEqual(Object.keys(filtro), ['$or']);
    assert.strictEqual(filtro.$or.length, 1);
    assert.ok(filtro.$or[0].editorial instanceof RegExp);
    assert.strictEqual(filtro.$or[0].editorial.source, 'Planeta');
    assert.strictEqual(filtro.$or[0].editorial.flags, 'i');
  });

  test('busca un año exacto en los campos de periodo compatibles', () => {
    const filtro = construirFiltroBusqueda('1924', 'anio');
    assert.deepStrictEqual(filtro.$or, [
      { 'periodo.anio_inicio': 1924 },
      { 'periodo.anio_fin': 1924 },
      { anio_publicacion: 1924 }
    ]);
  });

  test('escapa metacaracteres en las búsquedas de texto', () => {
    const filtro = construirFiltroBusqueda('libro.*', 'titulo');
    assert.strictEqual(filtro.$or[0].titulo.source, 'libro\\.\\*');
  });
});

test('el prompt conserva explícitamente ñ, tildes y ortografía histórica', () => {
  assert.match(PROMPT_PALEOGRAFICO, /ñ y Ñ/);
  assert.match(PROMPT_PALEOGRAFICO, /No modernices la ortografía histórica/);
  assert.match(PROMPT_PALEOGRAFICO, /elimina ese guion y el salto de línea/);
  assert.match(PROMPT_PALEOGRAFICO, /no insertes saltos de línea solo porque el renglón/);
});

test('el guardado de libros detecta campos de imagen', () => {
  assert.deepStrictEqual(
    detectarCamposImagen({
      paginas: [{ texto: 'Transcripción', imagen_base64: 'no-persistir' }]
    }),
    ['$.paginas[0].imagen_base64']
  );
  assert.deepStrictEqual(
    detectarCamposImagen({
      paginas: [{ texto: 'El niño recibió la comunión.' }]
    }),
    []
  );
});

describe('Autenticación Basic de API', () => {
  let server;
  let baseUrl;

  before(async () => {
    server = await new Promise((resolve) => {
      const listeningServer = app.listen(0, '127.0.0.1', () => resolve(listeningServer));
    });
    baseUrl = 'http://127.0.0.1:' + server.address().port;
  });

  after(async () => {
    await cerrar();
    await new Promise((resolve) => server.close(resolve));
  });

  test('la salud sigue disponible sin credenciales', async () => {
    const res = await fetch(`${baseUrl}/healthz`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual((await res.json()).status, 'ok');
  });

  test('el endpoint de comprobación valida Basic Auth sin crear token', async () => {
    const res = await fetch(`${baseUrl}/api/auth/check`, {
      headers: { Authorization: authorization() }
    });
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(await res.json(), {
      success: true,
      message: 'Credenciales válidas.'
    });
  });

  test('rechaza credenciales faltantes, incorrectas y tokens antiguos', async () => {
    const missing = await fetch(`${baseUrl}/api/libros`);
    assert.strictEqual(missing.status, 401);

    const invalid = await fetch(`${baseUrl}/api/auth/check`, {
      headers: {
        Authorization: authorization('test-user', 'wrong-password')
      }
    });
    assert.strictEqual(invalid.status, 401);

    const legacy = await fetch(`${baseUrl}/api/auth/check`, {
      headers: { Authorization: 'Bearer old-token' }
    });
    assert.strictEqual(legacy.status, 401);
  });

  test('las rutas de transcripción también requieren credenciales válidas', async () => {
    const invalid = await fetch(`${baseUrl}/api/transcribir`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    assert.strictEqual(invalid.status, 401);

    const valid = await fetch(`${baseUrl}/api/transcribir`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authorization()
      },
      body: JSON.stringify({})
    });
    assert.strictEqual(valid.status, 400);
    assert.strictEqual((await valid.json()).success, false);
  });
});
