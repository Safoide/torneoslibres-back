import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { q, esDuplicado } from '../db/index.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Se usa para que el login tarde igual exista o no el email
const DUMMY_HASH = bcrypt.hashSync('dummy-password', 10);

const ROLES = ['capitan', 'organizador'];
const EMAIL_REPETIDO = { error: 'Ya existe una cuenta con ese email' };

// Frena la fuerza bruta sobre la contraseña actual: 5 errores cada 15 minutos por usuario
const MAX_INTENTOS = 5;
const VENTANA_MS = 15 * 60 * 1000;

class UsuariosManager {
    constructor() {
        this.intentos = new Map(); // userId -> { n, desde }
    }

    // Nunca devolvemos el hash ni la version de sesion
    publico({ passwordHash, tokenVersion, ...rest }) {
        // Las cuentas anteriores a los roles eran todas de organizador
        return { ...rest, rol: rest.rol ?? 'organizador' };
    }

    async getRaw(id) {
        return (await q().selectFrom('usuarios').selectAll().where('id', '=', String(id ?? '')).executeTakeFirst()) ?? null;
    }

    async getById(id) {
        const u = await this.getRaw(id);
        return u ? this.publico(u) : null;
    }

    async getByEmail(email) {
        return (await q().selectFrom('usuarios').selectAll().where('email', '=', email).executeTakeFirst()) ?? null;
    }

    // Verifica la contraseña actual con tope de intentos fallidos
    async verificarPassword(usuario, password) {
        const ahora = Date.now();
        const reg = this.intentos.get(usuario.id);
        const vigente = reg && ahora - reg.desde < VENTANA_MS ? reg : { n: 0, desde: ahora };

        if (vigente.n >= MAX_INTENTOS) return { error: 'Demasiados intentos. Probá de nuevo en unos minutos.' };

        const ok = await bcrypt.compare(String(password ?? ''), usuario.passwordHash);
        if (!ok) {
            this.intentos.set(usuario.id, { n: vigente.n + 1, desde: vigente.desde });
            return { error: 'La contraseña actual no es correcta' };
        }

        this.intentos.delete(usuario.id);
        return { ok: true };
    }

    // Editar nombre y/o email. Cambiar el email exige la contraseña actual.
    async actualizar(id, { nombre, email, password } = {}) {
        const usuario = await this.getRaw(id);
        if (!usuario) return { error: 'No se encontró la cuenta' };

        nombre = String(nombre ?? '').trim();
        email = String(email ?? '').trim().toLowerCase();

        if (!nombre || nombre.length > 60) return { error: 'Ingresá tu nombre (hasta 60 caracteres)' };
        if (!EMAIL_RE.test(email)) return { error: 'El email no es válido' };

        if (email !== usuario.email) {
            const check = await this.verificarPassword(usuario, password);
            if (check.error) return check;
        }

        try {
            // El email es UNIQUE en la base: dos pedidos simultaneos no pueden quedarse con el mismo
            await q().updateTable('usuarios').set({ nombre, email }).where('id', '=', id).execute();
        } catch (err) {
            if (esDuplicado(err)) return EMAIL_REPETIDO;
            throw err;
        }

        return this.getById(id);
    }

    async cambiarPassword(id, { actual, nueva } = {}) {
        const usuario = await this.getRaw(id);
        if (!usuario) return { error: 'No se encontró la cuenta' };

        nueva = String(nueva ?? '');
        if (nueva.length < 8 || nueva.length > 72) return { error: 'La contraseña nueva debe tener entre 8 y 72 caracteres' };

        const check = await this.verificarPassword(usuario, actual);
        if (check.error) return check;

        if (await bcrypt.compare(nueva, usuario.passwordHash)) return { error: 'La contraseña nueva tiene que ser distinta de la actual' };

        const hash = await bcrypt.hash(nueva, 10);
        // Subir la version de sesion cierra las sesiones abiertas en otros dispositivos
        await q().updateTable('usuarios')
            .set((eb) => ({ passwordHash: hash, tokenVersion: eb('tokenVersion', '+', 1) }))
            .where('id', '=', id).execute();

        return { ok: true };
    }

    // Invalida todos los tokens emitidos hasta ahora (incluido el de este dispositivo)
    async cerrarSesiones(id) {
        const r = await q().updateTable('usuarios').set((eb) => ({ tokenVersion: eb('tokenVersion', '+', 1) })).where('id', '=', id).executeTakeFirst();
        if (!Number(r.numUpdatedRows)) return { error: 'No se encontró la cuenta' };

        return { ok: true };
    }

    // Verifica la contraseña (con tope de intentos). Quien llama borra antes lo que depende de la cuenta.
    async confirmarPassword(id, password) {
        const usuario = await this.getRaw(id);
        if (!usuario) return { error: 'No se encontró la cuenta' };

        return this.verificarPassword(usuario, password);
    }

    async eliminar(id) {
        await q().deleteFrom('usuarios').where('id', '=', id).execute();
        this.intentos.delete(id);

        return { ok: true };
    }

    async registrar({ nombre, email, password, rol } = {}) {
        nombre = String(nombre ?? '').trim();
        email = String(email ?? '').trim().toLowerCase();
        password = String(password ?? '');

        if (!ROLES.includes(rol)) return { error: 'Elegí si tu cuenta es de capitán o de organizador' };
        if (!nombre || nombre.length > 60) return { error: 'Ingresá tu nombre (hasta 60 caracteres)' };
        if (!EMAIL_RE.test(email)) return { error: 'El email no es válido' };
        if (password.length < 8 || password.length > 72) return { error: 'La contraseña debe tener entre 8 y 72 caracteres' };

        const usuario = {
            id: `USR-${randomUUID().slice(0, 8)}`,
            nombre, email, passwordHash: await bcrypt.hash(password, 10), rol,
            creado: new Date().toISOString(),
            tokenVersion: 0,
        };

        try {
            await q().insertInto('usuarios').values(usuario).execute();
        } catch (err) {
            if (esDuplicado(err)) return EMAIL_REPETIDO;
            throw err;
        }

        return this.publico(usuario);
    }

    async login({ email, password } = {}) {
        const usuario = await this.getByEmail(String(email ?? '').trim().toLowerCase());
        const ok = await bcrypt.compare(String(password ?? ''), usuario?.passwordHash ?? DUMMY_HASH);

        if (!usuario || !ok) return { error: 'Email o contraseña incorrectos' };

        return this.publico(usuario);
    }
}

export default UsuariosManager;
