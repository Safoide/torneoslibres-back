import { q, tx } from './index.js';
import { aFila, deFilas, TABLAS } from './filas.js';

// Pasa todos los datos entre la base y el formato de los JSON de antes
// ({ torneos: [...], equipos: [...], clubes: [{ ..., jugadores: [...] }], fechas: [{ ..., pagos: {...} }], ... }).
// Lo usan los scripts de datos de prueba (seed.mjs).

export const COLECCIONES = ['usuarios', 'organizadores', 'clubes', 'torneos', 'equipos', 'jugadores', 'fechas', 'partidos', 'inscripciones', 'multas', 'amistosos'];

export const exportarTodo = async () => {
    const leer = async (t) => deFilas(t, await q().selectFrom(t).selectAll().execute());
    const datos = {};
    for (const t of TABLAS) datos[t] = await leer(t);

    const plantel = datos.club_jugadores.sort((a, b) => a.orden - b.orden);
    datos.clubes = datos.clubes.map((c) => ({
        ...c, jugadores: plantel.filter((j) => j.clubId === c.id).map(({ clubId, orden, ...j }) => j),
    }));

    datos.fechas = datos.fechas.map(({ cobro, ...f }) => {
        if (!cobro) return f;
        const pagos = datos.fecha_pagos.filter((p) => p.fechaId === f.id).sort((a, b) => a.orden - b.orden);
        return { ...f, pagos: Object.fromEntries(pagos.map(({ fechaId, equipoId, orden, pago, ...p }) => [equipoId, pago ? { ...p, pago } : p])) };
    });

    delete datos.club_jugadores;
    delete datos.fecha_pagos;
    return datos;
};

// Borra todo y carga estos datos, en una sola transaccion (si algo falla, la base queda como estaba)
export const reemplazarTodo = (datos) => tx(async () => {
    const filas = { club_jugadores: [], fecha_pagos: [] };

    for (const t of COLECCIONES) filas[t] = [];
    for (const u of datos.usuarios ?? []) filas.usuarios.push(aFila('usuarios', { tokenVersion: 0, ...u }));
    for (const o of datos.organizadores ?? []) filas.organizadores.push(aFila('organizadores', o));
    for (const c of datos.clubes ?? []) {
        filas.clubes.push(aFila('clubes', c));
        (c.jugadores ?? []).forEach((j, orden) => filas.club_jugadores.push(aFila('club_jugadores', { ...j, clubId: c.id, orden })));
    }
    for (const f of datos.fechas ?? []) {
        filas.fechas.push(aFila('fechas', { ...f, cobro: !!f.pagos, pagosProcesados: !!f.pagosProcesados }));
        for (const [orden, [equipoId, p]] of Object.entries(f.pagos ?? {}).entries()) {
            filas.fecha_pagos.push(aFila('fecha_pagos', { ...p, fechaId: f.id, equipoId, orden }));
        }
    }
    for (const t of ['torneos', 'equipos', 'jugadores', 'partidos', 'inscripciones', 'multas', 'amistosos']) {
        for (const x of datos[t] ?? []) filas[t].push(aFila(t, x));
    }

    // Primero lo que depende de otra tabla
    // Los saldos a favor y las devoluciones dependen de los equipos de cada torneo: se borran con ellos (no se vuelven a cargar)
    for (const t of ['devoluciones', 'saldos', 'fecha_pagos', 'club_jugadores', ...[...COLECCIONES].reverse()]) await q().deleteFrom(t).execute();

    // De a una fila: no todas traen las mismas columnas (los datos viejos tienen campos de menos)
    // y asi cada una toma los valores por defecto que le faltan
    for (const t of [...COLECCIONES, 'club_jugadores', 'fecha_pagos']) {
        for (const fila of filas[t]) await q().insertInto(t).values(fila).execute();
    }

    return Object.fromEntries(Object.entries(filas).map(([t, l]) => [t, l.length]));
});
