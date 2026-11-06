// Cierre de inscripción: el último día (YYYY-MM-DD, hasta las 23:59 de Argentina) en que se aceptan inscripciones.
// Lo elige el organizador; null = el de siempre según el torneo (ver cierrePorDefecto en torneosManager.js).
// El estado nuevo "inscripcion-cerrada" no necesita cambios de estructura (estado es texto).

export async function up(db) {
    await db.schema.alterTable('torneos').addColumn('cierreInscripcion', 'text').execute();
}

export async function down(db) {
    await db.schema.alterTable('torneos').dropColumn('cierreInscripcion').execute();
}
