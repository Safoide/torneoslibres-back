// Preferencias de notificaciones por email (ver services/notificacionesService.js):
//  - notificaciones: texto JSON { tipo: true|false } con lo que la cuenta cambió (lo que no está usa el valor por defecto)
//  - novedades: 0/1, si aceptó recibir novedades y promociones (por defecto no: tiene que elegirlo)
//  - novedadesFecha: cuándo lo aceptó (null si no)

export async function up(db) {
    await db.schema.alterTable('usuarios').addColumn('notificaciones', 'text').execute();
    await db.schema.alterTable('usuarios').addColumn('novedades', 'integer', (c) => c.notNull().defaultTo(0)).execute();
    await db.schema.alterTable('usuarios').addColumn('novedadesFecha', 'text').execute();
}

export async function down(db) {
    await db.schema.alterTable('usuarios').dropColumn('novedadesFecha').execute();
    await db.schema.alterTable('usuarios').dropColumn('novedades').execute();
    await db.schema.alterTable('usuarios').dropColumn('notificaciones').execute();
}
