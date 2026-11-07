// Avisos por mail (los que se configuran en "Notificaciones", ver notificacionesService.js).
// Cada aviso pasa por avisar(): respeta las preferencias de la cuenta y agrega el link para darse de baja.
// Se mandan fuera de las transacciones y en segundo plano: un mail que falla nunca frena lo que lo disparó.

import { q } from '../db/index.js';
import { SITIO_URL } from '../config.js';
import { firmar } from '../middleware/auth.js';
import { enviarMail, plantilla, textoPlano } from './mailService.js';
import { quiereMail, tituloDe } from './notificacionesService.js';
import { fechasManager, partidosManager, torneosManager, amistososManager, multasManager } from '../manager/instances.js';
import { REGLAS_DEFAULT, montoMulta, sumarDias } from '../manager/torneosManager.js';

const AR = '-03:00';
const HORA_RECORDATORIO = '10:00'; // el recordatorio de pago sale el día que vence, desde esta hora

// ---------- Formatos ----------

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
// '2026-11-14' -> 'sábado 14/11' (a mano: el formato de Intl cambia según la versión de Node)
export const diaTexto = (dia) => `${DIAS[new Date(`${dia}T12:00:00Z`).getUTCDay()]} ${dia.slice(8, 10)}/${dia.slice(5, 7)}`;
// '2026-11-14T16:00:00-03:00' -> '16:00'
const horaDe = (iso) => String(iso ?? '').slice(11, 16);
const fmtPrecio = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
export const precioTexto = (n) => fmtPrecio.format(n ?? 0).replace(/\s/g, ' '); // sin cortar entre $ y el número

// ---------- Base ----------

// Link para dejar de recibir un tipo de aviso sin iniciar sesión (firmado: no se puede armar para otra cuenta)
export const firmaBaja = (usuarioId, tipo) => firmar(`baja:${usuarioId}:${tipo}`);
export const linkBaja = (usuarioId, tipo) =>
    `${SITIO_URL}/baja?u=${encodeURIComponent(usuarioId)}&a=${encodeURIComponent(tipo)}&f=${firmaBaja(usuarioId, tipo)}`;

// Manda el aviso si la cuenta lo tiene activado. mail: { asunto, titulo, parrafos?, detalles?, boton?, link?, pie? }
export const avisar = async (usuario, tipo, mail) => {
    if (!usuario?.email || !quiereMail(usuario, tipo)) return false;

    const baja = { texto: `Te llega porque tenés activado el aviso "${tituloDe(tipo)}".`, link: linkBaja(usuario.id, tipo) };
    const datos = { ...mail, baja };
    return enviarMail({
        para: usuario.email, asunto: mail.asunto,
        texto: textoPlano(datos), html: plantilla(datos),
        headers: { 'List-Unsubscribe': `<${baja.link}>` },
    });
};

const enSegundoPlano = (promesa, que) => promesa.catch((err) => console.error(`Error mandando avisos (${que}):`, err));

// El capitán (cuenta) de cada equipo: Map equipoId -> usuario. Los equipos sin club (datos viejos) no tienen
const capitanesDe = async (equipoIds) => {
    if (!equipoIds.length) return new Map();
    const filas = await q().selectFrom('equipos')
        .innerJoin('clubes', 'clubes.id', 'equipos.club_id')
        .innerJoin('usuarios', 'usuarios.id', 'clubes.ownerId')
        .select(['equipos.id as equipoId', 'usuarios.id', 'usuarios.nombre', 'usuarios.email', 'usuarios.rol', 'usuarios.notificaciones', 'usuarios.novedades'])
        .where('equipos.id', 'in', equipoIds)
        .execute();
    return new Map(filas.map(({ equipoId, ...u }) => [equipoId, u]));
};

// La cuenta del organizador dueño del torneo (o null)
const organizadorDe = async (tor) => (await q().selectFrom('organizadores')
    .innerJoin('usuarios', 'usuarios.id', 'organizadores.ownerId')
    .select(['usuarios.id', 'usuarios.nombre', 'usuarios.email', 'usuarios.rol', 'usuarios.notificaciones', 'usuarios.novedades'])
    .where('organizadores.id', '=', tor.organizadorId)
    .executeTakeFirst()) ?? null;

// Nombres de los equipos: Map id -> nombre
const nombresDe = async (equipoIds) => {
    if (!equipoIds.length) return new Map();
    const filas = await q().selectFrom('equipos').select(['id', 'name']).where('id', 'in', equipoIds).execute();
    return new Map(filas.map((e) => [e.id, e.name]));
};

// Qué pasa si no paga a tiempo, según las reglas copiadas en la fecha
const consecuencia = (reglas, precio) => {
    const r = { ...REGLAS_DEFAULT, ...(reglas ?? {}) };
    if (!r.penalizacion) return 'Si no la pagás a tiempo, el organizador decide qué pasa con el partido.';
    const multa = montoMulta(r, precio);
    return `Si no la pagás a tiempo, perdés el partido 0-3 por W.O.${multa ? ` y te llega una multa de ${precioTexto(multa)}` : ''}.`;
};

const sedeTexto = (tor) => [tor.sede, [tor.direccion, tor.zona].filter(Boolean).join(', ')].filter(Boolean).join(' · ');

// ---------- Fecha nueva (capitanes) ----------

// fecha: la que devuelve fechasManager.crear (con numero, dia, vencePago, reglas)
export const avisarFechaNueva = (tor, fecha) => enSegundoPlano(fechaNueva(tor, fecha), 'fecha nueva');

const fechaNueva = async (tor, fecha) => {
    const partidos = await partidosManager.getByFecha(tor.id, fecha.numero);
    const equipos = await q().selectFrom('equipos').select(['id', 'name']).where('tor_id', '=', tor.id).execute();
    const nombres = new Map(equipos.map((e) => [e.id, e.name]));
    const capitanes = await capitanesDe(equipos.map((e) => e.id));
    const conCobro = !!fecha.vencePago;
    const dia = diaTexto(fecha.dia);

    for (const eq of equipos) {
        const capitan = capitanes.get(eq.id);
        if (!capitan) continue;

        const p = partidos.find((x) => x.home_id === eq.id || x.away_id === eq.id);
        if (!p) {
            await avisar(capitan, 'fechaNueva', {
                asunto: `Fecha ${fecha.numero} de ${tor.nombre}: te toca libre`,
                titulo: `Fecha ${fecha.numero}: te toca libre`,
                parrafos: [`En la fecha ${fecha.numero} de ${tor.nombre} (${dia}) ${eq.name} no juega: con una cantidad impar de equipos, a uno le toca libre cada fecha.`],
                boton: 'Ver el fixture', link: `${SITIO_URL}/partidos/${tor.id}`,
            });
            continue;
        }

        const rival = nombres.get(p.home_id === eq.id ? p.away_id : p.home_id) ?? 'a confirmar';
        const detalles = [
            ['Día', dia],
            ['Hora', horaDe(p.date)],
            ...(p.cancha ? [['Cancha', `Cancha ${p.cancha}`]] : []),
            ['Rival', rival],
            ['Sede', sedeTexto(tor)],
            ...(conCobro ? [['Tu parte', `${precioTexto(fecha.precio)} · hasta el ${diaTexto(fecha.vencePago.slice(0, 10))} a las 23:59`]] : []),
        ];

        await avisar(capitan, 'fechaNueva', {
            asunto: `Fecha ${fecha.numero} de ${tor.nombre}: ${dia} contra ${rival}`,
            titulo: `Fecha ${fecha.numero}: jugás contra ${rival}`,
            parrafos: [`Ya está armada la fecha ${fecha.numero} de ${tor.nombre}.`],
            detalles,
            pie: conCobro ? consecuencia(fecha.reglas, fecha.precio) : undefined,
            boton: conCobro ? 'Pagar mi parte' : 'Ver mi próxima fecha', link: `${SITIO_URL}/`,
        });
    }
};

// ---------- Avisos programados ----------
// Corren cada minuto desde app.js (después de los vencimientos): el recordatorio de pago y el de resultados por cargar.
// Cada uno se marca en la base antes de mandarse, así sale una sola vez aunque la API se reinicie.

let enCurso = null;
export const procesarAvisosProgramados = (ahora = Date.now()) => {
    enCurso ??= (async () => {
        await recordatoriosDePago(ahora);
        await recordatoriosDeResultados(ahora);
    })().finally(() => { enCurso = null; });
    return enCurso;
};

// ---------- Recordatorio de pago (capitanes) ----------
// El día que vence el pago (desde las 10:00), a cada equipo que todavía no pagó su parte (fecha_pagos.recordado).

const recordatoriosDePago = async (ahora) => {
    const pendientes = await q().selectFrom('fecha_pagos')
        .innerJoin('fechas', 'fechas.id', 'fecha_pagos.fechaId')
        .select(['fecha_pagos.fechaId', 'fecha_pagos.equipoId', 'fechas.vencePago'])
        .where('fechas.cobro', '=', 1).where('fechas.pagosProcesados', '=', 0)
        .where('fecha_pagos.estado', '=', 'pendiente').where('fecha_pagos.recordado', 'is', null)
        .execute();

    const enHora = pendientes.filter(({ vencePago }) =>
        ahora >= Date.parse(`${vencePago.slice(0, 10)}T${HORA_RECORDATORIO}:00${AR}`) && ahora < Date.parse(vencePago));

    let enviados = 0;
    for (const { fechaId, equipoId } of enHora) {
        // Se marca antes de mandar (condicional): si otra corrida llegó primero, no se repite
        const r = await q().updateTable('fecha_pagos').set({ recordado: new Date(ahora).toISOString() })
            .where('fechaId', '=', fechaId).where('equipoId', '=', equipoId)
            .where('estado', '=', 'pendiente').where('recordado', 'is', null)
            .executeTakeFirst();
        if (!Number(r.numUpdatedRows)) continue;

        if (await recordarPago(fechaId, equipoId)) enviados++;
    }

    if (enviados) console.log(`Recordatorios de pago enviados: ${enviados}`);
};

const recordarPago = async (fechaId, equipoId) => {
    const capitan = (await capitanesDe([equipoId])).get(equipoId);
    if (!capitan) return false;

    const f = await fechasManager.getById(fechaId);
    const tor = await torneosManager.getTorneoById(f?.tor_id);
    if (!f || tor.error) return false;

    const p = (await partidosManager.getByFecha(tor.id, f.numero)).find((x) => x.home_id === equipoId || x.away_id === equipoId);
    const rivalId = p ? (p.home_id === equipoId ? p.away_id : p.home_id) : null;
    const rival = rivalId ? (await q().selectFrom('equipos').select('name').where('id', '=', rivalId).executeTakeFirst())?.name : null;
    const monto = f.pagos?.[equipoId]?.monto ?? f.precio;

    return avisar(capitan, 'recordatorioPago', {
        asunto: `Hoy vence el pago de la fecha ${f.numero} de ${tor.nombre}`,
        titulo: 'Hoy vence el pago de tu fecha',
        parrafos: [`Todavía no pagaste tu parte de la fecha ${f.numero} de ${tor.nombre}. Tenés tiempo hasta hoy a las 23:59.`],
        detalles: [
            ...(p ? [['Partido', `contra ${rival ?? 'a confirmar'}`], ['Cuándo', `${diaTexto(f.dia)} a las ${horaDe(p.date)}`]] : []),
            ['Tu parte', precioTexto(monto)],
        ],
        pie: consecuencia(f.reglas, f.precio),
        boton: 'Pagar ahora', link: `${SITIO_URL}/`,
    });
};

// ---------- Resultados por cargar (organizador) ----------
// El día siguiente a la fecha (desde las 10:00), si todavía faltan resultados. Una vez por fecha (fechas.avisoResultados).
// Las fechas de hace más de una semana se marcan sin avisar (por ejemplo al subir esto con fechas viejas).
const DIAS_RESULTADOS = 7;

const recordatoriosDeResultados = async (ahora) => {
    const fechas = await q().selectFrom('fechas')
        .innerJoin('torneos', 'torneos.id', 'fechas.tor_id')
        .select(['fechas.id', 'fechas.tor_id', 'fechas.numero', 'fechas.dia', 'fechas.inicio', 'fechas.fin'])
        .where('torneos.estado', '=', 'en-curso').where('fechas.avisoResultados', 'is', null)
        .execute();

    for (const f of fechas) {
        const { fin } = fechasManager.rango(f);
        if (ahora < fin || ahora < Date.parse(`${sumarDias(f.dia, 1)}T${HORA_RECORDATORIO}:00${AR}`)) continue;

        const r = await q().updateTable('fechas').set({ avisoResultados: new Date(ahora).toISOString() })
            .where('id', '=', f.id).where('avisoResultados', 'is', null).executeTakeFirst();
        if (!Number(r.numUpdatedRows) || ahora - fin > DIAS_RESULTADOS * 864e5) continue;

        // Los partidos con W.O. no llevan resultado
        const faltan = (await partidosManager.getByFecha(f.tor_id, f.numero)).filter((p) => !p.wo && (p.home_goals == null || p.away_goals == null));
        if (faltan.length) await resultadosPendientes(f, faltan);
    }
};

const resultadosPendientes = async (f, faltan) => {
    const tor = await torneosManager.getTorneoById(f.tor_id);
    const org = tor.error ? null : await organizadorDe(tor);
    if (!org) return;

    const nombres = await nombresDe(faltan.flatMap((p) => [p.home_id, p.away_id]));
    const n = faltan.length;
    await avisar(org, 'resultadosPendientes', {
        asunto: `Faltan los resultados de la fecha ${f.numero} de ${tor.nombre}`,
        titulo: `Cargá los resultados de la fecha ${f.numero}`,
        parrafos: [
            `La fecha ${f.numero} de ${tor.nombre} se jugó el ${diaTexto(f.dia)} y ${n === 1 ? 'todavía falta 1 resultado' : `todavía faltan ${n} resultados`}.`,
            'Con los resultados se actualiza la tabla de posiciones y los equipos la ven al instante.',
        ],
        detalles: faltan.map((p) => [`${horaDe(p.date)}${p.cancha ? ` · Cancha ${p.cancha}` : ''}`, `${nombres.get(p.home_id) ?? '?'} vs ${nombres.get(p.away_id) ?? '?'}`]),
        boton: 'Cargar resultados', link: `${SITIO_URL}/partidos/${tor.id}`,
    });
};

// ---------- Vencimiento del pago de una fecha ----------
// Capitanes ("W.O. y multas"): el que perdió por W.O. (con su multa) y el rival que ganó (y su amistoso express).
// Organizador ("Pagos vencidos"): quiénes no pagaron y qué se aplicó.
// evento: { fechaId, noPagaron: [equipoId], penalizacion } (lo arma vencimientosService, después de la transacción)
export const avisarVencimientos = (evento) => enSegundoPlano(vencimientos(evento), 'vencimientos');

const vencimientos = async ({ fechaId, noPagaron, penalizacion }) => {
    const f = await fechasManager.getById(fechaId);
    const tor = f ? await torneosManager.getTorneoById(f.tor_id) : null;
    if (!f || !tor || tor.error) return;

    const partidos = await partidosManager.getByFecha(tor.id, f.numero);
    const nombres = await nombresDe([...new Set([...partidos.flatMap((p) => [p.home_id, p.away_id]), ...noPagaron])]);
    const noPago = new Set(noPagaron);
    const reglas = { ...REGLAS_DEFAULT, ...(f.reglas ?? {}) };

    if (penalizacion) {
        const conWo = partidos.filter((p) => p.wo);
        const capitanes = await capitanesDe(conWo.flatMap((p) => [p.home_id, p.away_id]));

        for (const p of conWo) {
            for (const eqId of [p.home_id, p.away_id]) {
                const capitan = capitanes.get(eqId);
                if (!capitan) continue;
                const rival = nombres.get(eqId === p.home_id ? p.away_id : p.home_id) ?? 'tu rival';
                const cuando = `${diaTexto(f.dia)} a las ${horaDe(p.date)}`;

                if (noPago.has(eqId)) {
                    const multa = await multasManager.getDe(f.id, eqId);
                    await avisar(capitan, 'woMultas', {
                        asunto: `Perdiste por W.O. la fecha ${f.numero} de ${tor.nombre}`,
                        titulo: 'Perdiste el partido por W.O.',
                        parrafos: [
                            p.wo === 'doble'
                                ? `Ni tu equipo ni ${rival} pagaron su parte de la fecha ${f.numero} a tiempo: el partido queda perdido para los dos (W.O. doble) y no se juega.`
                                : `No se pagó tu parte de la fecha ${f.numero} de ${tor.nombre} a tiempo: el partido contra ${rival} queda 0-3 por W.O. y no se juega.`,
                            ...(multa ? [`Te llegó una multa de ${precioTexto(multa.monto)}. Hasta que la pagues no vas a poder pagar fechas, inscribirte en torneos ni tomar amistosos.`] : []),
                        ],
                        detalles: [['Partido', `contra ${rival}`], ['Día', cuando], ...(multa ? [['Multa', precioTexto(multa.monto)]] : [])],
                        boton: multa ? 'Pagar la multa' : 'Ver mi próxima fecha', link: `${SITIO_URL}/`,
                    });
                } else {
                    const ami = await amistososManager.getByPartido(p.id);
                    await avisar(capitan, 'woMultas', {
                        asunto: `Ganaste por W.O. la fecha ${f.numero} de ${tor.nombre}`,
                        titulo: 'Ganaste 3-0 por W.O.',
                        parrafos: [
                            `${rival} no pagó su parte de la fecha ${f.numero} a tiempo: el partido queda 3-0 a tu favor y no se juega contra ellos.`,
                            ...(ami ? ['Para que igual puedas jugar, publicamos su lugar como amistoso express: si otro equipo lo toma, jugás contra ese equipo en el mismo horario y cancha. Lo vas a ver en "Tu próxima fecha".'] : []),
                        ],
                        detalles: [['Partido', `contra ${rival}`], ['Día', cuando]],
                        boton: ami ? 'Ver el amistoso' : 'Ver mi próxima fecha', link: ami ? `${SITIO_URL}/amistosos/${ami.id}` : `${SITIO_URL}/`,
                    });
                }
            }
        }
    }

    const org = await organizadorDe(tor);
    if (!org) return;

    const resultado = (eqId) => {
        if (!penalizacion) return 'No pagó (sin penalización)';
        const p = partidos.find((x) => x.home_id === eqId || x.away_id === eqId);
        return p?.wo === 'doble' ? 'Perdió por W.O. doble' : 'Perdió 0-3 por W.O.';
    };
    const multa = penalizacion ? montoMulta(reglas, f.precio) : 0;
    const n = noPagaron.length;

    await avisar(org, 'pagosVencidos', {
        asunto: `Pagos vencidos en la fecha ${f.numero} de ${tor.nombre}`,
        titulo: n === 1 ? `1 equipo no pagó la fecha ${f.numero}` : `${n} equipos no pagaron la fecha ${f.numero}`,
        parrafos: [penalizacion
            ? `Se aplicaron las reglas del torneo: pierden el partido por W.O.${multa ? ` y reciben una multa de ${precioTexto(multa)}` : ''}${reglas.amistosos ? ', y el lugar de cada uno se publicó como amistoso express para que su rival pueda jugar igual' : ''}.`
            : 'El torneo no tiene penalización automática: los partidos siguen en pie y decidís vos qué hacer. El detalle de los pagos está en el fixture.'],
        detalles: noPagaron.map((id) => [nombres.get(id) ?? id, resultado(id)]),
        boton: 'Ver el fixture', link: `${SITIO_URL}/partidos/${tor.id}`,
    });
};

// ---------- Resultados cargados (capitanes) ----------
// Cuando el organizador carga o corrige resultados: a cada capitán, el de su partido. antes/despues: partidos de la fecha
export const avisarResultados = (tor, fecha, antes, despues) => enSegundoPlano(resultados(tor, fecha, antes, despues), 'resultados');

const resultados = async (tor, fecha, antes, despues) => {
    const previo = new Map(antes.map((p) => [p.id, p]));
    const cambiados = despues.filter((p) => {
        const a = previo.get(p.id);
        return p.home_goals != null && p.away_goals != null && (a?.home_goals !== p.home_goals || a?.away_goals !== p.away_goals);
    });
    if (!cambiados.length) return;

    const ids = cambiados.flatMap((p) => [p.home_id, p.away_id]);
    const [capitanes, nombres] = await Promise.all([capitanesDe(ids), nombresDe(ids)]);

    for (const p of cambiados) {
        const correccion = previo.get(p.id)?.home_goals != null;
        for (const eqId of [p.home_id, p.away_id]) {
            const capitan = capitanes.get(eqId);
            if (!capitan) continue;

            const local = eqId === p.home_id;
            const mios = local ? p.home_goals : p.away_goals;
            const suyos = local ? p.away_goals : p.home_goals;
            const rival = nombres.get(local ? p.away_id : p.home_id) ?? 'tu rival';
            const como = mios > suyos ? `Ganaste ${mios}-${suyos}` : mios < suyos ? `Perdiste ${mios}-${suyos}` : `Empataste ${mios}-${suyos}`;

            await avisar(capitan, 'resultados', {
                asunto: `${correccion ? 'Se corrigió el resultado' : 'Resultado'} de la fecha ${fecha.numero} de ${tor.nombre}: ${como.toLowerCase()} contra ${rival}`,
                titulo: `${como} contra ${rival}`,
                parrafos: [`El organizador ${correccion ? 'corrigió' : 'cargó'} el resultado de tu partido de la fecha ${fecha.numero} de ${tor.nombre}. La tabla ya está actualizada.`],
                detalles: [['Resultado', `${nombres.get(p.home_id) ?? '?'} ${p.home_goals} - ${p.away_goals} ${nombres.get(p.away_id) ?? '?'}`], ['Fecha', `${fecha.numero} · ${diaTexto(fecha.dia)}`]],
                boton: 'Ver la tabla', link: `${SITIO_URL}/torneos/${tor.id}`,
            });
        }
    }
};

// ---------- Inscripción confirmada (capitán: "Inscripciones"; organizador: "Equipo inscripto") ----------
export const avisarInscripcion = (insc) => enSegundoPlano(inscripcion(insc), 'inscripción');

const inscripcion = async (insc) => {
    const tor = await torneosManager.getTorneoById(insc.torId);
    if (tor.error) return;
    const equipo = insc.equipo?.name ?? 'Tu equipo';
    const link = `${SITIO_URL}/torneos/${tor.id}`;

    const capitan = await q().selectFrom('usuarios').selectAll().where('id', '=', insc.ownerId).executeTakeFirst();
    if (capitan) {
        await avisar(capitan, 'inscripcion', {
            asunto: `${equipo} quedó inscripto en ${tor.nombre}`,
            titulo: '¡Inscripción confirmada!',
            parrafos: [
                `${equipo} ya está inscripto en ${tor.nombre}.`,
                tor.precioFecha > 0
                    ? `Cada fecha se paga aparte (${precioTexto(tor.precioFecha)} por equipo) hasta las 23:59 del día anterior al partido. Te avisamos cuando se arme cada fecha.`
                    : 'El torneo no cobra por fecha: con la inscripción ya está todo pago. Te avisamos cuando se arme cada fecha.',
            ],
            detalles: [
                ['Torneo', tor.nombre],
                ['Empieza', diaTexto(tor.fechaInicio)],
                ['Días', `${tor.diaJuego} · ${tor.horario}`],
                ['Sede', sedeTexto(tor)],
                ['Pagaste', precioTexto(insc.monto)],
            ],
            boton: 'Ver el torneo', link,
        });
    }

    const org = await organizadorDe(tor);
    if (org) {
        await avisar(org, 'equipoInscripto', {
            asunto: `Nuevo equipo inscripto en ${tor.nombre}: ${equipo}`,
            titulo: `${equipo} se inscribió`,
            parrafos: [`${equipo} pagó la inscripción de ${tor.nombre}.`],
            detalles: [
                ['Equipo', equipo],
                ['Cobrado', precioTexto(insc.monto)],
                ['Inscriptos', `${tor.equiposInscriptos} de ${tor.equiposMax}`],
                ['Cierre', `${diaTexto(tor.cierreInscripcion)} a las 23:59`],
            ],
            boton: 'Ver el torneo', link,
        });
    }
};

// ---------- Estado de los torneos (organizador: "Estado de tus torneos"; capitanes: "Inscripciones" al empezar) ----------
// cambios: { cerradas: [torId], empezados: [torId], sinEquipos: [torId] } (lo arma estadosService en cada corrida)
export const avisarEstados = (cambios) => enSegundoPlano(estados(cambios), 'estados');

const estados = async ({ cerradas = [], empezados = [], sinEquipos = [] }) => {
    for (const id of cerradas) {
        const tor = await torneosManager.getTorneoById(id);
        const org = tor.error ? null : await organizadorDe(tor);
        if (!org) continue;
        const alcanza = tor.equiposInscriptos >= 2;
        await avisar(org, 'estadoTorneo', {
            asunto: `Se cerró la inscripción de ${tor.nombre}`,
            titulo: 'Se cerró la inscripción',
            parrafos: alcanza
                ? [`Terminó el plazo de inscripción de ${tor.nombre} con ${tor.equiposInscriptos} equipos.`,
                    `Ya podés armar la fecha 1: el torneo empieza el ${diaTexto(tor.fechaInicio)}.${tor.precioFecha > 0 ? ' Creala con al menos 3 días de anticipación para que los equipos lleguen a pagarla.' : ''}`]
                : [`Terminó el plazo de inscripción de ${tor.nombre} con ${tor.equiposInscriptos === 1 ? '1 equipo' : `${tor.equiposInscriptos} equipos`}, y para empezar hacen falta al menos 2.`,
                    'Podés cambiar las fechas del torneo y volver a abrir la inscripción desde el detalle del torneo.'],
            detalles: [['Inscriptos', `${tor.equiposInscriptos} de ${tor.equiposMax}`], ['Empieza', diaTexto(tor.fechaInicio)]],
            boton: alcanza ? 'Armar la fecha 1' : 'Ver el torneo',
            link: alcanza ? `${SITIO_URL}/partidos/${tor.id}` : `${SITIO_URL}/torneos/${tor.id}`,
        });
    }

    for (const id of empezados) {
        const tor = await torneosManager.getTorneoById(id);
        if (tor.error) continue;

        const org = await organizadorDe(tor);
        if (org) {
            await avisar(org, 'estadoTorneo', {
                asunto: `Empezó ${tor.nombre}`,
                titulo: `Hoy empieza ${tor.nombre}`,
                parrafos: [`${tor.nombre} pasó a "en curso" con ${tor.equiposInscriptos} equipos. Después de cada fecha, cargá los resultados desde el fixture para que se actualice la tabla.`],
                boton: 'Ver el fixture', link: `${SITIO_URL}/partidos/${tor.id}`,
            });
        }

        const equipos = await q().selectFrom('equipos').select('id').where('tor_id', '=', tor.id).execute();
        for (const capitan of (await capitanesDe(equipos.map((e) => e.id))).values()) {
            await avisar(capitan, 'inscripcion', {
                asunto: `Empezó ${tor.nombre}`,
                titulo: `Hoy empieza ${tor.nombre}`,
                parrafos: ['¡Arranca el torneo! Te avisamos de cada fecha: día, horario, cancha y rival.'],
                detalles: [['Días', `${tor.diaJuego} · ${tor.horario}`], ['Sede', sedeTexto(tor)], ['Equipos', String(tor.equiposInscriptos)]],
                boton: 'Ver el torneo', link: `${SITIO_URL}/torneos/${tor.id}`,
            });
        }
    }

    for (const id of sinEquipos) {
        const tor = await torneosManager.getTorneoById(id);
        if (tor.error) continue;
        // Una vez por fecha de inicio (si la cambia y vuelve a pasar, se avisa de nuevo)
        const r = await q().updateTable('torneos').set({ avisoSinEquipos: tor.fechaInicio })
            .where('id', '=', id)
            .where((eb) => eb.or([eb('avisoSinEquipos', 'is', null), eb('avisoSinEquipos', '!=', tor.fechaInicio)]))
            .executeTakeFirst();
        if (!Number(r.numUpdatedRows)) continue;

        const org = await organizadorDe(tor);
        if (!org) continue;
        await avisar(org, 'estadoTorneo', {
            asunto: `${tor.nombre} no pudo empezar`,
            titulo: `${tor.nombre} no pudo empezar`,
            parrafos: [
                `El ${diaTexto(tor.fechaInicio)} era el día de inicio, pero hay ${tor.equiposInscriptos === 1 ? '1 equipo inscripto' : `${tor.equiposInscriptos} equipos inscriptos`} y se necesitan al menos 2.`,
                'Cambiá la fecha de inicio desde "Cambiar fechas" en el detalle del torneo para darle más tiempo a la inscripción.',
            ],
            boton: 'Ver el torneo', link: `${SITIO_URL}/torneos/${tor.id}`,
        });
    }
};
