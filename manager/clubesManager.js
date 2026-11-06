import { randomUUID } from 'crypto';
import { logoValido } from '../config.js';
import { q, tx, esDuplicado } from '../db/index.js';
import { fueraDeEdad, textoLimiteEdad, edadEn } from './torneosManager.js';
import { torneosManager, equiposManager } from './instances.js';

// YYYY-MM-DD y que sea una fecha real (no 2001-02-30)
const fechaValida = (f) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f)) return false;
    const d = new Date(f + 'T00:00:00Z');
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === f;
};

const MAX_JUGADORES = 30;
const NOMBRE_REPETIDO = { error: 'Ya existe un equipo con ese nombre' };
const YA_TIENE = { error: 'Ya tenés un equipo. Solo se puede tener uno por cuenta.' };

class ClubesManager {
    async plantel(clubId) {
        return q().selectFrom('club_jugadores').select(['nombre', 'apellido', 'dni', 'nacimiento'])
            .where('clubId', '=', clubId).orderBy('orden').execute();
    }

    // El club con su plantel (incluye el ownerId: uso interno)
    async getRawByOwner(ownerId) {
        const club = await q().selectFrom('clubes').selectAll().where('ownerId', '=', String(ownerId ?? '')).executeTakeFirst();
        return club ? { ...club, jugadores: await this.plantel(club.id) } : null;
    }

    async getRawById(id) {
        const club = await q().selectFrom('clubes').selectAll().where('id', '=', String(id ?? '')).executeTakeFirst();
        return club ? { ...club, jugadores: await this.plantel(club.id) } : null;
    }

    // Lo que ve el capitan (todo menos el ownerId)
    privado({ ownerId, ...club }) {
        return club;
    }

    async miEquipo(ownerId) {
        const club = await this.getRawByOwner(ownerId);
        return club ? this.privado(club) : null;
    }

    // Valida y limpia lo que manda el usuario (nunca se copia el body entero)
    async limpiar(data = {}, idActual = null) {
        const nombre = String(data.nombre ?? '').trim();
        const whatsapp = String(data.whatsapp ?? '').replace(/\D/g, '');
        const logo = String(data.logo ?? '').trim();

        if (nombre.length < 3 || nombre.length > 40) return { error: 'El nombre del equipo debe tener entre 3 y 40 caracteres' };
        if (whatsapp.length < 10 || whatsapp.length > 15) return { error: 'Ingresá tu WhatsApp con código de país (10 a 15 dígitos)' };
        if (logo && !logoValido(logo)) return { error: 'El logo no es válido: subí la imagen de nuevo' };

        const lista = Array.isArray(data.jugadores) ? data.jugadores : [];
        if (lista.length > MAX_JUGADORES) return { error: `El plantel admite hasta ${MAX_JUGADORES} jugadores` };

        const jugadores = [];

        for (const [i, j] of lista.entries()) {
            const n = i + 1;
            const nombreJ = String(j?.nombre ?? '').trim();
            const apellido = String(j?.apellido ?? '').trim();
            const dni = String(j?.dni ?? '').replace(/\D/g, '');
            const nacimiento = String(j?.nacimiento ?? '').trim();

            if (!nombreJ || nombreJ.length > 40 || !apellido || apellido.length > 40) return { error: `Jugador ${n}: completá nombre y apellido` };
            if (dni.length < 7 || dni.length > 8) return { error: `Jugador ${n}: el DNI debe tener 7 u 8 dígitos` };
            if (!nacimiento) return { error: `Jugador ${n}: completá la fecha de nacimiento` };
            if (!fechaValida(nacimiento)) return { error: `Jugador ${n}: la fecha de nacimiento no es válida` };
            const edad = edadEn(nacimiento);
            if (edad < 10 || edad > 80) return { error: `Jugador ${n}: la fecha de nacimiento no es válida (tiene que tener entre 10 y 80 años)` };
            if (jugadores.some(x => x.dni === dni)) return { error: `Jugador ${n}: el DNI ${dni} está repetido` };

            jugadores.push({ nombre: nombreJ, apellido, dni, nacimiento });
        }

        // Chequeo amable; la garantia la da el indice unico de la base (lower(nombre))
        const otro = await q().selectFrom('clubes').select('id')
            .where((eb) => eb(eb.fn('lower', ['nombre']), '=', nombre.toLowerCase()))
            .where('id', '!=', idActual ?? '').executeTakeFirst();
        if (otro) return NOMBRE_REPETIDO;

        return { datos: { nombre, logo, whatsapp, jugadores } };
    }

    async guardarPlantel(clubId, jugadores) {
        await q().deleteFrom('club_jugadores').where('clubId', '=', clubId).execute();
        if (jugadores.length) {
            await q().insertInto('club_jugadores').values(jugadores.map((j, orden) => ({ clubId, orden, ...j }))).execute();
        }
    }

    // Solo el WhatsApp del capitan (se edita tambien desde "Editar mis datos")
    async cambiarWhatsapp(clubId, valor) {
        const whatsapp = String(valor ?? '').replace(/\D/g, '');
        if (whatsapp.length < 10 || whatsapp.length > 15) return { error: 'Ingresá tu WhatsApp con código de país (10 a 15 dígitos)' };

        const r = await q().updateTable('clubes').set({ whatsapp }).where('id', '=', clubId).executeTakeFirst();
        if (!Number(r.numUpdatedRows)) return { error: 'No se encontro el equipo' };

        return this.privado(await this.getRawById(clubId));
    }

    async crear(ownerId, data) {
        if (await q().selectFrom('clubes').select('id').where('ownerId', '=', ownerId).executeTakeFirst()) return YA_TIENE;

        const { error, datos } = await this.limpiar(data);
        if (error) return { error };

        const { jugadores, ...resto } = datos;
        const club = { id: `CLUB-${randomUUID().slice(0, 8)}`, ...resto, ownerId, creado: new Date().toISOString() };

        try {
            await tx(async () => {
                await q().insertInto('clubes').values(club).execute();
                await this.guardarPlantel(club.id, jugadores);
            });
        } catch (err) {
            if (esDuplicado(err)) return String(err.message).includes('ownerId') ? YA_TIENE : NOMBRE_REPETIDO;
            throw err;
        }

        return this.privado({ ...club, jugadores });
    }

    async editar(clubId, data) {
        if (!await q().selectFrom('clubes').select('id').where('id', '=', clubId).executeTakeFirst()) return { error: 'No se encontro el equipo' };

        const { error, datos } = await this.limpiar(data, clubId);
        if (error) return { error };

        const inscripto = await equiposManager.getByClub(clubId);

        // Si esta anotado en un torneo con limite de edad que no termino, el plantel nuevo tiene que seguir cumpliendolo
        for (const e of inscripto) {
            const tor = await torneosManager.getTorneoById(e.tor_id);
            if (tor.error || tor.estado === 'finalizado' || !tor.limiteEdad) continue;

            const [j] = fueraDeEdad(datos.jugadores, tor);
            if (j) return { error: `${j.nombre} ${j.apellido} (${j.edad} al inicio) no cumple con el límite de edad de "${tor.nombre}" (${textoLimiteEdad(tor.limiteEdad)}), donde tu equipo está inscripto` };
        }

        const { jugadores, ...resto } = datos;

        try {
            await tx(async () => {
                await q().updateTable('clubes').set(resto).where('id', '=', clubId).execute();
                await this.guardarPlantel(clubId, jugadores);
                // El nombre y el logo se copian en cada torneo donde esta inscripto: los mantenemos al dia
                await q().updateTable('equipos').set({ name: resto.nombre, logo: resto.logo }).where('club_id', '=', clubId).execute();
            });
        } catch (err) {
            if (esDuplicado(err)) return NOMBRE_REPETIDO;
            throw err;
        }

        return this.privado(await this.getRawById(clubId));
    }

    async eliminar(clubId) {
        if (!await q().selectFrom('clubes').select('id').where('id', '=', clubId).executeTakeFirst()) return { error: 'No se encontro el equipo' };

        for (const e of await equiposManager.getByClub(clubId)) {
            const tor = await torneosManager.getTorneoById(e.tor_id);
            if (!tor.error && tor.estado !== 'finalizado') return { error: 'No podés eliminar el equipo: está inscripto en un torneo que no terminó.' };
        }

        // El plantel se borra en cascada. Los equipos de torneos ya terminados quedan (son el historial de la tabla)
        await tx(async () => {
            await q().deleteFrom('club_jugadores').where('clubId', '=', clubId).execute();
            await q().deleteFrom('clubes').where('id', '=', clubId).execute();
        });

        return { ok: true };
    }
}

export default ClubesManager;
