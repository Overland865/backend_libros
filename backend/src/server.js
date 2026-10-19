const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const { connectDB, getCollection, estadoConexion, iniciarKeepalive, cerrar } = require('./db');
const { transcribirConGemini } = require('./gemini');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
// En hosting (Render, Railway, Fly, etc.) el contenedor exige 0.0.0.0.
// En local también sirve: permite acceso desde celular en la misma red.
const HOST = process.env.HOST || '0.0.0.0';

// Middlewares
const corsOrigin = process.env.CORS_ORIGIN;
app.use(
  cors(
    corsOrigin
      ? { origin: corsOrigin.split(',').map((s) => s.trim()).filter(Boolean) }
      : undefined, // sin restringir: la app móvil no envía Origin fijo
  ),
);
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

/** Escapa metacaracteres de RegExp para que el usuario pueda buscar literalmente. */
function escaparRegex(texto) {
  return String(texto).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Obtiene lista de claves API válidas configuradas en el entorno. */
function obtenerClavesConfiguradas() {
  const claves = [];
  if (process.env.API_KEY && process.env.API_KEY.trim()) {
    claves.push(process.env.API_KEY.trim());
  }
  if (process.env.API_KEYS) {
    claves.push(
      ...process.env.API_KEYS.split(',').map((k) => k.trim()).filter(Boolean)
    );
  }
  return claves;
}

let avisoAuthEmitido = false;

/**
 * Middleware de autenticación y autorización por API Key / Bearer token.
 * Exige credenciales válidas en X-API-Key o Authorization: Bearer <key>.
 */
function verificarAutenticacion(req, res, next) {
  const clavesValidas = obtenerClavesConfiguradas();

  if (clavesValidas.length === 0) {
    if (process.env.NODE_ENV === 'production') {
      console.error('❌ SEGURIDAD: API_KEY no configurada en producción. Bloqueando petición.');
      return res.status(500).json({
        success: false,
        error: 'Error de configuración: se debe definir API_KEY en el servidor de producción.'
      });
    }
    if (!avisoAuthEmitido) {
      console.warn('⚠️ ADVERTENCIA: No se configuró API_KEY. Peticiones permitidas sin auth en desarrollo.');
      avisoAuthEmitido = true;
    }
    return next();
  }

  const headerKey = req.headers['x-api-key'];
  const authHeader = req.headers.authorization;
  let bearerKey = null;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    bearerKey = authHeader.substring(7).trim();
  }

  const token = (headerKey ? String(headerKey).trim() : bearerKey) || '';

  if (!token || !clavesValidas.includes(token)) {
    return res.status(401).json({
      success: false,
      error: 'No autorizado. Proporcione una clave API válida en el header X-API-Key o Authorization: Bearer <key>.'
    });
  }

  next();
}

// Ruta base de prueba / información
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    message: 'API Biblioteca Eclesiástica activa',
    endpoints: {
      liveness_hosting: 'GET /healthz',
      readiness_atlas: 'GET /api/salud',
      listar_libros: 'GET /api/libros (requiere autenticación)',
      obtener_libro: 'GET /api/libros/:id (requiere autenticación)',
      guardar_o_actualizar: 'POST /api/libros (requiere autenticación)',
      eliminar_libro: 'DELETE /api/libros/:id (requiere autenticación)',
      transcribir_imagen: 'POST /api/transcribir (requiere autenticación)'
    }
  });
});

// GET /healthz - Liveness probe para hosting (Render, Railway, Fly, etc.).
// Responde 200 inmediatamente si el proceso vive, sin consultar la base de datos.
// Esto evita reinicios continuos del contenedor si Atlas tarda en despertar.
app.get('/healthz', (req, res) => {
  res.status(200).json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// GET /api/salud - Readiness probe: Distingue "servidor caído" de "Atlas no disponible".
// El servidor HTTP siempre responde; el 503 solo indica que la base de datos
// (típicamente un cluster M0 pausado) todavía no está lista.
app.get('/api/salud', async (req, res) => {
  if (estadoConexion().mongo !== 'conectado') {
    // Aprovecha la petición para forzar un intento de conexión.
    try {
      await getCollection();
    } catch (_) {
      /* el error ya quedó registrado en db.js */
    }
  }
  const estado = estadoConexion();
  res.status(estado.mongo === 'conectado' ? 200 : 503).json({
    success: estado.mongo === 'conectado',
    servidor: 'ok',
    ...estado
  });
});

// POST /api/transcribir - Transcripción con IA ejecutada en el backend
app.post('/api/transcribir', verificarAutenticacion, async (req, res) => {
  try {
    const { imagen, mimeType = 'image/jpeg' } = req.body || {};
    if (!imagen) {
      return res.status(400).json({
        success: false,
        error: 'Debe enviar la imagen en base64 en el campo "imagen".'
      });
    }

    const resultado = await transcribirConGemini({
      imagenBase64: imagen,
      mimeType
    });

    res.json({
      success: true,
      texto: resultado.texto,
      motor: `Gemini (${resultado.modelo})`
    });
  } catch (error) {
    console.error('Error al transcribir con Gemini en backend:', error);
    res.status(error.status || 500).json({
      success: false,
      error: error.message || 'Error al procesar transcripción en backend.'
    });
  }
});

// GET /api/libros - Obtener lista paginada de libros
app.get('/api/libros', verificarAutenticacion, async (req, res) => {
  try {
    const collection = await getCollection();
    const { busqueda, iglesia, autor, limit = 50, skip = 0 } = req.query;

    let query = {};
    if (busqueda) {
      const rx = new RegExp(escaparRegex(busqueda), 'i');
      query.$or = [
        { titulo: rx },
        { autor: rx },
        { iglesia: rx },
        { isbn_o_codigo: rx },
        { tipo_libro: rx },
        { palabras_clave: rx }
      ];
    }
    if (iglesia) query.iglesia = { $regex: escaparRegex(iglesia), $options: 'i' };
    if (autor) query.autor = { $regex: escaparRegex(autor), $options: 'i' };

    const skipNum = Math.max(0, Number(skip) || 0);
    const limitNum = Math.min(200, Math.max(1, Number(limit) || 50));

    const total = await collection.countDocuments(query);
    const libros = await collection
      .find(query)
      .project({ paginas: 0 }) // Excluir páginas para listado ligero
      .sort({ fecha_procesamiento: -1 })
      .skip(skipNum)
      .limit(limitNum)
      .toArray();

    res.json({
      success: true,
      total,
      count: libros.length,
      skip: skipNum,
      limit: limitNum,
      hasMore: skipNum + libros.length < total,
      data: libros
    });
  } catch (error) {
    console.error('Error al consultar libros:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/libros/:id - Detalle completo por _id o isbn_o_codigo
app.get('/api/libros/:id', verificarAutenticacion, async (req, res) => {
  try {
    const collection = await getCollection();
    const id = String(req.params.id);

    const libro = await collection.findOne({
      $or: [{ _id: id }, { isbn_o_codigo: id }]
    });

    if (!libro) {
      return res.status(404).json({ success: false, message: 'Libro no encontrado' });
    }

    res.json({ success: true, data: libro });
  } catch (error) {
    console.error('Error al obtener libro:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/libros - Guardar o actualizar libro con upsert=true
app.post('/api/libros', verificarAutenticacion, async (req, res) => {
  try {
    const collection = await getCollection();
    const libroData = { ...(req.body || {}) };

    if (!libroData._id && !libroData.isbn_o_codigo && !libroData.titulo) {
      return res.status(400).json({
        success: false,
        message: 'Datos insuficientes. Se requiere al menos _id, isbn_o_codigo o titulo.'
      });
    }

    // `_id` es inmutable en MongoDB: nunca puede viajar dentro de $set.
    // Se separa para usarlo como filtro y como $setOnInsert.
    const { _id, ...resto } = libroData;
    const idNormalizado = _id != null ? String(_id) : null;

    const filter = idNormalizado
      ? { _id: idNormalizado }
      : { isbn_o_codigo: libroData.isbn_o_codigo || libroData.titulo };

    if (!resto.fecha_procesamiento) {
      resto.fecha_procesamiento = new Date().toISOString();
    }

    if (Array.isArray(resto.paginas) && !resto.caracteres_totales) {
      resto.caracteres_totales = resto.paginas.reduce(
        (acc, p) => acc + (p && p.texto ? p.texto.length : 0),
        0
      );
    }

    const updateDoc = { $set: resto };
    if (idNormalizado) {
      // Solo aplica cuando el documento no existe todavía.
      updateDoc.$setOnInsert = { _id: idNormalizado };
    }

    const result = await collection.updateOne(filter, updateDoc, { upsert: true });

    res.status(result.upsertedCount > 0 ? 201 : 200).json({
      success: true,
      message: result.upsertedCount > 0 ? 'Libro creado exitosamente' : 'Libro actualizado exitosamente',
      upsertedId: result.upsertedId || idNormalizado || filter.isbn_o_codigo || null,
      matchedCount: result.matchedCount,
      modifiedCount: result.modifiedCount
    });
  } catch (error) {
    console.error('Error al guardar/actualizar libro:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE /api/libros/:id - Eliminar libro
app.delete('/api/libros/:id', verificarAutenticacion, async (req, res) => {
  try {
    const collection = await getCollection();
    const id = String(req.params.id);

    const result = await collection.deleteOne({
      $or: [{ _id: id }, { isbn_o_codigo: id }]
    });

    if (result.deletedCount === 0) {
      return res.status(404).json({ success: false, message: 'Libro no encontrado para eliminar' });
    }

    res.json({ success: true, message: 'Libro eliminado exitosamente' });
  } catch (error) {
    console.error('Error al eliminar libro:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Iniciar servidor.
async function startServer() {
  app.listen(PORT, HOST, () => {
    console.log(`🚀 API escuchando en http://${HOST}:${PORT}`);
    console.log('   Liveness hosting: GET /healthz');
    console.log('   Salud Atlas:      GET /api/salud');
    if (process.env.PUBLIC_URL) {
      console.log(`   URL pública:      ${process.env.PUBLIC_URL}`);
    }
  });

  (async () => {
    while (true) {
      try {
        await connectDB({ reintentos: 1 });
        break;
      } catch (e) {
        console.warn(
          `⚠️  Atlas no disponible: ${e.message}. El servidor sigue aceptando peticiones; reintento en 15s...`
        );
        await new Promise((r) => setTimeout(r, 15000));
      }
    }
  })();

  iniciarKeepalive();
}

for (const senal of ['SIGINT', 'SIGTERM']) {
  process.on(senal, async () => {
    console.log('\n👋 Cerrando servidor...');
    await cerrar();
    process.exit(0);
  });
}

// Iniciar servidor solo si es ejecutado directamente
if (require.main === module) {
  startServer();
}

module.exports = app;
