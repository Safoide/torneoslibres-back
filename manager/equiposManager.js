import fs from 'fs';
import { errorMessages, formatId, byId } from '../assets.js';

class EquiposManager{
    constructor(path) {
        this.equipos = [];
        this.path = path;
    }


    // GET

    getEquipos() {
        if(!this.equipos.length) {
            this.equipos = JSON.parse(fs.readFileSync(this.path));
        }

        return this.equipos;
    }

    getEquipoById(teamId) {
        let teamById = this.equipos.find(byId(teamId));

        if(!teamById) return {error: errorMessages.team_wrongId};

        return teamById;
    }

    getEquiposByTournament(torId) {
        let byTournament = this.equipos.filter((equipo) => equipo.tor_id === torId);

        if(!byTournament.length) return {error: 'No se encontraron equipos en el torneo'};

        return byTournament;
    }


    // POST

    async addTeam(newTeam) {
        if(!newTeam) return {error: errorMessages.wrongData};

        newTeam = {
            id: formatId('TEAM', this.equipos.length + 1),
            ...newTeam
        }

        this.equipos.push(newTeam);

        await fs.promises.writeFile(this.path, JSON.stringify(this.equipos));

        return this.equipos.find(byId(newTeam.id));
    }


    // PUT
 
    async editTeam(teamId, modifiedTeam) {
        let teamById = this.equipos.find(byId(teamId));
        let indexById = this.equipos.findIndex(byId(teamId));

        if(!teamById) return {error: errorMessages.team_wrongId};

        this.equipos[indexById] = { ...teamById, ...modifiedTeam };

        await fs.promises.writeFile(this.path, JSON.stringify(this.equipos));

        return this.equipos.find(byId(teamId));
    }

    
    // DELETE

    async deleteTeam(teamId) {

        if(!this.equipos.find(byId(teamId))) return {error: errorMessages.team_wrongId};

        this.equipos = this.equipos.filter(equipo => equipo.id !== teamId);

        await fs.promises.writeFile(this.path, JSON.stringify(this.equipos));

        return this.equipos;
    }
}

export default EquiposManager;