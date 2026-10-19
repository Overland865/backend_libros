/**
 * Script de respaldo de la base de datos de MongoDB Atlas a JSON.
 *
 * Uso:
 *   node scripts/backup-db.js [archivo_destino.json]
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const { MongoClient } = require('mongodb');

const uri = (process.env.MONGO_URI || '').trim();
const dbName = (process.env.DB_NAME || 'biblioteca_digital').trim();
const collectionName = (process.env.COLLECTION_NAME || 'libros_eclesiasticos').trim();

async function main() {
  if (!uri) {
    console.error('❌ MONGO_URI no está definido en backend/.env');
    process.exit(1);
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.resolve(__dirname, '../backups');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const targetFile = process.argv[2]
    ? path.resolve(process.cwd(), process.argv[2])
    : path.join(backupDir, `backup_${dbName}_${collectionName}_${timestamp}.json`);

  console.log(`📡 Conectando a Atlas para respaldo...`);
  const client = new MongoClient(uri);
  await client.connect();

  try {
    const db = client.db(dbName);
    const collection = db.collection(collectionName);
    const total = await collection.countDocuments();
    console.log(`📚 Leyendo ${total} documento(s) de ${dbName}.${collectionName}...`);

    const docs = await collection.find({}).toArray();

    const backupPayload = {
      version: '1.0',
      database: dbName,
      collection: collectionName,
      fecha_respaldo: new Date().toISOString(),
      total_documentos: docs.length,
      documentos: docs
    };

    fs.writeFileSync(targetFile, JSON.stringify(backupPayload, null, 2), 'utf-8');
    console.log(`✅ Respaldo completado exitosamente:`);
    console.log(`   📁 Archivo: ${targetFile}`);
    console.log(`   📊 Total respaldado: ${docs.length} libro(s)`);
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error('❌ Error en respaldo:', err.message);
  process.exit(1);
});
