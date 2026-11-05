import fs from 'fs';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Se usa para que el login tarde igual exista o no el email
const DUMMY_HASH = bcrypt.hashSync('dummy-password', 10);

const ROLES = ['capitan', 'organizador'];

// Frena la fuerza bruta sobre la contraseña actual: 5 errores cada 15 minutos por usuario
const MAX_INTENTOS = 5;
const VENTANA_MS = 15 * 60 * 1000;

class UsuariosManager {
    constructor(path) {
        this.path = path;
        this.usuarios = JSON.parse(fs.readFileSync(path));
        this.intentos = new Map(); // userId -> { n, desde }
    }

    save() {
        return fs.promises.writeFile(this.path, JSON.stringify(this.usuarios, null, 4));
    }

    // Nunca devolvemos el hash ni la version de sesion
    publico({ passwordHash, tokenVersion, ...rest }) {
        // Las cuentas anteriores a los roles eran todas de organizador
        return { ...rest, rol: rest.rol ?? 'organizador' };
    }

    getRaw(id) {
        return this.usuarios.find(x => x.id === id) || null;
    }

    getById(id) {
        const u = this.usuarios.find(x => x.id === id);
        return u ? this.publico(u) : null;
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
        const usuario = this.usuarios.find(u => u.id === id);
        if (!usuario) return { error: 'No se encontró la cuenta' };

        nombre = String(nombre ?? '').trim();
        email = String(email ?? '').trim().toLowerCase();

        if (!nombre || nombre.length > 60) return { error: 'Ingresá tu nombre (hasta 60 caracteres)' };
        if (!EMAIL_RE.test(email)) return { error: 'El email no es válido' };

        const cambiaEmail = email !== usuario.email;

        if (cambiaEmail) {
            const check = await this.verificarPassword(usuario, password);
            if (check.error) return check;
        }

        // Se chequea despues del await para que dos pedidos simultaneos no dupliquen el email
        if (this.usuarios.some(u => u.id !== id && u.email === email)) return { error: 'Ya existe una cuenta con ese email' };

        usuario.nombre = nombre;
        usuario.email = email;
        await this.save();

        return this.publico(usuario);
    }

    async cambiarPassword(id, { actual, nueva } = {}) {
        const usuario = this.usuarios.find(u => u.id === id);
        if (!usuario) return { error: 'No se encontró la cuenta' };

        nueva = String(nueva ?? '');
        if (nueva.length < 8 || nueva.length > 72) return { error: 'La contraseña nueva debe tener entre 8 y 72 caracteres' };

        const check = await this.verificarPassword(usuario, actual);
        if (check.error) return check;

        if (await bcrypt.compare(nueva, usuario.passwordHash)) return { error: 'La contraseña nueva tiene que ser distinta de la actual' };

        usuario.passwordHash = await bcrypt.hash(nueva, 10);
        usuario.tokenVersion = (usuario.tokenVersion ?? 0) + 1; // cierra las sesiones abiertas en otros dispositivos
        await this.save();

        return { ok: true };
    }

    // Invalida todos los tokens emitidos hasta ahora (incluido el de este dispositivo)
    async cerrarSesiones(id) {
        const usuario = this.getRaw(id);
        if (!usuario) return { error: 'No se encontró la cuenta' };

        usuario.tokenVersion = (usuario.tokenVersion ?? 0) + 1;
        await this.save();

        return { ok: true };
    }

    // Verifica la contraseña (con tope de intentos) y, si es correcta, borra la cuenta.
    // Quien llama borra antes lo que depende de la cuenta (equipo u organizacion).
    async confirmarPassword(id, password) {
        const usuario = this.getRaw(id);
        if (!usuario) return { error: 'No se encontró la cuenta' };

        return this.verificarPassword(usuario, password);
    }

    async eliminar(id) {
        this.usuarios = this.usuarios.filter(u => u.id !== id);
        this.intentos.delete(id);
        await this.save();

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

        const passwordHash = await bcrypt.hash(password, 10);

        // Se chequea despues del await para que dos registros simultaneos no dupliquen el email
        if (this.usuarios.some(u => u.email === email)) return { error: 'Ya existe una cuenta con ese email' };

        const usuario = {
            id: `USR-${randomUUID().slice(0, 8)}`,
            nombre, email, passwordHash, rol,
            creado: new Date().toISOString(),
        };

        this.usuarios.push(usuario);
        await this.save();

        return this.publico(usuario);
    }

    async login({ email, password } = {}) {
        const usuario = this.usuarios.find(u => u.email === String(email ?? '').trim().toLowerCase());
        const ok = await bcrypt.compare(String(password ?? ''), usuario?.passwordHash ?? DUMMY_HASH);

        if (!usuario || !ok) return { error: 'Email o contraseña incorrectos' };

        return this.publico(usuario);
    }
}

export default UsuariosManager;
