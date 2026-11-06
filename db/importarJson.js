import fs from 'fs';
import path from 'path';
import { q } from './index.js';
import { reemplazarTodo, COLECCIONES } from './datos.js';
import { DATA_DIR } from '../config.js';

// Paso único de los JSON de antes (DATA_DIR/*.json) a la base SQLite. Corre al arrancar la API:
// solo importa si la base está vacía y hay JSON en DATA_DIR. Después los mueve a DATA_DIR/json-importados-<fecha>/
// para que nunca se vuelvan a importar. Si algo falla, la base queda vacía (es una transacción) y los JSON no se tocan.
export const importarJsonViejos = async () => {
    const archivos = COLECCIONES.map((c) => path.join(DATA_DIR, `${c}.json`)).filter((a) => fs.existsSync(a));
    if (!archivos.length) return;

    const hay = await q().selectFrom('usuarios').select('id').executeTakeFirst()
        ?? await q().selectFrom('torneos').select('id').executeTakeFirst();
    if (hay) {
        console.warn(`Hay JSON viejos en ${DATA_DIR} pero la base ya tiene datos: no los importo.`);
        return;
    }

    const datos = {};
    for (const c of COLECCIONES) {
        const archivo = path.join(DATA_DIR, `${c}.json`);
        datos[c] = fs.existsSync(archivo) ? JSON.parse(fs.readFileSync(archivo, 'utf8') || '[]') : [];
    }
    const cargados = await reemplazarTodo(datos);

    const destino = path.join(DATA_DIR, `json-importados-${Date.now()}`);
    fs.mkdirSync(destino, { recursive: true });
    for (const a of archivos) fs.renameSync(a, path.join(destino, path.basename(a)));
    console.log(`JSON viejos importados a la base (movidos a ${destino}):`, JSON.stringify(cargados));
};
