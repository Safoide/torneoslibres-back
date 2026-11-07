import bcrypt from 'bcryptjs';
import { randomUUID, randomBytes, createHash } from 'crypto';
import { q, tx, esDuplicado } from '../db/index.js';
import { verificarGoogle } from '../services/googleService.js';
import { preferenciasDe, limpiarPreferencias } from '../services/notificacionesService.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Se usa para que el login tarde igual exista o no el email
const DUMMY_HASH = bcrypt.hashSync('dummy-password', 10);

const ROLES = ['capitan', 'organizador'];
const EMAIL_REPETIDO = { error: 'Ya existe una cuenta con ese email', yaExiste: true };
const SIN_PASSWORD = 'Tu cuenta entra con Google y todavía no tiene contraseña. Creá una en "Cambiar contraseña".';

// Frena la fuerza bruta sobre la contraseña actual: 5 errores cada 15 minutos por usuario
const MAX_INTENTOS = 5;
const VENTANA_MS = 15 * 60 * 1000;

// Recuperar contraseña: el link vale 1 hora y una sola vez. En la base va solo el hash del token
const VIGENCIA_LINK_MS = 60 * 60 * 1000;
const LINK_INVALIDO = 'El link no es válido o ya venció. Pedí uno nuevo.';
const hashToken = (token) => createHash('sha256').update(String(token)).digest('hex');
// Verificar el email: el link vale 48 horas y una sola vez
const VIGENCIA_VERIFICACION_MS = 48 * 60 * 60 * 1000;
const LINK_VERIFICACION_INVALIDO = 'El link no es válido o ya venció. Pedí uno nuevo desde tu cuenta.';
const TOKEN_RE = /^[A-Za-z0-9_-]{20,100}$/;

// Novedades y promociones: solo si lo eligió (true explícito), guardando cuándo
const consentimiento = (novedades) => (novedades === true
    ? { novedades: 1, novedadesFecha: new Date().toISOString() }
    : { novedades: 0, novedadesFecha: null });

class UsuariosManager {
    constructor() {
        this.intentos = new Map(); // userId -> { n, desde }
    }

    // Nunca devolvemos el hash, la version de sesion ni el id de Google: solo si tiene contraseña y si entra con Google.
    // Las preferencias de notificaciones van aparte (GET /auth/notificaciones)
    publico({ passwordHash, tokenVersion, googleId, emailVerificado, notificaciones, novedades, novedadesFecha, ...rest }) {
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
            // Los links de recuperacion mandados al email anterior dejan de valer
            if (email !== usuario.email) {
                await q().deleteFrom('password_tokens').where('usuarioId', '=', id).execute();
                await q().deleteFrom('verificacion_tokens').where('usuarioId', '=', id).execute();
            }
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
        await tx(async () => {
            await q().deleteFrom('password_tokens').where('usuarioId', '=', id).execute();
            await q().deleteFrom('verificacion_tokens').where('usuarioId', '=', id).execute();
            await q().deleteFrom('usuarios').where('id', '=', id).execute();
        });
        this.intentos.delete(id);

        return { ok: true };
    }

    // ---------- Notificaciones ----------

    async preferencias(id) {
        const usuario = await this.getRaw(id);
        return usuario ? preferenciasDe(usuario) : null;
    }

    // body: { avisos?: { tipo: bool }, novedades?: bool }. El front manda todos los avisos juntos
    // (así dos cambios seguidos no se pisan a medias). Devuelve las preferencias como quedaron
    async guardarPreferencias(id, body) {
        const usuario = await this.getRaw(id);
        if (!usuario) return { error: 'No se encontró la cuenta' };

        const p = limpiarPreferencias(usuario, body);
        if (p.error) return p;

        const cambios = { notificaciones: JSON.stringify(p.notificaciones) };
        // La fecha del consentimiento solo cambia si cambió la elección
        if (p.novedades !== undefined && p.novedades !== !!usuario.novedades) Object.assign(cambios, consentimiento(p.novedades));

        await q().updateTable('usuarios').set(cambios).where('id', '=', id).execute();
        return this.preferencias(id);
    }

    // ---------- Verificar el email ----------

    // Crea un link de un solo uso para el email actual de la cuenta (invalida los anteriores).
    // Devuelve { usuario, token } para que quien llama mande el mail, o { yaVerificado } | { error }
    async pedirVerificacion(id) {
        const usuario = await this.getRaw(id);
        if (!usuario) return { error: 'No se encontró la cuenta' };
        if (usuario.emailVerificado) return { yaVerificado: true };

        const token = randomBytes(32).toString('base64url');
        const ahora = new Date();
        await tx(async () => {
            await q().deleteFrom('verificacion_tokens')
                .where((eb) => eb.or([eb('usuarioId', '=', usuario.id), eb('vence', '<', ahora.toISOString())]))
                .execute();
            await q().insertInto('verificacion_tokens').values({
                tokenHash: hashToken(token), usuarioId: usuario.id, email: usuario.email,
                vence: new Date(ahora.getTime() + VIGENCIA_VERIFICACION_MS).toISOString(), creado: ahora.toISOString(),
            }).execute();
        });

        return { usuario: this.publico(usuario), token };
    }

    // Usa el link: marca el email como verificado si sigue siendo el de la cuenta. Devuelve { ok, email, userId } | { error }
    async verificarEmail(token) {
        if (!TOKEN_RE.test(String(token ?? ''))) return { error: LINK_VERIFICACION_INVALIDO };

        return tx(async () => {
            const fila = await q().selectFrom('verificacion_tokens').selectAll()
                .where('tokenHash', '=', hashToken(token)).where('vence', '>', new Date().toISOString())
                .executeTakeFirst();
            if (!fila) return { error: LINK_VERIFICACION_INVALIDO };

            await q().deleteFrom('verificacion_tokens').where('tokenHash', '=', fila.tokenHash).execute();
            // Condicional: solo si la cuenta todavía tiene ese email (si lo cambió, el link era para el anterior)
            const r = await q().updateTable('usuarios').set({ emailVerificado: 1 })
                .where('id', '=', fila.usuarioId).where('email', '=', fila.email).executeTakeFirst();
            if (!Number(r.numUpdatedRows)) return { error: 'Cambiaste el email de tu cuenta: pedí un link nuevo para el email actual.' };

            await q().deleteFrom('verificacion_tokens').where('usuarioId', '=', fila.usuarioId).execute();
            return { ok: true, email: fila.email, userId: fila.usuarioId };
        });
    }

    // ---------- Recuperar contraseña ----------

    // Crea un link de un solo uso para la cuenta con ese email. Si no hay cuenta devuelve { ok } igual
    // (la ruta responde lo mismo exista o no). Pedir uno nuevo invalida los anteriores.
    // Devuelve { ok, usuario?, token? }: quien llama manda el mail (fuera de la transacción)
    async pedirRecuperacion(email) {
        email = String(email ?? '').trim().toLowerCase();
        if (!EMAIL_RE.test(email)) return { error: 'El email no es válido' };

        const usuario = await this.getByEmail(email);
        if (!usuario) return { ok: true };

        const token = randomBytes(32).toString('base64url');
        const ahora = new Date();
        await tx(async () => {
            // Los anteriores de la cuenta y, de paso, los vencidos de todos
            await q().deleteFrom('password_tokens')
                .where((eb) => eb.or([eb('usuarioId', '=', usuario.id), eb('vence', '<', ahora.toISOString())]))
                .execute();
            await q().insertInto('password_tokens').values({
                tokenHash: hashToken(token), usuarioId: usuario.id,
                vence: new Date(ahora.getTime() + VIGENCIA_LINK_MS).toISOString(), creado: ahora.toISOString(),
            }).execute();
        });

        return { ok: true, usuario: this.publico(usuario), token };
    }

    // La cuenta del link, si sigue vigente (o null)
    async cuentaDelLink(token) {
        if (!TOKEN_RE.test(String(token ?? ''))) return null;

        const fila = await q().selectFrom('password_tokens').selectAll()
            .where('tokenHash', '=', hashToken(token)).where('vence', '>', new Date().toISOString())
            .executeTakeFirst();
        return fila ? this.getRaw(fila.usuarioId) : null;
    }

    // Para que el front muestre el formulario solo si el link sirve
    async revisarLink(token) {
        const usuario = await this.cuentaDelLink(token);
        if (!usuario) return { error: LINK_INVALIDO };
        return { ok: true, email: usuario.email, tienePassword: !!usuario.passwordHash };
    }

    // Pone la contraseña nueva. Usa el link (una sola vez), cierra las sesiones abiertas y marca el email
    // como verificado (el link llegó a ese email). Devuelve { ok, userId } | { error }
    async restablecerPassword({ token, nueva } = {}) {
        nueva = String(nueva ?? '');
        if (nueva.length < 8 || nueva.length > 72) return { error: 'La contraseña nueva debe tener entre 8 y 72 caracteres' };

        const usuario = await this.cuentaDelLink(token);
        if (!usuario) return { error: LINK_INVALIDO };

        const hash = await bcrypt.hash(nueva, 10); // lento: fuera de la transaccion

        const r = await tx(async () => {
            // Condicional: si dos pedidos usan el mismo link a la vez, solo uno lo consume
            const usado = await q().deleteFrom('password_tokens')
                .where('tokenHash', '=', hashToken(token)).where('vence', '>', new Date().toISOString())
                .executeTakeFirst();
            if (!Number(usado.numDeletedRows)) return { error: LINK_INVALIDO };

            await q().deleteFrom('password_tokens').where('usuarioId', '=', usuario.id).execute();
            await q().updateTable('usuarios')
                .set((eb) => ({ passwordHash: hash, emailVerificado: 1, tokenVersion: eb('tokenVersion', '+', 1) }))
                .where('id', '=', usuario.id).execute();
            return { ok: true, userId: usuario.id };
        });

        if (r.ok) this.intentos.delete(usuario.id);
        return r;
    }

    async registrar({ nombre, email, password, rol, novedades } = {}) {
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
            ...consentimiento(novedades),
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
    // opciones.novedades: si al crear la cuenta eligió recibir novedades (no cambia una cuenta que ya existe)
    async entrarConGoogle(perfil, rol, opciones = {}, intento = 0) {
        const { googleId, email, nombre } = perfil;
        // Reintento por si otro pedido (doble clic) vinculo o creo la cuenta al mismo tiempo
        const reintentar = () => (intento < 2
            ? this.entrarConGoogle(perfil, rol, opciones, intento + 1)
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
            ...consentimiento(opciones.novedades),
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
