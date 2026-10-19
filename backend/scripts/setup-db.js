/**
 * Crea (o repara) la colección de libros eclesiásticos en MongoDB Atlas.
 *
 *   node scripts/setup-db.js
 *
 * Es idempotente: se puede ejecutar las veces que haga falta sin duplicar
 * índices ni perder documentos existentes.
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const { MongoClient } = require('mongodb');

const uri = (process.env.MONGO_URI || '').trim();
const dbName = (process.env.DB_NAME || 'biblioteca_digital').trim();
const collectionName = (process.env.COLLECTION_NAME || 'libros_eclesiasticos').trim();

/**
 * Esquema alineado con `modelo_libro.json`. Actuar como red de seguridad:
 * si algún cliente intenta guardar un documento incompleto, MongoDB lo
 * rechaza en lugar de dejar basura en el archivo.
 */
const VALIDATOR = {
  $jsonSchema: {
    bsonType: 'object',
    required: [
      'isbn_o_codigo',
      'titulo',
      'autor',
      'iglesia',
      'tipo_libro',
      'periodo',
      'idioma',
      'palabras_clave',
      'fecha_procesamiento',
      'paginas'
    ],
    properties: {
      isbn_o_codigo: { bsonType: 'string', description: 'Código único del documento' },
      titulo: { bsonType: 'string' },
      autor: { bsonType: 'string' },
      iglesia: { bsonType: 'string' },
      tipo_libro: { bsonType: 'string' },
      periodo: {
        bsonType: 'object',
        required: ['anio_inicio', 'anio_fin'],
        properties: {
          anio_inicio: { bsonType: 'int' },
          anio_fin: { bsonType: 'int' }
        }
      },
      idioma: { bsonType: 'string' },
      categoria: { bsonType: 'string' },
      palabras_clave: { bsonType: 'array', items: { bsonType: 'string' } },
      caracteres_totales: { bsonType: 'int' },
      fecha_procesamiento: { bsonType: 'string' },
      capitulos: { bsonType: 'array' },
      paginas: {
        bsonType: 'array',
        items: {
          bsonType: 'object',
          required: ['numero_pagina', 'texto'],
          properties: {
            numero_pagina: { bsonType: 'int' },
            nombre_archivo: { bsonType: 'string' },
            conteo_palabras: { bsonType: 'int' },
            texto: { bsonType: 'string' }
          }
        }
      }
    }
  }
};

const INDEXES = [
  { key: { isbn_o_codigo: 1 }, name: 'uniq_isbn_o_codigo', unique: true },
  { key: { iglesia: 1 }, name: 'idx_iglesia' },
  { key: { tipo_libro: 1 }, name: 'idx_tipo_libro' },
  { key: { 'periodo.anio_inicio': 1 }, name: 'idx_anio_inicio' },
  {
    key: { titulo: 'text', autor: 'text', iglesia: 'text', 'palabras_clave': 'text', 'paginas.texto': 'text' },
    name: 'idx_busqueda_completa',
    weights: {
      titulo: 10,
      autor: 6,
      iglesia: 4,
      tipo_libro: 3,
      palabras_clave: 3,
      'paginas.texto': 1
    },
    default_language: 'spanish'
  }
];

async function main() {
  if (!uri) {
    console.error('❌ MONGO_URI no está definido en backend/.env');
    process.exit(1);
  }

  const client = new MongoClient(uri);
  await client.connect();
  console.log('✅ Conectado a MongoDB Atlas');

  const db = client.db(dbName);

  const existentes = await db.listCollections({ name: collectionName }).toArray();

  if (existentes.length === 0) {
    await db.createCollection(collectionName, {
      validator: VALIDATOR,
      validationLevel: 'strict',
      validationAction: 'error'
    });
    console.log(`✅ Colección "${collectionName}" creada con validador estricto`);
  } else {
    await db.command({
      collMod: collectionName,
      validator: VALIDATOR,
      validationLevel: 'strict',
      validationAction: 'error'
    });
    console.log(`🔧 Validador de "${collectionName}" actualizado`);
  }

  const erroresIndices = [];
  for (const spec of INDEXES) {
    // MongoDB rechaza `null` en estas opciones, así que solo se incluyen
    // las que aplican a cada tipo de índice.
    const opciones = { name: spec.name };
    if (spec.unique !== undefined) opciones.unique = spec.unique;
    if (spec.weights !== undefined) opciones.weights = spec.weights;
    if (spec.default_language !== undefined) {
      opciones.default_language = spec.default_language;
    }
    try {
      await db.collection(collectionName).createIndex(spec.key, opciones);
      console.log(`   ✓ índice ${spec.name}`);
    } catch (e) {
      console.error(`   ✗ índice obligatorio ${spec.name}: ${e.message}`);
      erroresIndices.push({ indice: spec.name, error: e.message });
    }
  }

  if (erroresIndices.length > 0) {
    await client.close();
    console.error(
      `\n❌ Error crítico: ${erroresIndices.length} índice(s) obligatorio(s) no pudieron crearse.`
    );
    for (const err of erroresIndices) {
      console.error(`   - ${err.indice}: ${err.error}`);
    }
    process.exit(1);
  }

  const total = await db.collection(collectionName).countDocuments();
  console.log(`\n📚 ${dbName}.${collectionName} lista · ${total} documento(s)`);

  await client.close();
}

main().catch((err) => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
