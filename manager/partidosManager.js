import { errorMessages, formatId } from '../assets.js';
import { q, tx, porId, siguienteId } from '../db/index.js';
import { aFila } from '../db/filas.js';

// Los partidos salen de los mas nuevos a los mas viejos (como se guardaban en el JSON)
const nuevosPrimero = (qb) => porId(qb, 'desc');

class PartidosManager {
    // GET

    async getPartidos() {
        return nuevosPrimero(q().selectFrom('partidos').selectAll()).execute();
    }

    async getPartidoById(matchId) {
        const p = await q().selectFrom('partidos').selectAll().where('id', '=', String(matchId ?? '')).executeTakeFirst();
        return p ?? { error: errorMessages.match_wrongId };
    }

    async getPartidosByTeam(teamId) {
        const id = String(teamId ?? '');
        const lista = await nuevosPrimero(q().selectFrom('partidos').selectAll()
            .where((eb) => eb.or([eb('home_id', '=', id), eb('away_id', '=', id)]))).execute();
        return lista.length ? lista : { error: errorMessages.noMatches_team };
    }

    // Para la ruta publica: error si no hay partidos (como antes)
    async getPartidosByTournament(torId) {
        const lista = await this.getByTorneo(torId);
        return lista.length ? lista : { error: errorMessages.noMatches_tor };
    }

    async getByTorneo(torId) {
        return nuevosPrimero(q().selectFrom('partidos').selectAll().where('tor_id', '=', String(torId ?? ''))).execute();
    }

    async getByTorneos(torIds) {
        return torIds.length ? nuevosPrimero(q().selectFrom('partidos').selectAll().where('tor_id', 'in', torIds)).execute() : [];
    }

    async getByFecha(torId, numero) {
        return porId(q().selectFrom('partidos').selectAll().where('tor_id', '=', torId).where('fecha', '=', numero)).execute();
    }

    // POST

    // Agrega varios partidos de una vez (los de una fecha nueva)
    async addMatches(lista) {
        return tx(async () => {
            const n = await siguienteId('partidos', 'MATCH');
            const nuevos = lista.map((m, i) => ({ ...aFila('partidos', m), id: formatId('MATCH', n + i) }));
            if (nuevos.length) await q().insertInto('partidos').values(nuevos).execute();
            return nuevos;
        });
    }

    async deleteByFecha(torId, fecha) {
        await q().deleteFrom('partidos').where('tor_id', '=', torId).where('fecha', '=', fecha).execute();
    }

    // PUT

    async editMatch(matchId, modifiedMatch) {
        const cambios = aFila('partidos', { ...modifiedMatch, id: undefined });
        if (Object.keys(cambios).length) await q().updateTable('partidos').set(cambios).where('id', '=', matchId).execute();

        return this.getPartidoById(matchId);
    }
}

export default PartidosManager;
