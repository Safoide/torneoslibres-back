import { torneosManager, inscripcionesManager, fechasManager } from '../manager/instances.js';
import { finCierre, cierreDe, hoyAR } from '../manager/torneosManager.js';
import { q, tx } from '../db/index.js';
import { avisarEstados, avisarDevoluciones } from './avisosService.js';
import { generarDevoluciones } from './saldosService.js';

// Estados del torneo:
//   proximamente ⇄ inscripcion-abierta → inscripcion-cerrada → en-curso → finalizado
//
// Automáticos (cada minuto, en app.js):
//  - Al pasar el día de cierre (23:59), la inscripción abierta se cierra. Si alguien está pagando en ese momento,
//    se espera a que termine (empezó antes del cierre: se le respeta).
//  - El día de inicio, el torneo con la inscripción cerrada y al menos 2 equipos pasa a "en curso".
//    Con menos de 2 no arranca: el organizador ve un aviso para cambiar la fecha de inicio.
// Manuales (el organizador, con PUT /torneos/:id/estado): abrir, volver a "próximamente", cerrar antes,
// reabrir y finalizar. Nunca se vuelve de "en curso" o "finalizado" a un estado anterior.
//
// Cada cambio es un update condicional (where estado = ...): si dos cosas cambian el estado a la vez,
// solo una gana y nunca se pisa un estado más nuevo.

export const MIN_EQUIPOS = 2;

const pasar = async (torId, desde, hacia) => {
    const r = await q().updateTable('torneos').set({ estado: hacia })
        .where('id', '=', torId).where('estado', 'in', [].concat(desde))
        .executeTakeFirst();
    return Number(r.numUpdatedRows) === 1;
};

const cantidadFechas = async (torId) => (await fechasManager.filasDeTorneo([torId])).length;

let enCurso = null; // una sola corrida a la vez

export const procesarEstados = (ahora = Date.now()) => {
    enCurso ??= correr(ahora).finally(() => { enCurso = null; });
    return enCurso;
};

const correr = async (ahora) => {
    const resumen = { cerradas: 0, empezados: 0 };
    const hoy = hoyAR();
    // Para los avisos por mail (se mandan al final, en segundo plano)
    const cambios = { cerradas: [], empezados: [], sinEquipos: [] };

    for (const tor of await torneosManager.getTorneos()) {
        let estado = tor.estado;

        if (estado === 'inscripcion-abierta' && ahora > finCierre(tor) && !inscripcionesManager.reservados(tor.id)) {
            if (await pasar(tor.id, 'inscripcion-abierta', 'inscripcion-cerrada')) {
                estado = 'inscripcion-cerrada';
                resumen.cerradas++;
                cambios.cerradas.push(tor.id);
            }
        }

        if (estado === 'inscripcion-cerrada' && hoy >= tor.fechaInicio) {
            if (tor.equiposInscriptos >= MIN_EQUIPOS) {
                if (await pasar(tor.id, 'inscripcion-cerrada', 'en-curso')) {
                    resumen.empezados++;
                    cambios.empezados.push(tor.id);
                }
            } else {
                cambios.sinEquipos.push(tor.id); // el aviso se manda una sola vez por fecha de inicio
            }
        }
    }

    if (resumen.cerradas || resumen.empezados) console.log('Estados de torneos actualizados:', resumen);
    if (cambios.cerradas.length || cambios.empezados.length || cambios.sinEquipos.length) avisarEstados(cambios);
    return resumen;
};

// Cambio manual del organizador. Devuelve el torneo actualizado o { error }
export const cambiarEstado = async (tor, nuevo, ahora = Date.now()) => {
    const actual = tor.estado;
    if (nuevo === actual) return tor;

    const pasarO = async (desde, error) => (await pasar(tor.id, desde, nuevo))
        ? torneosManager.getTorneoById(tor.id)
        : { error: error ?? 'El estado del torneo cambió recién. Recargá la página.' };

    switch (nuevo) {
        // Abrir (desde "próximamente") o reabrir (desde "cerrada", si todavía no hay fechas)
        case 'inscripcion-abierta': {
            if (!['proximamente', 'inscripcion-cerrada'].includes(actual)) return { error: 'La inscripción ya no se puede abrir: el torneo empezó' };
            if (actual === 'inscripcion-cerrada' && await cantidadFechas(tor.id)) {
                return { error: 'Ya creaste fechas: la inscripción no se puede reabrir (el fixture se armó con estos equipos)' };
            }
            if (ahora > finCierre(tor)) {
                return { error: `El cierre de inscripción (${cierreDe(tor)}) ya pasó. Cambiá las fechas del torneo para volver a abrirla.` };
            }
            return pasarO(['proximamente', 'inscripcion-cerrada']);
        }

        // Volver a "próximamente": solo si todavía no se anotó nadie (si no, los equipos verían el torneo "sin abrir")
        case 'proximamente': {
            if (actual !== 'inscripcion-abierta') return { error: 'Solo una inscripción abierta puede volver a "próximamente"' };
            if (tor.equiposInscriptos > 0 || inscripcionesManager.reservados(tor.id)) {
                return { error: 'Ya hay equipos inscriptos: cerrá la inscripción en lugar de volver a "próximamente"' };
            }
            return pasarO('inscripcion-abierta');
        }

        // Cerrar antes de la fecha de cierre (por ejemplo, porque ya están los equipos)
        case 'inscripcion-cerrada': {
            if (actual !== 'inscripcion-abierta') return { error: 'La inscripción no está abierta' };
            if (inscripcionesManager.reservados(tor.id)) return { error: 'Hay un equipo pagando la inscripción en este momento. Probá de nuevo en unos segundos.' };
            return pasarO('inscripcion-abierta');
        }

        case 'en-curso':
            return { error: `El torneo empieza solo el día de inicio (${tor.fechaInicio}), con la inscripción cerrada y al menos ${MIN_EQUIPOS} equipos` };

        // Finalizar: con todas las fechas ya jugadas (si faltan resultados, el front lo avisa antes)
        case 'finalizado': {
            if (actual !== 'en-curso') return { error: 'Solo se puede finalizar un torneo en curso' };
            const pendiente = (await fechasManager.getRawByTorneo(tor.id)).find(f => f.estado !== 'jugada');
            if (pendiente) return { error: `La fecha ${pendiente.numero} todavía no se jugó: esperá a que termine o cancelala antes de finalizar` };

            // Junto con el cambio de estado: los saldos a favor que quedaron pasan a devoluciones pendientes
            const devoluciones = await tx(async () => (await pasar(tor.id, 'en-curso', 'finalizado')) ? generarDevoluciones(tor.id) : null);
            if (!devoluciones) return { error: 'El estado del torneo cambió recién. Recargá la página.' };
            if (devoluciones.length) avisarDevoluciones(tor, devoluciones);
            return torneosManager.getTorneoById(tor.id);
        }

        default:
            return { error: 'Estado no válido' };
    }
};
