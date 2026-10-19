const { MongoClient } = require('mongodb');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const uri = (process.env.MONGO_URI || '').trim();
const dbName = (process.env.DB_NAME || 'biblioteca_digital').trim();
const collectionName = (process.env.COLLECTION_NAME || 'libros_eclesiasticos').trim();

// El plan gratuito de Atlas (M0) PAUSA el cluster tras 5 minutos sin
// actividad y tarda hasta ~30s en despertarlo. Con los valores por defecto
// del driver, el primer request tras la pausa se queda colgado y el proceso
// termina muriendo. Por eso se acota el timeout y se reconecta solo.
const SERVER_SELECTION_TIMEOUT_MS = Number(
  process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS || 10000
);
const MAX_REINTENTOS = 5;
const INTERVALO_KEEPALIVE_MS = 4 * 60 * 1000; // mantiene despierto el cluster M0

let client = null;
let db = null;
let librosCollection = null;
let conectando = null;
let ultimoError = null;
let fallosConsecutivos = 0;

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Un solo intento de conexión. Si varios requests llegan mientras Atlas
 * despierta, todos comparten la misma promesa en vez de abrir un enjambre
 * de conexiones.
 */
async function intentarConectar() {
  if (librosCollection) return librosCollection;
  if (!uri) throw new Error('MONGO_URI no está definido en el archivo .env');
  if (conectando) return conectando;

  conectando = (async () => {
    const nuevo = new MongoClient(uri, {
      serverSelectionTimeoutMS: SERVER_SELECTION_TIMEOUT_MS,
      connectTimeoutMS: SERVER_SELECTION_TIMEOUT_MS,
    });
    await nuevo.connect();
    const base = nuevo.db(dbName);
    await base.command({ ping: 1 }); // confirma que el cluster responde de verdad

    client = nuevo;
    db = base;
    librosCollection = base.collection(collectionName);

    if (fallosConsecutivos > 0) {
      console.log(`✅ Conexión a Atlas restaurada tras ${fallosConsecutivos} fallo(s)`);
    }
    fallosConsecutivos = 0;
    ultimoError = null;
    console.log(`✅ Conectado a ${dbName}.${collectionName}`);
    return librosCollection;
  })();

  try {
    return await conectando;
  } catch (e) {
    ultimoError = e.message;
    fallosConsecutivos++;
    throw e;
  } finally {
    conectando = null;
  }
}

/** Conexión con reintentos y espera exponencial. */
async function connectDB({ reintentos = MAX_REINTENTOS } = {}) {
  let espera = 2000;
  for (let i = 1; i <= reintentos; i++) {
    try {
      return await intentarConectar();
    } catch (e) {
      if (i === reintentos) throw e;
      console.warn(
        `⚠️  Atlas no disponible (intento ${i}/${reintentos}): ${e.message}. Reintento en ${espera / 1000}s...`
      );
      await dormir(espera);
      espera = Math.min(espera * 2, 30000);
    }
  }
}

/**
 * Usado por cada ruta. Un solo intento (máx. ~10s) para no agotar el
 * timeout del cliente móvil; de reconectarse se encarga el keepalive.
 */
async function getCollection() {
  if (!librosCollection) await intentarConectar();
  return librosCollection;
}

/**
 * Latido: mantiene despierto el cluster M0 y, si la conexión se cae,
 * la restablece en segundo plano sin tumbar el servidor.
 */
function iniciarKeepalive() {
  const timer = setInterval(async () => {
    if (!librosCollection) {
      try {
        await connectDB({ reintentos: 1 });
      } catch (e) {
        console.warn(`⚠️  Atlas sigue caído: ${e.message}`);
      }
      return;
    }
    try {
      await db.command({ ping: 1 });
    } catch (e) {
      console.warn(`⚠️  Se perdió la conexión con Atlas (${e.message}). Reconectando...`);
      librosCollection = null;
      try {
        await connectDB({ reintentos: 2 });
      } catch (e2) {
        console.warn(`⚠️  Reconexión fallida: ${e2.message}`);
      }
    }
  }, INTERVALO_KEEPALIVE_MS);

  timer.unref();
  return timer;
}

/** Estado para el endpoint de salud. */
function estadoConexion() {
  return {
    mongo: librosCollection ? 'conectado' : 'desconectado',
    base_datos: dbName,
    coleccion: collectionName,
    ultimo_error: ultimoError
  };
}

async function cerrar() {
  if (client) await client.close();
  client = null;
  db = null;
  librosCollection = null;
}

module.exports = {
  connectDB,
  getCollection,
  estadoConexion,
  iniciarKeepalive,
  cerrar
};
