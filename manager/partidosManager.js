import fs from 'fs'
import { errorMessages, byId, formatId } from '../assets.js';


class PartidosManager {
    constructor(path) {
        this.partidos = [];
        this.path = path;
    }

    // GET

    getPartidos() {
        if(!this.partidos.length){
            this.partidos = JSON.parse(fs.readFileSync(this.path));
        }
        
        return this.partidos;
    };

    getPartidoById(matchId){
        let matchById = this.partidos.find(byId(matchId))
        
        if(!matchById) return {error: errorMessages.match_wrongId};

        return matchById;
    }

    getPartidosByTeam(teamId) {
        let matchById = this.partidos.filter((partido) => partido.home_id === teamId || partido.away_id === teamId);
        
        if(!matchById.length) return {error: errorMessages.noMatches_team};

        return matchById;
    }

    getPartidosByTournament(torId) {
        let byTournament = this.partidos.filter((partido) => partido.tor_id === torId);
        
        if(!byTournament.length) return {error: errorMessages.noMatches_tor};

        return byTournament;
    }

    // POST

    async addMatch(newMatch) {
        if(!newMatch) return {error: errorMessages.wrongData};

        newMatch = {
            id: formatId('MATCH', this.partidos.length + 1),
            ...newMatch
        }

        this.partidos.unshift(newMatch);

        await fs.promises.writeFile(this.path, JSON.stringify(this.partidos));

        return this.partidos;
    }

    // PUT
 
    async editMatch(matchId, modifiedMatch) {
        let matchById = this.partidos.find(byId(matchId));
        let indexById = this.partidos.findIndex(byId(matchId));

        if(!matchById) return {error: errorMessages.match_wrongId};

        this.partidos[indexById] = { ...matchById, ...modifiedMatch };

        await fs.promises.writeFile(this.path, JSON.stringify(this.partidos));

        return this.partidos.find(byId(matchId));
    }

    // DELETE

    async deleteMatch(matchId) {

        if(!this.partidos.find(byId(matchId))) return {error: errorMessages.match_wrongId};

        this.partidos = this.partidos.filter(equipo => equipo.id !== matchId);

        await fs.promises.writeFile(this.path, JSON.stringify(this.partidos));

        return this.partidos;
    }
}


export default PartidosManager;