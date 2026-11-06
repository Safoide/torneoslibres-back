import { formatId } from '../assets.js';
import { logoValido } from '../config.js';
import { q, tx, esDuplicado, porId, siguienteId } from '../db/index.js';

const HANDLE_RE = /^[A-Za-z0-9._]{1,30}$/;
const NOMBRE_REPETIDO = { error: 'Ya existe una organización con ese nombre' };
const NO_EXISTE = { error: 'No se encontro un organizador con el id especificado' };

class OrganizadoresManager {
    // Cantidad de torneos de cada organizacion: { orgId: n }
    async contarTorneos(orgIds) {
        if (!orgIds.length) return {};
        const filas = await q().selectFrom('torneos')
            .select(['organizadorId', (eb) => eb.fn.countAll().as('n')])
            .where('organizadorId', 'in', orgIds).groupBy('organizadorId').execute();
        return Object.fromEntries(filas.map((f) => [f.organizadorId, Number(f.n)]));
    }

    // No exponemos el ownerId y agregamos la cantidad de torneos
    publico({ ownerId, ...org }, torneos = 0) {
        return { ...org, torneos };
    }

    async conTorneos(org) {
        if (!org) return null;
        return this.publico(org, (await this.contarTorneos([org.id]))[org.id] ?? 0);
    }

    async getAll() {
        const orgs = await porId(q().selectFrom('organizadores').selectAll()).execute();
        const n = await this.contarTorneos(orgs.map((o) => o.id));
        return orgs.map((o) => this.publico(o, n[o.id] ?? 0));
    }

    async getById(id) {
        const org = await q().selectFrom('organizadores').selectAll().where('id', '=', String(id ?? '')).executeTakeFirst();
        return org ? this.conTorneos(org) : NO_EXISTE;
    }

    // La organizacion del usuario (o null si no tiene)
    async miOrganizacion(ownerId) {
        const org = await q().selectFrom('organizadores').selectAll().where('ownerId', '=', String(ownerId ?? '')).executeTakeFirst();
        return this.conTorneos(org);
    }

    // Valida y limpia los campos que puede mandar el usuario
    async limpiar(data = {}, idActual = null) {
        const nombre = String(data.nombre ?? '').trim();
        const zona = String(data.zona ?? '').trim();
        const descripcion = String(data.descripcion ?? '').trim();
        const instagram = String(data.instagram ?? '').trim().replace(/^@/, '');
        const whatsapp = String(data.whatsapp ?? '').replace(/\D/g, '');
        const logo = String(data.logo ?? '').trim();

        if (nombre.length < 3 || nombre.length > 60) return { error: 'El nombre debe tener entre 3 y 60 caracteres' };
        if (!zona || zona.length > 40) return { error: 'Indicá la zona (hasta 40 caracteres)' };
        if (descripcion.length > 300) return { error: 'La descripción puede tener hasta 300 caracteres' };
        if (instagram && !HANDLE_RE.test(instagram)) return { error: 'El usuario de Instagram no es válido (sin @ ni links)' };
        if (whatsapp && (whatsapp.length < 10 || whatsapp.length > 15)) return { error: 'El WhatsApp debe tener entre 10 y 15 dígitos, con código de país' };
        if (logo && !logoValido(logo)) return { error: 'El logo no es válido: subí la imagen de nuevo' };

        // Chequeo amable; la garantia la da el indice unico de la base (lower(nombre))
        const otra = await q().selectFrom('organizadores').select('id')
            .where((eb) => eb(eb.fn('lower', ['nombre']), '=', nombre.toLowerCase()))
            .where('id', '!=', idActual ?? '').executeTakeFirst();
        if (otra) return NOMBRE_REPETIDO;

        return { datos: { nombre, zona, descripcion, instagram, whatsapp, logo } };
    }

    async crear(ownerId, data) {
        if (await this.miOrganizacion(ownerId)) return { error: 'Ya tenés una organización. Solo se puede tener una por cuenta.' };

        const { error, datos } = await this.limpiar(data);
        if (error) return { error };

        try {
            const org = await tx(async () => {
                const nueva = { id: formatId('ORG', await siguienteId('organizadores', 'ORG')), ...datos, ownerId, creada: new Date().toISOString() };
                await q().insertInto('organizadores').values(nueva).execute();
                return nueva;
            });
            return this.publico(org, 0);
        } catch (err) {
            if (esDuplicado(err)) return String(err.message).includes('ownerId') ? { error: 'Ya tenés una organización. Solo se puede tener una por cuenta.' } : NOMBRE_REPETIDO;
            throw err;
        }
    }

    async editar(orgId, data) {
        const org = await q().selectFrom('organizadores').select('id').where('id', '=', orgId).executeTakeFirst();
        if (!org) return NO_EXISTE;

        const { error, datos } = await this.limpiar(data, orgId);
        if (error) return { error };

        try {
            await tx(async () => {
                await q().updateTable('organizadores').set(datos).where('id', '=', orgId).execute();
                // El nombre se repite en cada torneo, lo mantenemos al dia
                await q().updateTable('torneos').set({ organizador: datos.nombre }).where('organizadorId', '=', orgId).execute();
            });
        } catch (err) {
            if (esDuplicado(err)) return NOMBRE_REPETIDO;
            throw err;
        }

        return this.getById(orgId);
    }

    async eliminar(orgId) {
        const org = await q().selectFrom('organizadores').select('id').where('id', '=', orgId).executeTakeFirst();
        if (!org) return NO_EXISTE;

        const conEquipos = await q().selectFrom('torneos').select('id')
            .where('organizadorId', '=', orgId).where('equiposInscriptos', '>', 0).executeTakeFirst();
        if (conEquipos) return { error: 'No podés eliminar la organización: tiene torneos con equipos inscriptos.' };

        await tx(async () => {
            await q().deleteFrom('torneos').where('organizadorId', '=', orgId).execute();
            await q().deleteFrom('organizadores').where('id', '=', orgId).execute();
        });

        return { ok: true };
    }
}

export default OrganizadoresManager;
