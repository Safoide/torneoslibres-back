import { errorMessages, formatId } from '../assets.js';
import { q, tx, porId, siguienteId } from '../db/index.js';
import { aFila } from '../db/filas.js';

// Un equipo por torneo (con las estadisticas de la tabla). club_id lo vincula al club del capitan.
class EquiposManager {
    // GET

    async getEquipos() {
        return porId(q().selectFrom('equipos').selectAll()).execute();
    }

    async getEquipoById(teamId) {
        const eq = await q().selectFrom('equipos').selectAll().where('id', '=', String(teamId ?? '')).executeTakeFirst();
        return eq ?? { error: errorMessages.team_wrongId };
    }

    // Los equipos de un torneo (lista, puede estar vacia)
    async getByTorneo(torId) {
        return porId(q().selectFrom('equipos').selectAll().where('tor_id', '=', String(torId ?? ''))).execute();
    }

    async getByTorneos(torIds) {
        return torIds.length ? porId(q().selectFrom('equipos').selectAll().where('tor_id', 'in', torIds)).execute() : [];
    }

    // Todos los equipos (uno por torneo) de un club
    async getByClub(clubId) {
        return porId(q().selectFrom('equipos').selectAll().where('club_id', '=', String(clubId ?? ''))).execute();
    }

    async getByTorneoYClub(torId, clubId) {
        return (await q().selectFrom('equipos').selectAll().where('tor_id', '=', torId).where('club_id', '=', clubId).executeTakeFirst()) ?? null;
    }

    // Para la ruta publica: error si el torneo no tiene equipos (como antes)
    async getEquiposByTournament(torId) {
        const lista = await this.getByTorneo(torId);
        return lista.length ? lista : { error: 'No se encontraron equipos en el torneo' };
    }

    // POST

    async addTeam(newTeam) {
        if (!newTeam) return { error: errorMessages.wrongData };

        return tx(async () => {
            const equipo = { ...aFila('equipos', newTeam), id: formatId('TEAM', await siguienteId('equipos', 'TEAM')) };
            await q().insertInto('equipos').values(equipo).execute();
            return this.getEquipoById(equipo.id);
        });
    }

    // PUT

    async editTeam(teamId, modifiedTeam) {
        const cambios = aFila('equipos', { ...modifiedTeam, id: undefined });
        if (Object.keys(cambios).length) await q().updateTable('equipos').set(cambios).where('id', '=', teamId).execute();

        return this.getEquipoById(teamId);
    }

    // DELETE

    async deleteTeam(teamId) {
        const r = await q().deleteFrom('equipos').where('id', '=', teamId).executeTakeFirst();
        return Number(r.numDeletedRows) ? { ok: true } : { error: errorMessages.team_wrongId };
    }
}

export default EquiposManager;
