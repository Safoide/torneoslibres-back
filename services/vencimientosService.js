import { fechasManager, partidosManager, equiposManager, torneosManager, amistososManager, multasManager } from '../manager/instances.js';
import { REGLAS_DEFAULT, montoMulta } from '../manager/torneosManager.js';
import { recalcularTabla } from './fixtureService.js';

// Procesa las fechas cuyo plazo de pago (23:59 del dia anterior) ya vencio, segun las reglas del torneo
// (copiadas en la fecha al crearla):
//  - Sin penalizacion: los pagos pendientes quedan "vencidos" y no pasa nada mas; decide el organizador.
//  - Con penalizacion: el que no pago pierde 0-3 por W.O. y recibe la multa (si es mayor a 0).
//    Si ademas estan activados los amistosos express, su lugar se publica como amistoso.
//    Si no pago ninguno de los dos: W.O. doble (los dos pierden, sin goles), multa para ambos y sin amistoso.
// Se corre al arrancar, cada minuto (app.js) y antes de responder las rutas que muestran estos datos.

let enCurso = null; // si ya se esta procesando, los demas esperan esa misma corrida

export const procesarVencimientos = (ahora = Date.now()) => {
    enCurso ??= correr(ahora).finally(() => { enCurso = null; });
    return enCurso;
};

const correr = async (ahora) => {
    const resumen = { fechas: 0, wo: 0, dobles: 0, amistosos: 0, multas: 0 };

    for (const f of fechasManager.vencidasSinProcesar(ahora)) {
        const noPagaron = new Set(await fechasManager.vencerPagos(f.id) ?? []);
        resumen.fechas++;

        const reglas = { ...REGLAS_DEFAULT, ...(f.reglas ?? {}) };
        if (!noPagaron.size || !reglas.penalizacion) continue;

        const tor = torneosManager.getTorneoById(f.tor_id);
        if (tor.error) continue;

        const multa = montoMulta(reglas, f.precio);
        const partidos = partidosManager.getPartidos().filter(p => p.tor_id === f.tor_id && p.fecha === f.numero);

        for (const p of partidos) {
            const local = noPagaron.has(p.home_id);
            const visita = noPagaron.has(p.away_id);
            if (!local && !visita) continue;

            for (const id of [local && p.home_id, visita && p.away_id].filter(Boolean)) {
                if (await multasManager.crear({ tor, fecha: f, equipo: equiposManager.getEquipoById(id), monto: multa })) resumen.multas++;
            }

            if (local && visita) {
                await partidosManager.editMatch(p.id, { wo: 'doble', home_goals: null, away_goals: null });
                resumen.dobles++;
                continue;
            }

            // Gana 3-0 el que pago
            await partidosManager.editMatch(p.id, { wo: local ? 'local' : 'visita', home_goals: local ? 0 : 3, away_goals: local ? 3 : 0 });
            resumen.wo++;

            if (reglas.amistosos) {
                const anfitrion = equiposManager.getEquipoById(local ? p.away_id : p.home_id);
                const ausente = equiposManager.getEquipoById(local ? p.home_id : p.away_id);
                await amistososManager.publicar({ tor, fecha: f, partido: p, anfitrion, ausente });
                resumen.amistosos++;
            }
        }

        await recalcularTabla(f.tor_id);
    }

    if (resumen.fechas) console.log('Vencimientos de pago procesados:', resumen);
    return resumen;
};
