/**
 * Script de restauración de respaldo en MongoDB Atlas.
 *
 * Uso:
 *   node scripts/restore-db.js <archivo_respaldo.json>
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const { MongoClient } = require('mongodb');

const uri = (process.env.MONGO_URI || '').trim();
const dbName = (process.env.DB_NAME || 'biblioteca_digital').trim();
const collectionName = (process.env.COLLECTION_NAME || 'libros_eclesiasticos').trim();

async function main() {
  const backupFile = process.argv[2];
  if (!backupFile) {
    console.error('❌ Especifica el archivo de respaldo a restaurar:');
    console.error('   node scripts/restore-db.js backups/backup_xxx.json');
    process.exit(1);
  }

  const filePath = path.resolve(process.cwd(), backupFile);
  if (!fs.existsSync(filePath)) {
    console.error(`❌ El archivo no existe: ${filePath}`);
    process.exit(1);
  }

  if (!uri) {
    console.error('❌ MONGO_URI no está definido en backend/.env');
    process.exit(1);
  }

  const rawData = fs.readFileSync(filePath, 'utf-8');
  const backup = JSON.parse(rawData);

  const docs = Array.isArray(backup) ? backup : backup.documentos;
  if (!Array.isArray(docs)) {
    console.error('❌ Estructura de respaldo inválida. Debe contener un array de documentos.');
    process.exit(1);
  }

  console.log(`📡 Conectando a Atlas para restaurar ${docs.length} documento(s)...`);
  const client = new MongoClient(uri);
  await client.connect();

  try {
    const db = client.db(dbName);
    const collection = db.collection(collectionName);

    let insertados = 0;
    let actualizados = 0;

    for (const doc of docs) {
      const { _id, ...resto } = doc;
      const idNormalizado = _id != null ? String(_id) : null;
      const filter = idNormalizado
        ? { _id: idNormalizado }
        : { isbn_o_codigo: doc.isbn_o_codigo || doc.titulo };

      const updateDoc = { $set: resto };
      if (idNormalizado) updateDoc.$setOnInsert = { _id: idNormalizado };

      const res = await collection.updateOne(filter, updateDoc, { upsert: true });
      if (res.upsertedCount > 0) insertados++;
      else if (res.matchedCount > 0) actualizados++;
    }

    console.log(`✅ Restauración completada:`);
    console.log(`   ➕ Nuevos insertados: ${insertados}`);
    console.log(`   🔄 Actualizados: ${actualizados}`);
    console.log(`   📊 Total procesados: ${docs.length}`);
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error('❌ Error en restauración:', err.message);
  process.exit(1);
});
