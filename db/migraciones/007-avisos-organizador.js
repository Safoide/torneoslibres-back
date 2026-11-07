// Avisos por mail que se mandan una sola vez (ver services/avisosService.js):
//  - fechas.avisoResultados: cuándo se le recordó al organizador que faltan los resultados (null = todavía no)
//  - torneos.avisoSinEquipos: la fecha de inicio para la que ya se avisó que el torneo no puede empezar por falta
//    de equipos (si el organizador cambia el inicio y vuelve a pasar, se avisa de nuevo)

export async function up(db) {
    await db.schema.alterTable('fechas').addColumn('avisoResultados', 'text').execute();
    await db.schema.alterTable('torneos').addColumn('avisoSinEquipos', 'text').execute();
}

export async function down(db) {
    await db.schema.alterTable('torneos').dropColumn('avisoSinEquipos').execute();
    await db.schema.alterTable('fechas').dropColumn('avisoResultados').execute();
}
