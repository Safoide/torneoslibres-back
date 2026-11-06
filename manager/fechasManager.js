import fs from 'fs';
import { byId, formatId } from '../assets.js';
import { rondasDe } from '../services/fixtureService.js';
import { cobrar } from '../services/pagosService.js';
import { reglasDe } from './torneosManager.js';

const DURACION = { f5: 40, f7: 50, f8: 60, f11: 90 }; // minutos por partido
export const ANTICIPACION_DIAS = 3; // las fechas se publican con al menos 3 dias de anticipacion
const HORA_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const AR = '-03:00'; // Argentina no usa horario de verano

const minutos = (hhmm) => parseInt(hhmm.slice(0, 2), 10) * 60 + parseInt(hhmm.slice(3), 10);
const aMs = (dia, hhmm) => new Date(`${dia}T${hhmm}:00${AR}`).getTime();
// ms -> "2026-11-07T16:00:00-03:00"
const aIso = (ms) => new Date(ms - 3 * 3600e3).toISOString().slice(0, 19) + AR;
const hoyAR = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date());
const sumarDias = (iso, dias) => {
    const d = new Date(`${iso}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + dias);
    return d.toISOString().slice(0, 10);
};
// Los equipos pagan su parte hasta las 23:59 del dia anterior al partido (hora de Argentina)
export const vencimientoPago = (dia) => `${sumarDias(dia, -1)}T23:59:59${AR}`;

class FechasManager {
    constructor(path, equiposManager, partidosManager) {
        this.path = path;
        this.equiposManager = equiposManager;
        this.partidosManager = partidosManager;
        if (!fs.existsSync(path)) fs.writeFileSync(path, '[]');
        this.fechas = JSON.parse(fs.readFileSync(path));
    }

    save() {
        return fs.promises.writeFile(this.path, JSON.stringify(this.fechas, null, 4));
    }

    // Inicio y fin reales (el fin puede ser pasada la medianoche: "20:00" a "00:00")
    rango(f) {
        const ini = aMs(f.dia, f.inicio);
        let fin = aMs(f.dia, f.fin);
        if (fin <= ini) fin += 24 * 3600e3;
        return { ini, fin };
    }

    // programada | en-juego | jugada
    estadoDe(f, ahora = Date.now()) {
        const { ini, fin } = this.rango(f);
        return ahora < ini ? 'programada' : ahora < fin ? 'en-juego' : 'jugada';
    }

    // Uso interno del servidor: incluye el detalle de pagos de cada equipo
    conEstado(f, ahora = Date.now()) {
        return { ...f, estado: this.estadoDe(f, ahora) };
    }

    // Lo que sale por la API publica: de los pagos solo el resumen (quien pago es informacion del organizador)
    publico({ pagos, ...f }, ahora = Date.now()) {
        const lista = Object.values(pagos ?? {});
        return {
            ...f,
            estado: this.estadoDe(f, ahora),
            pagos: pagos ? {
                total: lista.length,
                pagados: lista.filter(p => p.estado === 'pagado').length,
                vencidos: lista.filter(p => p.estado === 'vencido').length,
                vence: f.vencePago,
            } : null, // null = fecha anterior al cobro online (sin control de pago)
        };
    }

    getByTorneo(torId) {
        return this.fechas.filter(f => f.tor_id === torId)
            .sort((a, b) => b.numero - a.numero)
            .map(f => this.publico(f));
    }

    // Igual que getByTorneo pero con el detalle de pagos (panel del organizador, vencimientos)
    getRawByTorneo(torId) {
        return this.fechas.filter(f => f.tor_id === torId)
            .sort((a, b) => b.numero - a.numero)
            .map(f => this.conEstado(f));
    }

    getById(id) {
        return this.fechas.find(byId(id)) || null;
    }

    async crear(tor, data = {}) {
        if (tor.estado !== 'en-curso') return { error: 'Solo se pueden crear fechas en torneos en curso. Primero pasá el torneo a "En curso".' };

        const dia = String(data.dia ?? '').trim();
        const inicio = String(data.inicio ?? '').trim();
        const fin = String(data.fin ?? '').trim();
        const canchas = Number(data.canchas ?? 2);

        const d = new Date(`${dia}T00:00:00Z`);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dia) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== dia) return { error: 'El día no es válido' };
        const minimo = sumarDias(hoyAR(), ANTICIPACION_DIAS);
        if (dia < minimo) return { error: `Las fechas se publican con al menos ${ANTICIPACION_DIAS} días de anticipación, para que los equipos puedan pagar a tiempo. Elegí un día desde el ${minimo}.` };
        if (!HORA_RE.test(inicio) || !HORA_RE.test(fin)) return { error: 'Elegí un horario de inicio y de finalización válidos' };
        if (inicio === fin) return { error: 'El horario de inicio y de finalización no pueden ser iguales' };
        if (!Number.isInteger(canchas) || canchas < 1 || canchas > 8) return { error: 'La cantidad de canchas debe ser entre 1 y 8' };

        const previas = this.fechas.filter(f => f.tor_id === tor.id);
        const ultima = previas.reduce((a, f) => (f.numero > (a?.numero ?? 0) ? f : a), null);
        if (ultima && dia <= ultima.dia) return { error: `El día tiene que ser posterior al de la fecha ${ultima.numero} (${ultima.dia})` };

        const numero = (ultima?.numero ?? 0) + 1;
        const equipos = this.equiposManager.getEquipos().filter(e => e.tor_id === tor.id);
        if (equipos.length < 2) return { error: 'El torneo necesita al menos 2 equipos para armar una fecha' };

        const rondas = rondasDe(equipos);
        if (numero > rondas.length) return { error: `Ya se programaron las ${rondas.length} fechas del fixture (todos contra todos)` };

        const partidos = rondas[numero - 1];
        const dur = DURACION[tor.modalidad] ?? 50;
        const { ini, fin: finMs } = this.rango({ dia, inicio, fin });
        const ventana = (finMs - ini) / 60000;
        const turnos = Math.ceil(partidos.length / canchas);

        if (turnos * dur > ventana) {
            const necesarios = turnos * dur;
            return { error: `No entran ${partidos.length} partidos de ${dur} min con ${canchas} ${canchas === 1 ? 'cancha' : 'canchas'} en ${ventana} min. Ampliá el horario (necesitás ${necesarios} min) o sumá canchas.` };
        }

        const fecha = {
            id: formatId('FECHA', this.fechas.reduce((m, f) => Math.max(m, parseInt(f.id.split('-')[1], 10) || 0), 0) + 1),
            tor_id: tor.id, numero, dia, inicio, fin, canchas, precio: tor.precioFecha, creada: new Date().toISOString(),
            // Cada equipo que juega paga su parte antes del vencimiento; el que tiene fecha libre no paga.
            // Si no paga a tiempo pierde por W.O. (ver services/vencimientosService.js)
            vencePago: vencimientoPago(dia),
            // Copia de las reglas del torneo al crear la fecha: penalizacion (W.O. + multa) y amistosos express
            reglas: reglasDe(tor),
            pagos: Object.fromEntries(partidos.flat().map(eq => [eq.id, { estado: 'pendiente', monto: tor.precioFecha }])),
        };

        await this.partidosManager.addMatches(partidos.map(([local, visita], i) => ({
            tor_id: tor.id, fecha: numero, home_id: local.id, away_id: visita.id,
            date: aIso(ini + Math.floor(i / canchas) * dur * 60000), cancha: (i % canchas) + 1,
            home_goals: null, away_goals: null,
        })));

        this.fechas.push(fecha);
        await this.save();

        return this.publico(fecha);
    }

    // Solo se puede cancelar la ultima fecha y antes de que empiece
    async eliminar(id) {
        const f = this.getById(id);
        if (!f) return { error: 'No se encontró la fecha' };

        if (this.fechas.some(x => x.tor_id === f.tor_id && x.numero > f.numero)) return { error: 'Solo se puede cancelar la última fecha creada' };
        if (this.publico(f).estado !== 'programada') return { error: 'La fecha ya empezó: no se puede cancelar' };

        await this.partidosManager.deleteByFecha(f.tor_id, f.numero);
        this.fechas = this.fechas.filter(x => x.id !== id);
        await this.save();

        return { ok: true };
    }

    // El capitan paga la parte de su equipo. El monto lo define el servidor al crear la fecha
    async pagar(fechaId, equipoId, { metodo = 'tarjeta', simular } = {}) {
        const f = this.getById(fechaId);
        if (!f) return { error: 'No se encontró la fecha' };

        const pago = f.pagos?.[equipoId];
        if (!pago) return { error: 'Tu equipo no tiene que pagar esta fecha' };
        if (pago.estado === 'pagado') return this.publico(f); // ya pagada: no se cobra de nuevo
        if (pago.estado === 'vencido' || Date.now() > Date.parse(f.vencePago)) return { error: 'Venció el plazo para pagar esta fecha (23:59 del día anterior)' };

        this.procesando ??= new Set();
        const clave = `${fechaId}:${equipoId}`;
        if (this.procesando.has(clave)) return { error: 'El pago ya se está procesando' };
        this.procesando.add(clave);

        try {
            const r = await cobrar({ monto: pago.monto, metodo: metodo === 'mercadopago' ? 'mercadopago' : 'tarjeta', simular });
            if (!r.ok) return { error: r.motivo };

            // Por si vencio mientras se procesaba el cobro (el pago simulado tarda ~1 s)
            if (pago.estado !== 'pendiente') return { error: 'Venció el plazo para pagar esta fecha' };

            f.pagos[equipoId] = { ...pago, estado: 'pagado', pago: { id: r.id, metodo: r.metodo, monto: r.monto, fecha: new Date().toISOString() } };
            await this.save();

            return this.publico(f);
        } finally {
            this.procesando.delete(clave);
        }
    }

    // Vencimiento: marca como vencidos los pagos pendientes. Devuelve los equipos que no pagaron
    async vencerPagos(fechaId) {
        const f = this.getById(fechaId);
        if (!f?.pagos || f.pagosProcesados) return null;

        const noPagaron = [];
        for (const [equipoId, p] of Object.entries(f.pagos)) {
            if (p.estado === 'pendiente') { p.estado = 'vencido'; noPagaron.push(equipoId); }
        }

        f.pagosProcesados = true;
        await this.save();

        return noPagaron;
    }

    // Fechas con cobro cuyo plazo ya vencio y todavia no se procesaron
    vencidasSinProcesar(ahora = Date.now()) {
        return this.fechas.filter(f => f.pagos && !f.pagosProcesados && ahora > Date.parse(f.vencePago));
    }

    // "Tu proxima fecha" del capitan: por cada torneo en curso donde esta su equipo, la fecha mas cercana que todavia no termino
    proximasDeClub(clubId, torneosManager, amistososManager, multasManager) {
        const ahora = Date.now();
        const salida = [];

        for (const eq of this.equiposManager.getEquipos().filter(e => e.club_id === clubId)) {
            const tor = torneosManager.getTorneoById(eq.tor_id);
            if (tor.error || tor.estado !== 'en-curso') continue;

            const f = this.fechas
                .filter(x => x.tor_id === tor.id && this.rango(x).fin > ahora)
                .sort((a, b) => a.numero - b.numero)[0];
            if (!f) continue;

            const p = this.partidosManager.getPartidos().find(x => x.tor_id === tor.id && x.fecha === f.numero && (x.home_id === eq.id || x.away_id === eq.id));
            const rivalId = p ? (p.home_id === eq.id ? p.away_id : p.home_id) : null;
            const rival = rivalId ? this.equiposManager.getEquipoById(rivalId) : null;

            // Resultado del vencimiento: W.O. a favor (el rival no pago), en contra (no pagaste) o doble
            const soyLocal = p?.home_id === eq.id;
            const wo = !p?.wo ? null
                : p.wo === 'doble' ? 'doble'
                : (p.wo === 'local') === soyLocal ? 'en-contra' : 'a-favor';

            // Si ganaste por W.O., el amistoso express que se publico para que puedan jugar igual
            const ami = wo === 'a-favor' ? amistososManager?.getByPartido(p.id) : null;
            const miPago = f.pagos?.[eq.id];
            const multa = multasManager?.multas.find(m => m.fecha_id === f.id && m.equipoId === eq.id);

            salida.push({
                torneo: { id: tor.id, nombre: tor.nombre, modalidad: tor.modalidad, sede: tor.sede, direccion: tor.direccion, zona: tor.zona, organizador: tor.organizador, organizadorId: tor.organizadorId },
                fecha: this.publico(f, ahora),
                equipo: { id: eq.id, name: eq.name },
                partido: p ? { id: p.id, date: p.date, cancha: p.cancha ?? null, local: soyLocal, rival: { id: rival.id, name: rival.name, logo: rival.logo }, wo } : null, // null = te toca libre
                // null = sin cobro online (fecha vieja) o te toca libre
                pago: miPago ? { estado: miPago.estado, monto: miPago.monto, vence: f.vencePago } : null,
                // Si el rival dejo vencer el pago (sirve cuando el torneo no tiene penalizacion: no hay W.O. automatico)
                rivalPago: rivalId ? f.pagos?.[rivalId]?.estado ?? null : null,
                multa: multa ? { monto: multa.monto, estado: multa.estado } : null,
                reglas: f.reglas ?? null,
                amistoso: ami ? { id: ami.id, estado: ami.estado, precio: ami.precio, rival: ami.rival ? { name: ami.rival.name, logo: ami.rival.logo } : null } : null,
            });
        }

        return salida.sort((a, b) => this.rango(a.fecha).ini - this.rango(b.fecha).ini);
    }
}

export default FechasManager;
