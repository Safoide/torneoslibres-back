import { errorMessages, formatId } from '../assets.js';
import { q, tx, porId, siguienteId } from '../db/index.js';
import { aFila, deFila } from '../db/filas.js';

export const MODALIDADES = ['f5', 'f7', 'f8', 'f11'];
export const CATEGORIAS = ['masculino', 'femenino', 'mixto'];
// proximamente: todavía no abrió la inscripción | inscripcion-abierta | inscripcion-cerrada: equipos fijos,
// se crean las fechas | en-curso: desde el día de inicio | finalizado. Los cambios están en services/estadosService.js
export const ESTADOS = ['inscripcion-abierta', 'proximamente', 'inscripcion-cerrada', 'en-curso', 'finalizado'];
export const ESTADOS_INICIALES = ['inscripcion-abierta', 'proximamente']; // con los que se puede crear un torneo

// Las fechas con cobro se crean con al menos 3 días de anticipación (para que los equipos paguen a tiempo).
// Sin cobro por fecha alcanza con que el partido no haya empezado.
export const ANTICIPACION_DIAS = 3;
export const cobraPorFecha = (tor) => Number(tor?.precioFecha ?? 0) > 0;

const AR = '-03:00'; // Argentina no usa horario de verano
export const sumarDias = (iso, dias) => {
    const d = new Date(`${iso}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + dias);
    return d.toISOString().slice(0, 10);
};

// Último día en que pueden cerrar las inscripciones (y el que se usa si el organizador no elige otro):
//  - con cobro por fecha: 4 días antes del inicio, así quedan 3 días completos para crear la fecha 1 y que la paguen
//  - sin cobro por fecha: el día anterior al inicio
export const cierreMaximo = (fechaInicio, precioFecha) =>
    sumarDias(fechaInicio, Number(precioFecha ?? 0) > 0 ? -(ANTICIPACION_DIAS + 1) : -1);

// Cierre de un torneo: el que eligió el organizador o el de siempre (torneos anteriores a este campo)
export const cierreDe = (tor) => tor.cierreInscripcion || cierreMaximo(tor.fechaInicio, tor.precioFecha);
// Las inscripciones se aceptan hasta las 23:59:59 del día de cierre (hora de Argentina)
export const finCierre = (tor) => Date.parse(`${cierreDe(tor)}T23:59:59${AR}`);
// ¿Se puede inscribir alguien ahora? (estado + fecha: no depende de que el cierre automático ya haya corrido)
export const inscripcionAbierta = (tor, ahora = Date.now()) => tor.estado === 'inscripcion-abierta' && ahora <= finCierre(tor);

// Controla el cierre contra el inicio y el precio por fecha. exigirFuturo: el cierre no puede haber pasado
// (al crear el torneo o al cambiar sus fechas antes de que cierre). Devuelve un mensaje de error o null.
export const errorCierre = (tor, { exigirFuturo = false } = {}) => {
    const cierre = cierreDe(tor);
    const max = cierreMaximo(tor.fechaInicio, tor.precioFecha);
    if (cierre > max) {
        return cobraPorFecha(tor)
            ? `Como el torneo cobra por fecha, las inscripciones tienen que cerrar como tarde el ${max}: así quedan ${ANTICIPACION_DIAS} días para crear la fecha 1 y que los equipos la paguen`
            : `Las inscripciones tienen que cerrar como tarde el día anterior al inicio (${max})`;
    }
    if (exigirFuturo && cierre < hoyAR()) {
        return cobraPorFecha(tor)
            ? `El cierre de inscripción quedaría en el pasado (${cierre}). Con cobro por fecha el torneo tiene que empezar al menos ${ANTICIPACION_DIAS + 1} días después de hoy`
            : `El cierre de inscripción quedaría en el pasado (${cierre}). Elegí una fecha de inicio posterior`;
    }
    return null;
};

// Fila -> torneo, con el cierre siempre calculado. cierreAutomatico: el organizador no eligió uno
// (sigue a la fecha de inicio y al precio por fecha si cambian)
const armar = (fila) => {
    const tor = deFila('torneos', fila);
    return { ...tor, cierreInscripcion: cierreDe(tor), cierreAutomatico: !tor.cierreInscripcion };
};

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
    // GET

    async getTorneos() {
        return (await porId(q().selectFrom('torneos').selectAll()).execute()).map(armar);
    }

    async getByOrganizador(orgId) {
        return (await porId(q().selectFrom('torneos').selectAll().where('organizadorId', '=', orgId)).execute()).map(armar);
    }

    // Busqueda con filtros. Todos opcionales y combinables:
    // q, modalidad, zona, categoria, estado, precioMax, desde, hasta, orden.
    // Se filtra en JS (no en SQL) para comparar sin acentos ("Núñez" == "nunez") igual en SQLite y PostgreSQL;
    // con muchos miles de torneos convendria pasar los filtros a la consulta.
    async searchTorneos(filters = {}) {
        const { q: texto, precioMax, desde, hasta, orden = 'fecha' } = filters;
        const modalidades = toList(filters.modalidad);
        const zonas = toList(filters.zona);
        const categorias = toList(filters.categoria);
        const estados = toList(filters.estado);
        const organizadorIds = toList(filters.organizadorId);
        const text = normalize(texto);

        let result = (await this.getTorneos()).filter(tor => {
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
            result = result.sort((a, b) => a.precioInscripcion - b.precioInscripcion || byDate(a, b));
        } else if (orden === 'nombre') {
            result = result.sort((a, b) => a.nombre.localeCompare(b.nombre));
        } else {
            // Por fecha: los finalizados quedan al final
            result = result.sort((a, b) =>
                (a.estado === 'finalizado') - (b.estado === 'finalizado') || byDate(a, b));
        }

        return result;
    }

    // Valores disponibles para armar los filtros del front
    async getFiltros() {
        const filas = await q().selectFrom('torneos').select('zona').distinct().execute();
        const zonas = filas.map(f => f.zona).filter(Boolean).sort((a, b) => a.localeCompare(b));

        return { modalidades: MODALIDADES, categorias: CATEGORIAS, estados: ESTADOS, zonas };
    }

    async getTorneoById(torId) {
        const fila = await q().selectFrom('torneos').selectAll().where('id', '=', String(torId ?? '')).executeTakeFirst();

        return fila ? armar(fila) : { error: errorMessages.tor_wrongId };
    }

    // POST

    async addTor(newTor) {
        const error = this.validate(newTor);
        if (error) return { error };

        return tx(async () => {
            const tor = { ...newTor, id: formatId('TOR', await siguienteId('torneos', 'TOR')) };
            await q().insertInto('torneos').values(aFila('torneos', tor)).execute();
            return this.getTorneoById(tor.id);
        });
    }

    // PUT

    async editTor(torId, modifiedTor) {
        const actual = await this.getTorneoById(torId);
        if (actual.error) return actual;

        const error = this.validate({ ...actual, ...modifiedTor });
        if (error) return { error };

        const cambios = aFila('torneos', { ...modifiedTor, id: undefined });
        if (Object.keys(cambios).length) await q().updateTable('torneos').set(cambios).where('id', '=', torId).execute();

        return this.getTorneoById(torId);
    }

    // Suma un equipo inscripto solo si queda cupo y la inscripcion sigue abierta (en una sola consulta: dos pagos
    // a la vez no pueden pasarse del cupo, y si el organizador la cerro mientras se cobraba no entra). true si se sumo.
    async sumarInscripto(torId) {
        const r = await q().updateTable('torneos')
            .set((eb) => ({ equiposInscriptos: eb('equiposInscriptos', '+', 1) }))
            .where('id', '=', torId)
            .where('estado', '=', 'inscripcion-abierta')
            .where((eb) => eb('equiposInscriptos', '<', eb.ref('equiposMax')))
            .executeTakeFirst();
        return Number(r.numUpdatedRows) === 1;
    }

    // DELETE

    async deleteTor(torId) {
        const r = await q().deleteFrom('torneos').where('id', '=', torId).executeTakeFirst();
        if (!Number(r.numDeletedRows)) return { error: errorMessages.tor_wrongId };

        return { ok: true };
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

        // El estado se elige solo al crear (abierta o próximamente). Después cambia con PUT /torneos/:id/estado
        // o solo (services/estadosService.js), nunca editando el torneo
        if (data.estado !== undefined) {
            if (parcial) return { error: 'El estado se cambia con los botones de estado del torneo' };
            if (!ESTADOS_INICIALES.includes(data.estado)) return { error: 'Un torneo nuevo empieza con la inscripción abierta o como "próximamente"' };
            datos.estado = data.estado;
        } else if (!parcial) datos.estado = 'inscripcion-abierta';

        // Último día de inscripción (YYYY-MM-DD). null o vacío = el de siempre (ver cierreMaximo)
        if (data.cierreInscripcion !== undefined) {
            const c = data.cierreInscripcion === null ? '' : String(data.cierreInscripcion).trim();
            if (c) {
                const d = new Date(c + 'T00:00:00Z');
                if (!/^\d{4}-\d{2}-\d{2}$/.test(c) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== c) {
                    return { error: 'La fecha de cierre de inscripción no es válida' };
                }
            }
            datos.cierreInscripcion = c || null;
        }

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
