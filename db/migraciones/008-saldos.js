// Saldo a favor de cada equipo en su torneo (equipos es uno por torneo): movimientos que suman o restan.
//  + cuando el organizador cancela una fecha que el equipo ya había pagado (o una multa pagada de esa fecha)
//  - cuando se usa para pagar una fecha
// El saldo es la suma de los movimientos. Ver services/saldosService.js.
// fechaNumero es solo para mostrar (los ids de las fechas se reutilizan al cancelar la última).

export async function up(db) {
    await db.schema.createTable('saldos')
        .addColumn('id', 'text', (c) => c.primaryKey())
        .addColumn('equipoId', 'text', (c) => c.notNull())
        .addColumn('tor_id', 'text', (c) => c.notNull())
        .addColumn('monto', 'integer', (c) => c.notNull()) // positivo suma, negativo resta
        .addColumn('motivo', 'text', (c) => c.notNull()) // fecha-cancelada | multa-devuelta | pago-fecha
        .addColumn('fechaNumero', 'integer')
        .addColumn('creado', 'text', (c) => c.notNull())
        .execute();

    await db.schema.createIndex('saldos_equipo').on('saldos').column('equipoId').execute();
    await db.schema.createIndex('saldos_torneo').on('saldos').column('tor_id').execute();
}

export async function down(db) {
    await db.schema.dropTable('saldos').execute();
}
