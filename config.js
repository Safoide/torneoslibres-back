import fs from 'fs';
import path from 'path';

// Dónde viven los datos. En desarrollo: ./databases (la base SQLite) y ./uploads.
// En el servidor van FUERA del código (DATA_DIR / UPLOADS_DIR), así un deploy nunca pisa los datos reales.
export const DATA_DIR = process.env.DATA_DIR || './databases';
export const UPLOADS_DIR = process.env.UPLOADS_DIR || './uploads';

// Dirección pública del front, para los links de los mails. Por defecto el primer origen de CORS_ORIGIN
// (en producción, el dominio) y en desarrollo el front local. Nunca se toma del pedido (se podría falsear el Host)
export const SITIO_URL = (process.env.SITIO_URL || process.env.CORS_ORIGIN?.split(',')[0] || 'http://localhost:3000').trim().replace(/\/+$/, '');

// Versión vigente de los términos y condiciones + la política de privacidad (una sola para los dos textos).
// Tiene que ser igual a VERSION_LEGAL de src/assets/legal.js en el front. Al cambiarla, todas las cuentas
// tienen que volver a aceptarlos (el front les muestra el aviso: `terminosPendientes` en /auth/me).
// Subirla solo por cambios importantes: un cambio de redacción no hace falta.
export const TERMINOS_VERSION = '2026-11-07';

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// Logo subido por nuestro endpoint (/uploads/<uuid>.<ext>) y que el archivo exista en UPLOADS_DIR
// (no en ./uploads: en el servidor los uploads viven fuera del código)
const LOGO_RE = /^\/uploads\/([0-9a-f-]{36}\.(png|jpg|webp))$/;
export const logoValido = (url) => {
    const m = LOGO_RE.exec(String(url ?? ''));
    return !!m && fs.existsSync(path.join(UPLOADS_DIR, m[1]));
};
