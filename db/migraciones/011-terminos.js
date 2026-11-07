// Aceptación de los términos y condiciones y la política de privacidad: qué versión aceptó cada cuenta
// (TERMINOS_VERSION de config.js) y cuándo. Las cuentas anteriores quedan en null: el front les pide aceptarlos.

export async function up(db) {
    await db.schema.alterTable('usuarios').addColumn('terminosVersion', 'text').execute();
    await db.schema.alterTable('usuarios').addColumn('terminosFecha', 'text').execute(); // ISO (UTC)
}

export async function down(db) {
    await db.schema.alterTable('usuarios').dropColumn('terminosFecha').execute();
    await db.schema.alterTable('usuarios').dropColumn('terminosVersion').execute();
}
