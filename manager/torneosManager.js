import fs from 'fs'
import { byId, errorMessages } from '../assets.js';

class TorneosManager {
    constructor(path){
        this.torneos = []
        this.path = path
    }

    // GET

    getTorneos(){
        if(!this.torneos.length){
            this.torneos =  JSON.parse(fs.readFileSync(this.path));
        }

        return this.torneos;
    }

    getTorneoById(torId){
        let torById = this.torneos.find(byId(torId))
        
        if(!torById) return {error: errorMessages.tor_wrongId};

        return torById;
    }

    // POST

    async addTor(newTor) {
        if(!newTor) return {error: errorMessages.wrongData};

        newTor = {
            id: formatId('TOR', this.torneos.length + 1),
            ...newTor
        }

        this.torneos.push(newTor);

        await fs.promises.writeFile(this.path, JSON.stringify(this.torneos));

        return this.torneos.find(byId(newTor.id));
    }

    // PUT
 
    async editTor(torId, modifiedTor) {
        let torById = this.torneos.find(byId(torId));
        let indexById = this.torneos.findIndex(byId(torId));

        if(!torById) return {error: errorMessages.tor_wrongId};

        this.torneos[indexById] = { ...torById, ...modifiedTor };

        await fs.promises.writeFile(this.path, JSON.stringify(this.torneos));

        return this.torneos.find(byId(torId));
    }

    // DELETE

    async deleteTor(torId) {

        if(!this.torneos.find(byId(torId))) return {error: errorMessages.tor_wrongId};

        this.torneos = this.torneos.filter(torneo => torneo.id !== torId);

        await fs.promises.writeFile(this.path, JSON.stringify(this.torneos));

        return this.torneos;
    }
}


export default TorneosManager;