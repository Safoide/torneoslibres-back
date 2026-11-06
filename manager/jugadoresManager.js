import { errorMessages } from '../assets.js';
import { q, porId } from '../db/index.js';

// Estadisticas por jugador (goles, tarjetas). Solo lectura: no se cargan desde la app.
class JugadoresManager {
    async getJugadores() {
        return porId(q().selectFrom('jugadores').selectAll()).execute();
    }

    async getJugadorById(playerId) {
        const j = await q().selectFrom('jugadores').selectAll().where('id', '=', String(playerId ?? '')).executeTakeFirst();
        return j ?? { error: errorMessages.player_wrongId };
    }

    async getJugadoresByTeam(teamId) {
        const lista = await porId(q().selectFrom('jugadores').selectAll().where('team_id', '=', String(teamId ?? ''))).execute();
        return lista.length ? lista : { error: errorMessages.noPlayers_team };
    }

    async getJugadoresByTournament(torId) {
        const lista = await porId(q().selectFrom('jugadores').selectAll().where('tor_id', '=', String(torId ?? ''))).execute();
        return lista.length ? lista : { error: errorMessages.noPlayers_tor };
    }
}

export default JugadoresManager;
