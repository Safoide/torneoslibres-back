// Pasa los datos de los JSON viejos (databases/*.json) a la base SQLite.
//
// Uso:  node scripts/importar-json.mjs [carpeta-de-los-json] [--forzar]
//   - Por defecto lee ./databases y escribe en la base de DATA_DIR (en local: databases/torneoslibres.db).
//   - Si la base ya tiene datos no hace nada, salvo con --forzar (que reemplaza TODO lo que tenga la base).
//   - Antes de reemplazar hace una copia de la base en databases/backup-<fecha>.db.
//
// En producción NO hace falta: la base arranca vacía.

import fs from 'fs';
import path from 'path';

const args = process.argv.slice(2);
const forzar = args.includes('--forzar');
const carpeta = args.find((a) => !a.startsWith('--')) ?? './databases';

const { migrar, copiarBase, cerrar, q, DB_FILE } = await import('../db/index.js');
const { reemplazarTodo, COLECCIONES } = await import('../db/datos.js');

await migrar();

const hay = await q().selectFrom('usuarios').select('id').executeTakeFirst()
    ?? await q().selectFrom('torneos').select('id').executeTakeFirst();
if (hay && !forzar) {
    console.error(`La base (${DB_FILE}) ya tiene datos: no importo nada. Si querés reemplazarlos por los de los JSON, corré de nuevo con --forzar.`);
    await cerrar();
    process.exit(1);
}

const datos = {};
for (const c of COLECCIONES) {
    const archivo = path.join(carpeta, `${c}.json`);
    datos[c] = fs.existsSync(archivo) ? JSON.parse(fs.readFileSync(archivo, 'utf8')) : [];
}

if (hay) {
    const copia = path.join(path.dirname(DB_FILE), `backup-${Date.now()}.db`);
    await copiarBase(copia);
    console.log('Copia de la base anterior en', copia);
}

const cargados = await reemplazarTodo(datos);
console.log(`Importado desde ${carpeta} a ${DB_FILE}:`);
console.table(cargados);

await cerrar();
