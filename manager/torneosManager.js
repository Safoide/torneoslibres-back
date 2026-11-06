import fs from 'fs'
import { byId, errorMessages, formatId } from '../assets.js';

export const MODALIDADES = ['f5', 'f7', 'f8', 'f11'];
export const CATEGORIAS = ['masculino', 'femenino', 'mixto'];
export const ESTADOS = ['inscripcion-abierta', 'proximamente', 'en-curso', 'finalizado'];

const TEXTOS = { nombre: 80, zona: 40, localidad: 40, sede: 80, direccion: 120, horario: 40, formato: 80, descripcion: 500 };
const NUMEROS = { equiposMax: [2, 64], precioInscripcion: [0, 10000000], precioFecha: [0, 10000000] };
const DIAS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const REQUERIDOS = ['nombre', 'modalidad', 'zona', 'sede', 'direccion', 'fechaInicio', 'diaJuego', 'horario', 'equiposMax', 'precioInscripcion'];

// Reglas de pago de las fechas (las elige el organizador; se pueden cambiar hasta que el torneo empieza):
//  penalizacion: si el equipo que no paga a tiempo pierde 0-3 por W.O. y recibe una multa.
//                Si esta desactivada no pasa nada automatico: el pago queda vencido y decide el organizador.
//  multaTipo/multaValor: 'porcentaje' (del precio de la fecha) o 'fijo' (en pesos). 0 = solo el W.O.
//  amistosos: si el lugar del que no pago se publica como amistoso express (requiere penalizacion).
export const REGLAS_DEFAULT = { penalizacion: true, multaTipo: 'porcentaje', multaValor: 0, amistosos: true };
// Los torneos viejos usan las default. Sin penalizacion nunca hay amistosos (no hay W.O. que libere el lugar)
export const reglasDe = (tor) => {
    const r = { ...REGLAS_DEFAULT, ...(tor?.reglasPago ?? {}) };
    return { ...r, amistosos: r.penalizacion && r.amistosos };
};

// Multa en pesos que corresponde segun las reglas y el precio de la fecha
export const montoMulta = (reglas, precioFecha) => !reglas.penalizacion ? 0
    : reglas.multaTipo === 'fijo' ? reglas.multaValor
    : Math.round((precioFecha ?? 0) * reglas.multaValor / 100);

const limpiarReglas = (r) => {
    if (!r || typeof r !== 'object') return { error: 'Las reglas de pago no son válidas' };

    const penalizacion = r.penalizacion === true;
    const multaTipo = r.multaTipo === 'fijo' ? 'fijo' : 'porcentaje';
    const multaValor = Number(r.multaValor ?? 0);
    const amistosos = penalizacion && r.amistosos === true; // sin W.O. no hay lugar libre para un amistoso

    if (penalizacion) {
        const max = multaTipo === 'fijo' ? 10000000 : 100;
        if (!Number.isInteger(multaValor) || multaValor < 0 || multaValor > max) {
            return { error: multaTipo === 'fijo' ? 'La multa debe ser un monto entre $0 y $10.000.000' : 'La multa debe ser un porcentaje entre 0 y 100' };
        }
    }

    return { reglas: { penalizacion, multaTipo, multaValor: penalizacion ? multaValor : 0, amistosos } };
};

// Limite de edad (opcional, lo activa el organizador): null = libre, o { min, max } con al menos uno de los dos.
// Las edades son las que carga el capitan en el plantel (mismo rango que acepta clubesManager).
const EDAD_RANGO = [10, 80];

const limpiarLimiteEdad = (l) => {
    if (l === null || l === false) return { limite: null };
    if (typeof l !== 'object') return { error: 'El límite de edad no es válido' };

    const leer = (v) => (v === undefined || v === null || v === '') ? null : Number(v);
    const min = leer(l.min);
    const max = leer(l.max);
    const [lo, hi] = EDAD_RANGO;

    for (const v of [min, max]) {
        if (v !== null && (!Number.isInteger(v) || v < lo || v > hi)) return { error: `La edad del límite debe estar entre ${lo} y ${hi} años` };
    }
    if (min === null && max === null) return { error: 'Indicá la edad mínima, la máxima o las dos' };
    if (min !== null && max !== null && min > max) return { error: 'La edad mínima no puede ser mayor que la máxima' };

    return { limite: { min, max } };
};

// "desde 35 años" | "hasta 20 años" | "de 18 a 25 años"
export const textoLimiteEdad = (l) => !l ? ''
    : l.min !== null && l.max !== null ? `de ${l.min} a ${l.max} años`
    : l.min !== null ? `desde ${l.min} años`
    : `hasta ${l.max} años`;

// Fecha de hoy en Argentina (YYYY-MM-DD)
export const hoyAR = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date());

// Años cumplidos a una fecha (las dos en YYYY-MM-DD). Se compara como texto "MM-DD" para no depender de husos horarios.
export const edadEn = (nacimiento, fecha = hoyAR()) => {
    const [ny, nmd] = [Number(nacimiento.slice(0, 4)), nacimiento.slice(5)];
    const [fy, fmd] = [Number(fecha.slice(0, 4)), fecha.slice(5)];
    return fy - ny - (fmd < nmd ? 1 : 0);
};

// Jugadores del plantel que no entran en el limite del torneo, con la edad que van a tener al inicio
// (como en las categorias: el "+35" se cumple el dia que empieza el torneo y vale para todo el torneo)
export const fueraDeEdad = (jugadores = [], tor) => {
    const l = tor?.limiteEdad;
    if (!l) return [];

    return jugadores
        .map(j => ({ ...j, edad: edadEn(j.nacimiento, tor.fechaInicio) }))
        .filter(j => (l.min !== null && j.edad < l.min) || (l.max !== null && j.edad > l.max));
};

// Mensaje para el capitan cuando su plantel no cumple
export const errorEdad = (fuera, l) => {
    const nombres = fuera.map(j => `${j.nombre} ${j.apellido} (${j.edad})`).join(', ');
    return fuera.length === 1
        ? `Un jugador de tu equipo no cumple con el límite de edad del torneo (${textoLimiteEdad(l)} al inicio): ${nombres}`
        : `${fuera.length} jugadores de tu equipo no cumplen con el límite de edad del torneo (${textoLimiteEdad(l)} al inicio): ${nombres}`;
};

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

        if (data.reglasPago !== undefined) {
            const { error, reglas } = limpiarReglas(data.reglasPago);
            if (error) return { error };
            datos.reglasPago = reglas;
        } else if (!parcial) datos.reglasPago = { ...REGLAS_DEFAULT };

        if (data.limiteEdad !== undefined) {
            const { error, limite } = limpiarLimiteEdad(data.limiteEdad);
            if (error) return { error };
            datos.limiteEdad = limite;
        } else if (!parcial) datos.limiteEdad = null;

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
