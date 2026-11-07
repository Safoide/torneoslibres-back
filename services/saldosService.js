// Saldo a favor de un equipo en su torneo (tabla saldos, migración 008).
// Se genera cuando el organizador cancela una fecha que el equipo ya había pagado y se usa para pagar las próximas:
// sola al crear la fecha si alcanza para toda la parte, o descontando de lo que se cobra al pagar.
// Usar dentro de tx() cuando se combina con otros cambios (q() toma la transacción en curso).

import { randomUUID } from 'crypto';
import { q } from '../db/index.js';

export const MOTIVOS = ['fecha-cancelada', 'multa-devuelta', 'pago-fecha', 'devolucion'];

export const saldoDe = async (equipoId) => {
    const r = await q().selectFrom('saldos').select((eb) => eb.fn.sum('monto').as('total'))
        .where('equipoId', '=', equipoId).executeTakeFirst();
    return Number(r?.total ?? 0);
};

// Saldos de todos los equipos de un torneo: Map equipoId -> monto (solo los distintos de 0)
export const saldosDeTorneo = async (torId) => {
    const filas = await q().selectFrom('saldos').select(['equipoId', (eb) => eb.fn.sum('monto').as('total')])
        .where('tor_id', '=', torId).groupBy('equipoId').execute();
    return new Map(filas.map((f) => [f.equipoId, Number(f.total)]).filter(([, t]) => t !== 0));
};

// Movimiento: monto positivo suma, negativo resta
export const moverSaldo = async ({ equipoId, torId, monto, motivo, fechaNumero = null }) => {
    if (!monto) return;
    await q().insertInto('saldos').values({
        id: `SAL-${randomUUID().slice(0, 8)}`, equipoId, tor_id: torId, monto, motivo, fechaNumero, creado: new Date().toISOString(),
    }).execute();
};

// ---------- Devoluciones (tabla devoluciones, migración 009) ----------
// Si el torneo termina y un equipo todavía tiene saldo, el organizador se lo tiene que devolver (completo:
// nuestra comisión de ese monto se le devuelve a él). Al finalizar, cada saldo > 0 pasa a una devolución
// pendiente y el saldo queda en 0. Llamarlo dentro de la misma tx() que finaliza el torneo.
export const generarDevoluciones = async (torId) => {
    const creadas = [];
    for (const [equipoId, monto] of await saldosDeTorneo(torId)) {
        if (monto <= 0) continue;
        const d = { id: `DEV-${randomUUID().slice(0, 8)}`, equipoId, tor_id: torId, monto, estado: 'pendiente', creada: new Date().toISOString(), devuelta: null };
        const r = await q().insertInto('devoluciones').values(d).onConflict((oc) => oc.doNothing()).executeTakeFirst();
        if (!Number(r.numInsertedOrUpdatedRows)) continue; // ya tenía una (no debería pasar: se finaliza una sola vez)
        await moverSaldo({ equipoId, torId, monto: -monto, motivo: 'devolucion' });
        creadas.push(d);
    }
    return creadas;
};

const conNombres = (qb) => qb
    .innerJoin('equipos', 'equipos.id', 'devoluciones.equipoId')
    .innerJoin('torneos', 'torneos.id', 'devoluciones.tor_id')
    .select(['devoluciones.id', 'devoluciones.equipoId', 'devoluciones.tor_id', 'devoluciones.monto', 'devoluciones.estado',
        'devoluciones.creada', 'devoluciones.devuelta', 'equipos.name as equipo', 'torneos.nombre as torneo']);

export const getDevolucion = async (id) =>
    (await conNombres(q().selectFrom('devoluciones')).where('devoluciones.id', '=', String(id ?? '')).executeTakeFirst()) ?? null;

// Del organizador: las de sus torneos (las pendientes primero)
export const devolucionesDeTorneos = async (torIds) => torIds.length
    ? conNombres(q().selectFrom('devoluciones')).where('devoluciones.tor_id', 'in', torIds)
        .orderBy('devoluciones.estado', 'desc').orderBy('devoluciones.creada', 'desc').execute()
    : [];

// Del capitán: las de su club (sus equipos de cada torneo), con el WhatsApp del torneo para reclamar
export const devolucionesDeClub = async (clubId) => conNombres(q().selectFrom('devoluciones'))
    .select(['torneos.whatsapp', 'torneos.organizador'])
    .where('equipos.club_id', '=', clubId)
    .orderBy('devoluciones.estado', 'desc').orderBy('devoluciones.creada', 'desc').execute();

// El organizador avisa que ya le devolvió la plata al equipo (una sola vez)
export const marcarDevuelta = async (id) => {
    const r = await q().updateTable('devoluciones').set({ estado: 'devuelta', devuelta: new Date().toISOString() })
        .where('id', '=', id).where('estado', '=', 'pendiente').executeTakeFirst();
    return Number(r.numUpdatedRows) === 1;
};
