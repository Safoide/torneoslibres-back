// Recuperar contraseña: links de un solo uso que se mandan por mail.
// Se guarda solo el hash (sha256) del token: si alguien lee la base no puede usar los links.
// Sin clave foránea hacia usuarios (así una migración que rehaga usuarios no choca);
// usuariosManager.eliminar borra los tokens de la cuenta.

export async function up(db) {
    await db.schema.createTable('password_tokens')
        .addColumn('tokenHash', 'text', (c) => c.primaryKey())
        .addColumn('usuarioId', 'text', (c) => c.notNull())
        .addColumn('vence', 'text', (c) => c.notNull()) // ISO (UTC)
        .addColumn('creado', 'text', (c) => c.notNull())
        .execute();

    await db.schema.createIndex('password_tokens_usuario').on('password_tokens').column('usuarioId').execute();
}

export async function down(db) {
    await db.schema.dropTable('password_tokens').execute();
}
