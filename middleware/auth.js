import jwt from 'jsonwebtoken';
import { createHmac, timingSafeEqual } from 'crypto';
import { usuariosManager } from '../manager/instances.js';

// En producción el secreto TIENE que venir de una variable de entorno
const SECRET = process.env.JWT_SECRET || (process.env.NODE_ENV === 'production' ? null : 'dev-secret-cambiar');
if (!SECRET) throw new Error('Falta la variable de entorno JWT_SECRET');

// Firma corta (HMAC) para links que se usan sin iniciar sesión, como darse de baja de un aviso por mail
export const firmar = (texto) => createHmac('sha256', SECRET).update(String(texto)).digest('base64url').slice(0, 32);
export const firmaValida = (texto, firma) => {
    const esperada = Buffer.from(firmar(texto));
    const recibida = Buffer.from(String(firma ?? ''));
    return esperada.length === recibida.length && timingSafeEqual(esperada, recibida);
};

// `v` es la version de sesion de la cuenta: al cerrar sesiones en todos los dispositivos o cambiar la contraseña sube,
// y los tokens anteriores dejan de valer
export const signToken = async (user) =>
    jwt.sign({ sub: user.id, rol: user.rol, v: (await usuariosManager.getRaw(user.id))?.tokenVersion ?? 0 }, SECRET, { expiresIn: '7d' });

export const requireAuth = async (req, res, next) => {
    const [type, token] = (req.headers.authorization || '').split(' ');

    if (type !== 'Bearer' || !token) return res.status(401).json({ error: 'Tenés que iniciar sesión' });

    let payload;
    try {
        payload = jwt.verify(token, SECRET);
    } catch {
        return res.status(401).json({ error: 'Sesión vencida, iniciá sesión de nuevo' });
    }

    // Un error de la base aca no es "sesion vencida": lo maneja el Router (error 500)
    const cuenta = await usuariosManager.getRaw(payload.sub);

    if (!cuenta) return res.status(401).json({ error: 'La cuenta ya no existe' });
    if ((payload.v ?? 0) !== (cuenta.tokenVersion ?? 0)) return res.status(401).json({ error: 'Sesión vencida, iniciá sesión de nuevo' });

    req.userId = payload.sub;
    req.rol = payload.rol ?? 'organizador'; // las cuentas anteriores a los roles eran de organizador
    next();
};

export const requireRol = (rol) => (req, res, next) => {
    if (req.rol !== rol) return res.status(403).json({ error: `Esta acción es solo para cuentas de ${rol}` });
    next();
};