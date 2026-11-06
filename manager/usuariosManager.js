import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { q, esDuplicado } from '../db/index.js';
import { verificarGoogle } from '../services/googleService.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Se usa para que el login tarde igual exista o no el email
const DUMMY_HASH = bcrypt.hashSync('dummy-password', 10);

const ROLES = ['capitan', 'organizador'];
const EMAIL_REPETIDO = { error: 'Ya existe una cuenta con ese email', yaExiste: true };
const SIN_PASSWORD = 'Tu cuenta entra con Google y todavía no tiene contraseña. Creá una en "Cambiar contraseña".';

// Frena la fuerza bruta sobre la contraseña actual: 5 errores cada 15 minutos por usuario
const MAX_INTENTOS = 5;
const VENTANA_MS = 15 * 60 * 1000;

class UsuariosManager {
    constructor() {
        this.intentos = new Map(); // userId -> { n, desde }
    }

    // Nunca devolvemos el hash, la version de sesion ni el id de Google: solo si tiene contraseña y si entra con Google
    publico({ passwordHash, tokenVersion, googleId, emailVerificado, ...rest }) {
        return {
            ...rest,
            rol: rest.rol ?? 'organizador', // las cuentas anteriores a los roles eran todas de organizador
            tienePassword: !!passwordHash,
            conGoogle: !!googleId,
            emailVerificado: !!emailVerificado,
        };
    }

    async getByGoogleId(googleId) {
        return (await q().selectFrom('usuarios').selectAll().where('googleId', '=', googleId).executeTakeFirst()) ?? null;
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
        if (!usuario.passwordHash) return { error: SIN_PASSWORD };

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
            // Un email nuevo todavia no esta verificado
            await q().updateTable('usuarios').set({ nombre, email, ...(email !== usuario.email ? { emailVerificado: 0 } : {}) }).where('id', '=', id).execute();
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

        // Una cuenta que entra con Google y no tiene contraseña la crea sin pedir la actual (ya tiene la sesion iniciada)
        if (usuario.passwordHash) {
            const check = await this.verificarPassword(usuario, actual);
            if (check.error) return check;

            if (await bcrypt.compare(nueva, usuario.passwordHash)) return { error: 'La contraseña nueva tiene que ser distinta de la actual' };
        }

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

    // Confirma que es el dueño antes de algo delicado (eliminar la cuenta): con la contraseña o,
    // si la cuenta no tiene, volviendo a entrar con su cuenta de Google (credential).
    // Quien llama borra despues lo que depende de la cuenta.
    async confirmarIdentidad(id, { password, credential } = {}) {
        const usuario = await this.getRaw(id);
        if (!usuario) return { error: 'No se encontró la cuenta' };

        if (usuario.passwordHash) return this.verificarPassword(usuario, password);

        if (!credential) return { error: 'Confirmá con tu cuenta de Google' };
        const g = await verificarGoogle(credential);
        if (g.error) return { error: g.error };
        if (g.googleId !== usuario.googleId) return { error: `Elegiste ${g.email}, que no es la cuenta de Google vinculada a tu cuenta. Probá de nuevo con la correcta.` };
        return { ok: true, email: g.email };
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

    // El login avisa si el email no tiene cuenta (para ofrecer crearla) o si la cuenta entra con Google.
    // Revelar que un email existe ya pasaba en el registro ("Ya existe una cuenta con ese email");
    // los limites de middleware/limites.js frenan probar emails en masa.
    async login({ email, password } = {}) {
        const usuario = await this.getByEmail(String(email ?? '').trim().toLowerCase());

        if (!usuario) {
            await bcrypt.compare('x', DUMMY_HASH); // que tarde lo mismo que un login real
            return { error: 'No hay ninguna cuenta con ese email', sinCuenta: true };
        }
        if (!usuario.passwordHash) return { error: 'Esta cuenta se creó con Google: entrá con el botón de Google', soloGoogle: true };
        if (!await bcrypt.compare(String(password ?? ''), usuario.passwordHash)) return { error: 'La contraseña no es correcta' };

        return this.publico(usuario);
    }

    // Entrar (o registrarse) con Google. perfil = lo que devuelve verificarGoogle().
    //  1. Ya vinculada (mismo googleId): entra.
    //  2. Existe una cuenta con ese email: se vincula. Google demuestra que es el dueño del email; si la cuenta
    //     no tenia el email verificado, su contraseña la pudo haber puesto otra persona (alguien que se registro
    //     con un email ajeno): se borra la contraseña y se cierran sus sesiones. Si ya estaba verificado, no se toca.
    //  3. No existe: se crea si viene el tipo de cuenta (rol); si no, se le pide al front que lo pregunte.
    // Devuelve { user, nueva?, vinculada?, passwordBorrada? } | { necesitaRol, email, nombre } | { error }
    async entrarConGoogle(perfil, rol, intento = 0) {
        const { googleId, email, nombre } = perfil;
        // Reintento por si otro pedido (doble clic) vinculo o creo la cuenta al mismo tiempo
        const reintentar = () => (intento < 2
            ? this.entrarConGoogle(perfil, rol, intento + 1)
            : { error: 'No pudimos completar el ingreso. Probá de nuevo.' });

        const vinculada = await this.getByGoogleId(googleId);
        if (vinculada) return { user: this.publico(vinculada) };

        const existente = await this.getByEmail(email);
        if (existente) {
            if (existente.googleId) return { error: 'Ese email ya está vinculado a otra cuenta de Google' };

            const borrar = !existente.emailVerificado && !!existente.passwordHash;
            try {
                // Condicional: si otro pedido la vinculo recien, no se pisa
                const r = await q().updateTable('usuarios')
                    .set((eb) => ({
                        googleId, emailVerificado: 1,
                        ...(borrar ? { passwordHash: null, tokenVersion: eb('tokenVersion', '+', 1) } : {}),
                    }))
                    .where('id', '=', existente.id).where('googleId', 'is', null)
                    .executeTakeFirst();
                if (!Number(r.numUpdatedRows)) return reintentar();
            } catch (err) {
                if (esDuplicado(err)) return reintentar();
                throw err;
            }
            return { user: await this.getById(existente.id), vinculada: true, passwordBorrada: borrar };
        }

        if (!ROLES.includes(rol)) return { necesitaRol: true, email, nombre };

        const usuario = {
            id: `USR-${randomUUID().slice(0, 8)}`,
            nombre: nombre || email.split('@')[0], email, passwordHash: null, rol,
            creado: new Date().toISOString(), tokenVersion: 0, googleId, emailVerificado: 1,
        };
        try {
            await q().insertInto('usuarios').values(usuario).execute();
        } catch (err) {
            if (esDuplicado(err)) return reintentar();
            throw err;
        }
        return { user: this.publico(usuario), nueva: true };
    }
}

export default UsuariosManager;
