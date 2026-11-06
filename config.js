import fs from 'fs';
import path from 'path';

// Dónde viven los datos. En desarrollo: ./databases (la base SQLite) y ./uploads.
// En el servidor van FUERA del código (DATA_DIR / UPLOADS_DIR), así un deploy nunca pisa los datos reales.
export const DATA_DIR = process.env.DATA_DIR || './databases';
export const UPLOADS_DIR = process.env.UPLOADS_DIR || './uploads';

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// Logo subido por nuestro endpoint (/uploads/<uuid>.<ext>) y que el archivo exista en UPLOADS_DIR
// (no en ./uploads: en el servidor los uploads viven fuera del código)
const LOGO_RE = /^\/uploads\/([0-9a-f-]{36}\.(png|jpg|webp))$/;
export const logoValido = (url) => {
    const m = LOGO_RE.exec(String(url ?? ''));
    return !!m && fs.existsSync(path.join(UPLOADS_DIR, m[1]));
};
