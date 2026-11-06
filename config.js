import fs from 'fs';
import path from 'path';

// Dónde viven los datos. En desarrollo: ./databases y ./uploads (como siempre).
// En el servidor van FUERA del código (DATA_DIR / UPLOADS_DIR), así un deploy nunca pisa los datos reales.
export const DATA_DIR = process.env.DATA_DIR || './databases';
export const UPLOADS_DIR = process.env.UPLOADS_DIR || './uploads';

export const dataPath = (archivo) => path.join(DATA_DIR, archivo);

const ARCHIVOS = [
    'torneos.json', 'equipos.json', 'organizadores.json', 'clubes.json', 'usuarios.json', 'partidos.json',
    'fechas.json', 'inscripciones.json', 'amistosos.json', 'multas.json', 'jugadores.json',
];

// Con una carpeta de datos nueva (primer deploy) cada archivo arranca como lista vacía
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOADS_DIR, { recursive: true });
for (const archivo of ARCHIVOS) {
    const p = dataPath(archivo);
    if (!fs.existsSync(p)) fs.writeFileSync(p, '[]');
}
