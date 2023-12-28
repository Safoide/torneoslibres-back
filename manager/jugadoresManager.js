import fs from 'fs'
import { errorMessages, byId, formatId } from '../assets.js';


class JugadoresManager {
    constructor(path) {
        this.jugadores = [];
        this.path = path;
    }

    // GET

    getJugadores() {
        if(!this.jugadores.length){
            this.jugadores = JSON.parse(fs.readFileSync(this.path));
        }
        
        return this.jugadores;
    };

    getJugadorById(playerId){
        let playerById = this.jugadores.find(byId(playerId))
        
        if(!playerById) return {error: errorMessages.player_wrongId};

        return playerById;
    }

    getJugadoresByTeam(teamId) {
        let playersByTeam = this.jugadores.filter((jugador) => jugador.team_id === teamId);
        
        if(!playersByTeam.length) return {error: errorMessages.noPlayers_team};

        return playersByTeam;
    }

    getJugadoresByTournament(torId) {
        let byTournament = this.jugadores.filter((jugador) => jugador.tor_id === torId);
        
        if(!byTournament.length) return {error: errorMessages.noPlayers_tor};

        return byTournament;
    }

    // POST

    async addPlayer(newPlayer) {
        if(!newPlayer) return {error: errorMessages.wrongData};

        newPlayer = {
            id: formatId('PLAYER', this.jugadores.length + 1),
            ...newPlayer
        }

        this.jugadores.unshift(newPlayer);

        await fs.promises.writeFile(this.path, JSON.stringify(this.jugadores));

        return this.jugadores;
    }

    // PUT
 
    async editPlayer(playerId, modifiedPlayer) {
        let playerById = this.jugadores.find(byId(playerId));
        let indexById = this.jugadores.findIndex(byId(playerId));

        if(!playerById) return {error: errorMessages.player_wrongId};

        this.jugadores[indexById] = { ...playerById, ...modifiedPlayer };

        await fs.promises.writeFile(this.path, JSON.stringify(this.jugadores));

        return this.jugadores.find(byId(playerId));
    }

    // DELETE

    async deletePlayer(playerId) {

        if(!this.jugadores.find(byId(playerId))) return {error: errorMessages.player_wrongId};

        this.jugadores = this.jugadores.filter(jugador => jugador.id !== playerId);

        await fs.promises.writeFile(this.path, JSON.stringify(this.jugadores));

        return this.jugadores;
    }
}


export default JugadoresManager;