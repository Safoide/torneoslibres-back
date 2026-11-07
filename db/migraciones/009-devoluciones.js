// Devoluciones: cuando un torneo termina y un equipo todavía tiene saldo a favor (de fechas canceladas), el organizador
// le tiene que devolver la plata. Se crean al finalizar el torneo (el saldo queda en 0) y el organizador las marca
// "devuelta" cuando le pasa la plata al equipo. Ver services/saldosService.js.
// Nuestra comisión de ese monto se le devuelve al organizador (cuando estén las comisiones; ver CLAUDE.md).

export async function up(db) {
    await db.schema.createTable('devoluciones')
        .addColumn('id', 'text', (c) => c.primaryKey())
        .addColumn('equipoId', 'text', (c) => c.notNull())
        .addColumn('tor_id', 'text', (c) => c.notNull())
        .addColumn('monto', 'integer', (c) => c.notNull())
        .addColumn('estado', 'text', (c) => c.notNull()) // pendiente | devuelta
        .addColumn('creada', 'text', (c) => c.notNull())
        .addColumn('devuelta', 'text') // cuándo la marcó el organizador
        .addUniqueConstraint('devoluciones_torneo_equipo', ['tor_id', 'equipoId']) // una por equipo al terminar
        .execute();

    await db.schema.createIndex('devoluciones_equipo').on('devoluciones').column('equipoId').execute();
}

export async function down(db) {
    await db.schema.dropTable('devoluciones').execute();
}
