import fs from 'fs'
import { byId, errorMessages, formatId } from '../assets.js';

export const MODALIDADES = ['f5', 'f7', 'f8', 'f11'];
export const CATEGORIAS = ['masculino', 'femenino', 'mixto'];
export const ESTADOS = ['inscripcion-abierta', 'proximamente', 'en-curso', 'finalizado'];

const TEXTOS = { nombre: 80, zona: 40, localidad: 40, sede: 80, direccion: 120, horario: 40, formato: 80, descripcion: 500 };
const NUMEROS = { equiposMax: [2, 64], precioInscripcion: [0, 10000000], precioFecha: [0, 10000000] };
const DIAS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const REQUERIDOS = ['nombre', 'modalidad', 'zona', 'sede', 'direccion', 'fechaInicio', 'diaJuego', 'horario', 'equiposMax', 'precioInscripcion'];

// Pasa a minusculas y saca acentos para comparar zonas/textos ("Núñez" == "nunez")
const normalize = (text = '') =>
    String(text).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

// "f5,f7" | ["f5","f7"] -> ["f5","f7"]
const toList = (value) => {
    if (value === undefined || value === '') return [];
    const list = Array.isArray(value) ? value : String(value).split(',');
    return list.map(normalize).filter(Boolean);
};

class TorneosManager {
    constructor(path){
        this.torneos = []
        this.path = path
        this.loaded = false
    }

    // Carga el JSON una sola vez y despues trabaja en memoria
    load(){
        if(!this.loaded){
            this.torneos = JSON.parse(fs.readFileSync(this.path));
            this.loaded = true;
        }
    }

    save(){
        return fs.promises.writeFile(this.path, JSON.stringify(this.torneos, null, 4));
    }

    nextId(){
        const max = this.torneos.reduce((acc, tor) => {
            const n = parseInt(String(tor.id).split('-')[1], 10);
            return Number.isNaN(n) ? acc : Math.max(acc, n);
        }, 0);

        return formatId('TOR', max + 1);
    }

    // GET

    getTorneos(){
        this.load();
        return this.torneos;
    }

    // Busqueda con filtros. Todos opcionales y combinables:
    // q, modalidad, zona, categoria, estado, precioMax, desde, hasta, orden
    searchTorneos(filters = {}){
        this.load();

        const { q, precioMax, desde, hasta, orden = 'fecha' } = filters;
        const modalidades = toList(filters.modalidad);
        const zonas = toList(filters.zona);
        const categorias = toList(filters.categoria);
        const estados = toList(filters.estado);
        const organizadorIds = toList(filters.organizadorId);
        const text = normalize(q);

        let result = this.torneos.filter(tor => {
            if (modalidades.length && !modalidades.includes(normalize(tor.modalidad))) return false;
            if (zonas.length && !zonas.includes(normalize(tor.zona))) return false;
            if (categorias.length && !categorias.includes(normalize(tor.categoria))) return false;
            if (estados.length && !estados.includes(normalize(tor.estado))) return false;
            if (organizadorIds.length && !organizadorIds.includes(normalize(tor.organizadorId))) return false;

            if (precioMax !== undefined && precioMax !== '' && Number(tor.precioInscripcion) > Number(precioMax)) return false;
            if (desde && tor.fechaInicio < desde) return false;
            if (hasta && tor.fechaInicio > hasta) return false;

            if (text) {
                const haystack = normalize([tor.nombre, tor.organizador, tor.sede, tor.zona, tor.localidad].join(' '));
                if (!haystack.includes(text)) return false;
            }

            return true;
        });

        const byDate = (a, b) => a.fechaInicio.localeCompare(b.fechaInicio);

        if (orden === 'precio') {
            result = [...result].sort((a, b) => a.precioInscripcion - b.precioInscripcion || byDate(a, b));
        } else if (orden === 'nombre') {
            result = [...result].sort((a, b) => a.nombre.localeCompare(b.nombre));
        } else {
            // Por fecha: los finalizados quedan al final
            result = [...result].sort((a, b) =>
                (a.estado === 'finalizado') - (b.estado === 'finalizado') || byDate(a, b));
        }

        return result;
    }

    // Valores disponibles para armar los filtros del front
    getFiltros(){
        this.load();

        const zonas = [...new Set(this.torneos.map(tor => tor.zona))]
            .sort((a, b) => a.localeCompare(b));

        return { modalidades: MODALIDADES, categorias: CATEGORIAS, estados: ESTADOS, zonas };
    }

    getTorneoById(torId){
        this.load();

        let torById = this.torneos.find(byId(torId))

        if(!torById) return {error: errorMessages.tor_wrongId};

        return torById;
    }

    // POST

    async addTor(newTor) {
        this.load();

        const error = this.validate(newTor);
        if(error) return {error};

        newTor = {
            ...newTor,
            id: this.nextId(),
        }

        this.torneos.push(newTor);

        await this.save();

        return newTor;
    }

    // PUT

    async editTor(torId, modifiedTor) {
        this.load();

        let indexById = this.torneos.findIndex(byId(torId));

        if(indexById === -1) return {error: errorMessages.tor_wrongId};

        const merged = { ...this.torneos[indexById], ...modifiedTor, id: torId };

        const error = this.validate(merged);
        if(error) return {error};

        this.torneos[indexById] = merged;

        await this.save();

        return merged;
    }

    // DELETE

    async deleteTor(torId) {
        this.load();

        if(!this.torneos.find(byId(torId))) return {error: errorMessages.tor_wrongId};

        this.torneos = this.torneos.filter(torneo => torneo.id !== torId);

        await this.save();

        return this.torneos;
    }

    // Valida y limpia los campos que puede mandar un organizador (nunca se copia el body entero).
    // Con parcial=true (editar) solo se miran los campos que vienen.
    sanitize(data = {}, { parcial = false } = {}) {
        const datos = {};

        if (!parcial) {
            const falta = REQUERIDOS.find(c => data[c] === undefined || String(data[c]).trim() === '');
            if (falta) return { error: `Falta completar: ${falta}` };
        }

        for (const [campo, max] of Object.entries(TEXTOS)) {
            if (data[campo] === undefined) continue;
            const valor = String(data[campo]).trim();
            if (valor.length > max) return { error: `${campo} admite hasta ${max} caracteres` };
            if (!valor && REQUERIDOS.includes(campo)) return { error: `${campo} no puede estar vacío` };
            datos[campo] = valor;
        }

        for (const [campo, [min, max]] of Object.entries(NUMEROS)) {
            if (data[campo] === undefined) continue;
            const n = Number(data[campo]);
            if (!Number.isInteger(n) || n < min || n > max) return { error: `${campo} debe ser un número entero entre ${min} y ${max}` };
            datos[campo] = n;
        }

        if (data.fechaInicio !== undefined) {
            const f = String(data.fechaInicio).trim();
            const d = new Date(f + 'T00:00:00Z');
            if (!/^\d{4}-\d{2}-\d{2}$/.test(f) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== f) {
                return { error: 'La fecha de inicio no es válida' };
            }
            datos.fechaInicio = f;
        }

        if (data.modalidad !== undefined) {
            const m = normalize(data.modalidad);
            if (!MODALIDADES.includes(m)) return { error: `modalidad debe ser ${MODALIDADES.join(', ')}` };
            datos.modalidad = m;
        }

        if (data.categoria !== undefined) {
            if (!CATEGORIAS.includes(data.categoria)) return { error: `categoria debe ser ${CATEGORIAS.join(', ')}` };
            datos.categoria = data.categoria;
        } else if (!parcial) datos.categoria = 'mixto';

        if (data.estado !== undefined) {
            if (!ESTADOS.includes(data.estado)) return { error: `estado debe ser ${ESTADOS.join(', ')}` };
            datos.estado = data.estado;
        } else if (!parcial) datos.estado = 'inscripcion-abierta';

        if (data.diaJuego !== undefined) {
            const dia = DIAS.find(x => normalize(x) === normalize(data.diaJuego));
            if (!dia) return { error: `diaJuego debe ser ${DIAS.join(', ')}` };
            datos.diaJuego = dia;
        }

        if (!parcial && !datos.localidad) datos.localidad = 'CABA';

        if (data.whatsapp !== undefined) {
            const w = String(data.whatsapp).replace(/\D/g, '');
            if (w && (w.length < 10 || w.length > 15)) return { error: 'El WhatsApp debe tener entre 10 y 15 dígitos, con código de país' };
            if (w) datos.whatsapp = w;
        }

        return { datos };
    }

    // Devuelve un mensaje de error o null si los datos estan bien
    validate(tor){
        if(!tor || typeof tor !== 'object') return errorMessages.wrongData;
        if(!tor.nombre || !tor.zona || !tor.fechaInicio) return `${errorMessages.wrongData}: nombre, zona y fechaInicio son obligatorios`;
        if(!MODALIDADES.includes(normalize(tor.modalidad))) return `${errorMessages.wrongData}: modalidad debe ser ${MODALIDADES.join(', ')}`;
        if(tor.estado && !ESTADOS.includes(tor.estado)) return `${errorMessages.wrongData}: estado debe ser ${ESTADOS.join(', ')}`;
        if(tor.categoria && !CATEGORIAS.includes(tor.categoria)) return `${errorMessages.wrongData}: categoria debe ser ${CATEGORIAS.join(', ')}`;

        return null;
    }
}


export default TorneosManager;
