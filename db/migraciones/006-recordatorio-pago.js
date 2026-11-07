// Recordatorio de pago por mail: cuándo se le avisó a cada equipo que todavía no pagó su parte de la fecha
// (null = todavía no). Así se manda una sola vez aunque la API se reinicie.

export async function up(db) {
    await db.schema.alterTable('fecha_pagos').addColumn('recordado', 'text').execute();
}

export async function down(db) {
    await db.schema.alterTable('fecha_pagos').dropColumn('recordado').execute();
}
