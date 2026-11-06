import { formatId } from '../assets.js';
import { q, tx, siguienteId } from '../db/index.js';
import { aFila, deFila, deFilas } from '../db/filas.js';
import { rondasDe } from '../services/fixtureService.js';
import { cobrar } from '../services/pagosService.js';
import { reglasDe } from './torneosManager.js';
import { equiposManager, partidosManager, torneosManager, amistososManager, multasManager } from './instances.js';

const DURACION = { f5: 40, f7: 50, f8: 60, f11: 90 }; // minutos por partido
export const ANTICIPACION_DIAS = 3; // las fechas se publican con al menos 3 dias de anticipacion
const HORA_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const AR = '-03:00'; // Argentina no usa horario de verano

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
    constructor() {
        this.procesando = new Set(); // evita cobrar dos veces si se toca "Pagar" dos veces
    }

    // Arma cada fecha como antes: pagos = { [equipoId]: { estado, monto, pago? } } si tiene cobro online, y si no, sin pagos
    async armar(filas) {
        const fechas = deFilas('fechas', filas);
        const conCobro = fechas.filter(f => f.cobro).map(f => f.id);
        const pagos = conCobro.length
            ? deFilas('fecha_pagos', await q().selectFrom('fecha_pagos').selectAll().where('fechaId', 'in', conCobro).orderBy('orden').execute())
            : [];

        return fechas.map(({ cobro, ...f }) => {
            if (!cobro) return f;
            const deEsta = pagos.filter(p => p.fechaId === f.id);
            return { ...f, pagos: Object.fromEntries(deEsta.map(({ fechaId, equipoId, orden, pago, ...p }) => [equipoId, pago ? { ...p, pago } : p])) };
        });
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

    async filasDeTorneo(torIds) {
        return torIds.length
            ? q().selectFrom('fechas').selectAll().where('tor_id', 'in', torIds).orderBy('numero', 'desc').execute()
            : [];
    }

    async getByTorneo(torId) {
        return (await this.armar(await this.filasDeTorneo([String(torId ?? '')]))).map(f => this.publico(f));
    }

    // Igual que getByTorneo pero con el detalle de pagos (panel del organizador, vencimientos)
    async getRawByTorneo(torId) {
        return (await this.armar(await this.filasDeTorneo([String(torId ?? '')]))).map(f => this.conEstado(f));
    }

    async getRawByTorneos(torIds) {
        return (await this.armar(await this.filasDeTorneo(torIds))).map(f => this.conEstado(f));
    }

    async getById(id) {
        const fila = await q().selectFrom('fechas').selectAll().where('id', '=', String(id ?? '')).executeTakeFirst();
        return fila ? (await this.armar([fila]))[0] : null;
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

        // Todo junto en una transaccion: los partidos, la fecha y los pagos se crean todos o ninguno
        return tx(async () => {
            const ultima = await q().selectFrom('fechas').selectAll().where('tor_id', '=', tor.id).orderBy('numero', 'desc').executeTakeFirst();
            if (ultima && dia <= ultima.dia) return { error: `El día tiene que ser posterior al de la fecha ${ultima.numero} (${ultima.dia})` };

            const numero = (ultima?.numero ?? 0) + 1;
            const equipos = await equiposManager.getByTorneo(tor.id);
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
                id: formatId('FECHA', await siguienteId('fechas', 'FECHA')),
                tor_id: tor.id, numero, dia, inicio, fin, canchas, precio: tor.precioFecha, creada: new Date().toISOString(),
                // Cada equipo que juega paga su parte antes del vencimiento; el que tiene fecha libre no paga.
                // Si no paga a tiempo pierde por W.O. (ver services/vencimientosService.js)
                cobro: true,
                vencePago: vencimientoPago(dia),
                // Copia de las reglas del torneo al crear la fecha: penalizacion (W.O. + multa) y amistosos express
                reglas: reglasDe(tor),
                pagosProcesados: false,
            };

            await partidosManager.addMatches(partidos.map(([local, visita], i) => ({
                tor_id: tor.id, fecha: numero, home_id: local.id, away_id: visita.id,
                date: aIso(ini + Math.floor(i / canchas) * dur * 60000), cancha: (i % canchas) + 1,
                home_goals: null, away_goals: null,
            })));

            await q().insertInto('fechas').values(aFila('fechas', fecha)).execute();
            await q().insertInto('fecha_pagos')
                .values(partidos.flat().map((eq, orden) => ({ fechaId: fecha.id, equipoId: eq.id, orden, estado: 'pendiente', monto: tor.precioFecha })))
                .execute();

            return this.publico(await this.getById(fecha.id));
        });
    }

    // Solo se puede cancelar la ultima fecha y antes de que empiece
    async eliminar(id) {
        const f = await this.getById(id);
        if (!f) return { error: 'No se encontró la fecha' };

        const posterior = await q().selectFrom('fechas').select('id').where('tor_id', '=', f.tor_id).where('numero', '>', f.numero).executeTakeFirst();
        if (posterior) return { error: 'Solo se puede cancelar la última fecha creada' };
        if (this.estadoDe(f) !== 'programada') return { error: 'La fecha ya empezó: no se puede cancelar' };

        await tx(async () => {
            await partidosManager.deleteByFecha(f.tor_id, f.numero);
            await q().deleteFrom('fecha_pagos').where('fechaId', '=', id).execute();
            await q().deleteFrom('fechas').where('id', '=', id).execute();
        });

        return { ok: true };
    }

    // El capitan paga la parte de su equipo. El monto lo define el servidor al crear la fecha
    async pagar(fechaId, equipoId, { metodo = 'tarjeta', simular } = {}) {
        const f = await this.getById(fechaId);
        if (!f) return { error: 'No se encontró la fecha' };

        const pago = f.pagos?.[equipoId];
        if (!pago) return { error: 'Tu equipo no tiene que pagar esta fecha' };
        if (pago.estado === 'pagado') return this.publico(f); // ya pagada: no se cobra de nuevo
        if (pago.estado === 'vencido' || Date.now() > Date.parse(f.vencePago)) return { error: 'Venció el plazo para pagar esta fecha (23:59 del día anterior)' };

        const clave = `${fechaId}:${equipoId}`;
        if (this.procesando.has(clave)) return { error: 'El pago ya se está procesando' };
        this.procesando.add(clave);

        try {
            const r = await cobrar({ monto: pago.monto, metodo: metodo === 'mercadopago' ? 'mercadopago' : 'tarjeta', simular });
            if (!r.ok) return { error: r.motivo };

            // Solo si sigue pendiente: si vencio mientras se procesaba el cobro (tarda ~1 s), no se marca
            const datos = { id: r.id, metodo: r.metodo, monto: r.monto, fecha: new Date().toISOString() };
            const act = await q().updateTable('fecha_pagos').set({ estado: 'pagado', pago: JSON.stringify(datos) })
                .where('fechaId', '=', fechaId).where('equipoId', '=', equipoId).where('estado', '=', 'pendiente')
                .executeTakeFirst();
            if (!Number(act.numUpdatedRows)) return { error: 'Venció el plazo para pagar esta fecha' };

            return this.publico(await this.getById(fechaId));
        } finally {
            this.procesando.delete(clave);
        }
    }

    // Vencimiento: marca como vencidos los pagos pendientes. Devuelve los equipos que no pagaron
    // (null si la fecha ya se habia procesado). Llamarlo dentro de tx().
    async vencerPagos(fechaId) {
        const marcada = await q().updateTable('fechas').set({ pagosProcesados: 1 })
            .where('id', '=', fechaId).where('cobro', '=', 1).where('pagosProcesados', '=', 0).executeTakeFirst();
        if (!Number(marcada.numUpdatedRows)) return null;

        const pendientes = await q().selectFrom('fecha_pagos').select('equipoId')
            .where('fechaId', '=', fechaId).where('estado', '=', 'pendiente').execute();
        await q().updateTable('fecha_pagos').set({ estado: 'vencido' })
            .where('fechaId', '=', fechaId).where('estado', '=', 'pendiente').execute();

        return pendientes.map(p => p.equipoId);
    }

    // Fechas con cobro cuyo plazo ya vencio y todavia no se procesaron
    async vencidasSinProcesar(ahora = Date.now()) {
        const filas = await q().selectFrom('fechas').selectAll().where('cobro', '=', 1).where('pagosProcesados', '=', 0).execute();
        return deFilas('fechas', filas).filter(f => ahora > Date.parse(f.vencePago));
    }

    // "Tu proxima fecha" del capitan: por cada torneo en curso donde esta su equipo, la fecha mas cercana que todavia no termino
    async proximasDeClub(clubId) {
        const ahora = Date.now();
        const salida = [];

        for (const eq of await equiposManager.getByClub(clubId)) {
            const tor = await torneosManager.getTorneoById(eq.tor_id);
            if (tor.error || tor.estado !== 'en-curso') continue;

            const f = (await this.armar(await q().selectFrom('fechas').selectAll().where('tor_id', '=', tor.id).orderBy('numero').execute()))
                .find(x => this.rango(x).fin > ahora);
            if (!f) continue;

            const p = (await partidosManager.getByFecha(tor.id, f.numero)).find(x => x.home_id === eq.id || x.away_id === eq.id);
            const rivalId = p ? (p.home_id === eq.id ? p.away_id : p.home_id) : null;
            const rival = rivalId ? await equiposManager.getEquipoById(rivalId) : null;

            // Resultado del vencimiento: W.O. a favor (el rival no pago), en contra (no pagaste) o doble
            const soyLocal = p?.home_id === eq.id;
            const wo = !p?.wo ? null
                : p.wo === 'doble' ? 'doble'
                : (p.wo === 'local') === soyLocal ? 'en-contra' : 'a-favor';

            // Si ganaste por W.O., el amistoso express que se publico para que puedan jugar igual
            const ami = wo === 'a-favor' ? await amistososManager.getByPartido(p.id) : null;
            const miPago = f.pagos?.[eq.id];
            const multa = await multasManager.getDe(f.id, eq.id);

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
