import { rateLimit, ipKeyGenerator } from 'express-rate-limit';

// Límites de pedidos (frenan fuerza bruta y spam). Se cuentan en memoria: al reiniciar la API arrancan de cero.
// La IP real llega por nginx (ver `trust proxy` en app.js).

const MIN = 60 * 1000;

const limite = ({ ventana, max, mensaje, ...resto }) => rateLimit({
    windowMs: ventana,
    limit: max,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: mensaje },
    ...resto,
});

// Todo lo de la API: un tope alto, solo para cortar abusos
export const limiteGeneral = limite({
    ventana: MIN, max: 600,
    mensaje: 'Demasiados pedidos seguidos. Esperá un minuto y probá de nuevo.',
});

// Login: se cuentan solo los intentos fallidos, por IP y por email (para que no se pueda probar
// contraseñas sobre una cuenta repartiendo los intentos entre muchas IPs)
export const limiteLoginIp = limite({
    ventana: 15 * MIN, max: 20, skipSuccessfulRequests: true,
    mensaje: 'Demasiados intentos de inicio de sesión. Probá de nuevo en 15 minutos.',
});

export const limiteLoginEmail = limite({
    ventana: 15 * MIN, max: 10, skipSuccessfulRequests: true,
    keyGenerator: (req) => `email:${String(req.body?.email ?? '').trim().toLowerCase()}`,
    mensaje: 'Demasiados intentos con esta cuenta. Probá de nuevo en 15 minutos.',
});

export const limiteRegistro = limite({
    ventana: 60 * MIN, max: 5,
    keyGenerator: (req) => ipKeyGenerator(req.ip),
    mensaje: 'Se crearon demasiadas cuentas desde tu conexión. Probá de nuevo en una hora.',
});

// Subida de logos: por cuenta (va después de requireAuth)
export const limiteUploads = limite({
    ventana: 60 * MIN, max: 20,
    keyGenerator: (req) => `user:${req.userId}`,
    mensaje: 'Subiste demasiadas imágenes. Probá de nuevo en una hora.',
});
