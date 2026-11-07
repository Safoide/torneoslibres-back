// Verificación de email: links de un solo uso que se mandan por mail (como los de recuperar contraseña).
// Se guarda solo el hash del token y el email al que se mandó: si la cuenta cambia de email, el link deja de servir.
// Sin clave foránea hacia usuarios (igual que password_tokens); usuariosManager.eliminar borra los de la cuenta.

export async function up(db) {
    await db.schema.createTable('verificacion_tokens')
        .addColumn('tokenHash', 'text', (c) => c.primaryKey())
        .addColumn('usuarioId', 'text', (c) => c.notNull())
        .addColumn('email', 'text', (c) => c.notNull())
        .addColumn('vence', 'text', (c) => c.notNull()) // ISO (UTC)
        .addColumn('creado', 'text', (c) => c.notNull())
        .execute();

    await db.schema.createIndex('verificacion_tokens_usuario').on('verificacion_tokens').column('usuarioId').execute();
}

export async function down(db) {
    await db.schema.dropTable('verificacion_tokens').execute();
}
