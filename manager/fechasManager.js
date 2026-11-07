import { formatId } from '../assets.js';
import { q, tx, siguienteId } from '../db/index.js';
import { aFila, deFila, deFilas } from '../db/filas.js';
import { rondasDe, recalcularTabla } from '../services/fixtureService.js';
import { cobrar } from '../services/pagosService.js';
import { saldoDe, saldosDeTorneo, moverSaldo } from '../services/saldosService.js';
import { reglasDe, cobraPorFecha, hoyAR, sumarDias, ANTICIPACION_DIAS } from './torneosManager.js';
import { equiposManager, partidosManager, torneosManager, amistososManager, multasManager } from './instances.js';

export { ANTICIPACION_DIAS }; // las fechas con cobro se publican con al menos 3 dias de anticipacion
const DURACION = { f5: 40, f7: 50, f8: 60, f11: 90 }; // minutos por partido
const HORA_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const AR = '-03:00'; // Argentina no usa horario de verano

const aMs = (dia, hhmm) => new Date(`${dia}T${hhmm}:00${AR}`).getTime();
// ms -> "2026-11-07T16:00:00-03:00"
const aIso = (ms) => new Date(ms - 3 * 3600e3).toISOString().slice(0, 19) + AR;
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

        // avisoResultados: control interno de los avisos por mail
        return fechas.map(({ cobro, avisoResultados, ...f }) => {
            if (!cobro) return f;
            const deEsta = pagos.filter(p => p.fechaId === f.id);
            return { ...f, pagos: Object.fromEntries(deEsta.map(({ fechaId, equipoId, orden, pago, recordado, ...p }) => [equipoId, pago ? { ...p, pago } : p])) };
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

    async getByNumero(torId, numero) {
        const fila = await q().selectFrom('fechas').selectAll().where('tor_id', '=', String(torId ?? '')).where('numero', '=', Number(numero)).executeTakeFirst();
        return fila ? (await this.armar([fila]))[0] : null;
    }

    // Primer dia permitido para una fecha nueva: con cobro, 3 dias de anticipacion (para que paguen);
    // sin cobro, desde hoy. Nunca antes del inicio del torneo
    minimoDia(tor) {
        const porAnticipacion = cobraPorFecha(tor) ? sumarDias(hoyAR(), ANTICIPACION_DIAS) : hoyAR();
        return porAnticipacion > tor.fechaInicio ? porAnticipacion : tor.fechaInicio;
    }

    async crear(tor, data = {}) {
        // Las fechas se arman con la lista de equipos cerrada: desde que cierra la inscripcion (antes del inicio)
        if (tor.estado === 'finalizado') return { error: 'El torneo ya terminó' };
        if (tor.estado !== 'inscripcion-cerrada' && tor.estado !== 'en-curso') {
            return { error: 'Las fechas se crean cuando cierra la inscripción: así el fixture se arma con todos los equipos' };
        }

        const dia = String(data.dia ?? '').trim();
        const inicio = String(data.inicio ?? '').trim();
        const fin = String(data.fin ?? '').trim();
        const canchas = Number(data.canchas ?? 2);
        const conCobro = cobraPorFecha(tor);

        const d = new Date(`${dia}T00:00:00Z`);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dia) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== dia) return { error: 'El día no es válido' };
        if (dia < tor.fechaInicio) return { error: `El torneo empieza el ${tor.fechaInicio}: las fechas tienen que ser desde ese día` };
        const minimo = this.minimoDia(tor);
        if (dia < minimo) {
            return { error: conCobro
                ? `Las fechas con cobro se publican con al menos ${ANTICIPACION_DIAS} días de anticipación, para que los equipos puedan pagar a tiempo. Elegí un día desde el ${minimo}.`
                : `Elegí un día desde el ${minimo}.` };
        }
        if (!HORA_RE.test(inicio) || !HORA_RE.test(fin)) return { error: 'Elegí un horario de inicio y de finalización válidos' };
        if (inicio === fin) return { error: 'El horario de inicio y de finalización no pueden ser iguales' };
        if (!Number.isInteger(canchas) || canchas < 1 || canchas > 8) return { error: 'La cantidad de canchas debe ser entre 1 y 8' };
        // Sin cobro se puede crear para hoy, pero no una fecha que ya empezó
        if (this.rango({ dia, inicio, fin }).ini <= Date.now()) return { error: 'Ese horario ya pasó: elegí uno que todavía no haya empezado' };

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
                // Con precio por fecha, cada equipo que juega paga su parte antes del vencimiento (el que tiene fecha
                // libre no paga) y si no paga a tiempo pierde por W.O. (ver services/vencimientosService.js).
                // Con precio $0 (el torneo se paga todo con la inscripcion) la fecha no tiene cobro ni vencimiento
                cobro: conCobro,
                vencePago: conCobro ? vencimientoPago(dia) : null,
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
            if (conCobro) {
                await q().insertInto('fecha_pagos')
                    .values(partidos.flat().map((eq, orden) => ({ fechaId: fecha.id, equipoId: eq.id, orden, estado: 'pendiente', monto: tor.precioFecha })))
                    .execute();

                // Saldo a favor (de una fecha cancelada): si alcanza para toda la parte, la fecha queda paga sola.
                // Si alcanza para una parte, se descuenta cuando pague (ver pagar)
                const saldos = await saldosDeTorneo(tor.id);
                for (const eq of partidos.flat()) {
                    if ((saldos.get(eq.id) ?? 0) < tor.precioFecha) continue;
                    const pago = { id: null, metodo: 'saldo', monto: tor.precioFecha, cobrado: 0, saldo: tor.precioFecha, fecha: new Date().toISOString() };
                    await q().updateTable('fecha_pagos').set({ estado: 'pagado', pago: JSON.stringify(pago) })
                        .where('fechaId', '=', fecha.id).where('equipoId', '=', eq.id).execute();
                    await moverSaldo({ equipoId: eq.id, torId: tor.id, monto: -tor.precioFecha, motivo: 'pago-fecha', fechaNumero: numero });
                }
            }

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

        // Un amistoso express ya tomado lo pagó otro equipo (puede ser de otro torneo): el saldo no le sirve
        const tomado = await q().selectFrom('amistosos').select('id').where('fecha_id', '=', id).where('estado', '=', 'tomado').executeTakeFirst();
        if (tomado) return { error: 'Un equipo ya tomó el amistoso express de esta fecha: no se puede cancelar' };

        // Lo que pagó cada equipo queda como saldo a favor en el torneo, para sus próximas fechas.
        // Si el pago ya había vencido (cancelación el mismo día), además se deshace lo del vencimiento:
        // las multas pendientes se anulan, las pagadas pasan a saldo, se borran los amistosos y la tabla se recalcula sin los W.O.
        const acreditados = new Map(); // equipoId -> monto
        const sumar = (equipoId, monto) => acreditados.set(equipoId, (acreditados.get(equipoId) ?? 0) + monto);

        await tx(async () => {
            const pagados = await q().selectFrom('fecha_pagos').select(['equipoId', 'monto'])
                .where('fechaId', '=', id).where('estado', '=', 'pagado').execute();
            for (const p of pagados) {
                await moverSaldo({ equipoId: p.equipoId, torId: f.tor_id, monto: p.monto, motivo: 'fecha-cancelada', fechaNumero: f.numero });
                sumar(p.equipoId, p.monto);
            }

            // Las multas se borran (los ids de las fechas se reutilizan: una multa vieja chocaría con la de la fecha nueva).
            // La pagada pasa a saldo: el movimiento deja registrado de dónde salió
            const multas = await q().selectFrom('multas').select(['id', 'equipoId', 'monto', 'estado']).where('fecha_id', '=', id).execute();
            for (const m of multas) {
                if (m.estado === 'pagada') {
                    await moverSaldo({ equipoId: m.equipoId, torId: f.tor_id, monto: m.monto, motivo: 'multa-devuelta', fechaNumero: f.numero });
                    sumar(m.equipoId, m.monto);
                }
            }
            await q().deleteFrom('multas').where('fecha_id', '=', id).execute();

            await q().deleteFrom('amistosos').where('fecha_id', '=', id).where('estado', '=', 'publicado').execute();
            await partidosManager.deleteByFecha(f.tor_id, f.numero);
            await q().deleteFrom('fecha_pagos').where('fechaId', '=', id).execute();
            await q().deleteFrom('fechas').where('id', '=', id).execute();
            await recalcularTabla(f.tor_id); // por si había W.O. aplicados
        });

        return { ok: true, acreditados: [...acreditados].map(([equipoId, monto]) => ({ equipoId, monto })) };
    }

    // Resultados de una fecha terminada (organizador dueño). lista = [{ id, home_goals, away_goals }].
    // Se pueden cargar de a varios y corregir mientras el torneo siga en curso: la tabla se recalcula
    // entera desde los partidos, asi que editar un resultado no deja nada inconsistente.
    // Cuando el torneo pasa a "finalizado" los resultados quedan fijos.
    async cargarResultados(f, tor, lista) {
        if (tor.estado !== 'en-curso') return { error: tor.estado === 'finalizado' ? 'El torneo ya terminó: los resultados no se pueden modificar' : 'El torneo todavía no empezó' };
        if (this.estadoDe(f) !== 'jugada') return { error: 'La fecha todavía no terminó: los resultados se cargan cuando termina' };
        if (!Array.isArray(lista) || !lista.length) return { error: 'No mandaste ningún resultado' };

        const partidos = new Map((await partidosManager.getByFecha(f.tor_id, f.numero)).map(p => [p.id, p]));
        const valido = (n) => Number.isInteger(n) && n >= 0 && n <= 99;
        const cambios = new Map();

        // Solo se toman id y goles de cada item: nunca el objeto entero
        for (const r of lista) {
            const p = partidos.get(String(r?.id ?? ''));
            if (!p) return { error: 'Uno de los partidos no es de esta fecha' };
            if (p.wo) return { error: 'Los partidos definidos por W.O. no admiten cargar resultado' };

            const local = Number(r.home_goals), visita = Number(r.away_goals);
            if (r.home_goals === null || r.home_goals === '' || r.away_goals === null || r.away_goals === ''
                || !valido(local) || !valido(visita)) return { error: 'Los goles deben ser números enteros entre 0 y 99' };

            cambios.set(p.id, { home_goals: local, away_goals: visita });
        }

        // Todos los resultados y la tabla juntos: o se guarda todo o nada
        await tx(async () => {
            for (const [id, goles] of cambios) await partidosManager.editMatch(id, goles);
            await recalcularTabla(f.tor_id);
        });

        return partidosManager.getByFecha(f.tor_id, f.numero);
    }

    // El capitan paga la parte de su equipo. El monto lo define el servidor al crear la fecha
    async pagar(fechaId, equipoId, { metodo = 'tarjeta', simular } = {}) {
        const f = await this.getById(fechaId);
        if (!f) return { error: 'No se encontró la fecha' };

        const pago = f.pagos?.[equipoId];
        if (!pago) return { error: 'Tu equipo no tiene que pagar esta fecha' };
        if (pago.estado === 'pagado') return this.publico(f); // ya pagada: no se cobra de nuevo
        if (pago.estado === 'vencido' || Date.now() > Date.parse(f.vencePago)) return { error: 'Venció el plazo para pagar esta fecha (23:59 del día anterior)' };

        // Por equipo (no por fecha): así el mismo saldo a favor no se usa en dos pagos a la vez
        const clave = `equipo:${equipoId}`;
        if (this.procesando.has(clave)) return { error: 'El pago ya se está procesando' };
        this.procesando.add(clave);

        try {
            // Saldo a favor de una fecha cancelada: se descuenta y se cobra solo la diferencia (puede ser 0)
            const usado = Math.min(await saldoDe(equipoId), pago.monto);
            const aCobrar = pago.monto - usado;

            const r = aCobrar > 0
                ? await cobrar({ monto: aCobrar, metodo: metodo === 'mercadopago' ? 'mercadopago' : 'tarjeta', simular })
                : { ok: true, id: null, metodo: 'saldo', monto: 0 };
            if (!r.ok) return { error: r.motivo };

            // monto = la parte completa (lo cobrado más el saldo usado): así lo cuenta el panel del organizador
            const datos = { id: r.id, metodo: r.metodo, monto: pago.monto, cobrado: r.monto, saldo: usado, fecha: new Date().toISOString() };
            const ok = await tx(async () => {
                // Solo si sigue pendiente: si vencio mientras se procesaba el cobro (tarda ~1 s), no se marca
                const act = await q().updateTable('fecha_pagos').set({ estado: 'pagado', pago: JSON.stringify(datos) })
                    .where('fechaId', '=', fechaId).where('equipoId', '=', equipoId).where('estado', '=', 'pendiente')
                    .executeTakeFirst();
                if (!Number(act.numUpdatedRows)) return false;
                await moverSaldo({ equipoId, torId: f.tor_id, monto: -usado, motivo: 'pago-fecha', fechaNumero: f.numero });
                return true;
            });
            if (!ok) return { error: 'Venció el plazo para pagar esta fecha' };

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
            // Desde que cierra la inscripcion ya puede haber fechas (la 1 se crea antes del inicio)
            if (tor.error || (tor.estado !== 'en-curso' && tor.estado !== 'inscripcion-cerrada')) continue;

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
            const saldo = await saldoDe(eq.id); // a favor, de fechas canceladas
            const usaSaldo = miPago?.estado === 'pendiente' ? Math.min(saldo, miPago.monto) : 0;

            salida.push({
                torneo: { id: tor.id, nombre: tor.nombre, modalidad: tor.modalidad, sede: tor.sede, direccion: tor.direccion, zona: tor.zona, organizador: tor.organizador, organizadorId: tor.organizadorId },
                fecha: this.publico(f, ahora),
                equipo: { id: eq.id, name: eq.name },
                partido: p ? { id: p.id, date: p.date, cancha: p.cancha ?? null, local: soyLocal, rival: { id: rival.id, name: rival.name, logo: rival.logo }, wo } : null, // null = te toca libre
                // null = sin cobro online (fecha vieja) o te toca libre
                // usaSaldo / aPagar: si está pendiente, cuánto se descuenta del saldo y cuánto se cobra.
                // conSaldo: si ya está paga, cuánto se pagó con saldo
                pago: miPago ? {
                    estado: miPago.estado, monto: miPago.monto, vence: f.vencePago,
                    usaSaldo, aPagar: miPago.monto - usaSaldo, conSaldo: miPago.pago?.saldo ?? 0,
                } : null,
                saldo, // saldo a favor disponible en el torneo
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
