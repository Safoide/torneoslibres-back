// Login con Google y verificación de email:
//  - passwordHash pasa a ser opcional (una cuenta creada con Google no tiene contraseña)
//  - googleId: el id fijo de la cuenta de Google vinculada (único)
//  - emailVerificado: 0/1. Las cuentas que entran con Google quedan verificadas
// Cambiar una columna a opcional en SQLite exige rehacer la tabla. Se puede sin riesgo porque
// ninguna otra tabla tiene claves foráneas hacia usuarios. Sin funciones propias de SQLite (corre igual en PostgreSQL).

const COLS_VIEJAS = ['id', 'nombre', 'email', 'passwordHash', 'rol', 'creado', 'tokenVersion'];

export async function up(db) {
    await db.schema.createTable('usuarios_v2')
        .addColumn('id', 'text', (c) => c.primaryKey())
        .addColumn('nombre', 'text', (c) => c.notNull())
        .addColumn('email', 'text', (c) => c.notNull().unique())
        .addColumn('passwordHash', 'text') // null: la cuenta no tiene contraseña (entra con Google)
        .addColumn('rol', 'text')
        .addColumn('creado', 'text')
        .addColumn('tokenVersion', 'integer', (c) => c.notNull().defaultTo(0))
        .addColumn('googleId', 'text', (c) => c.unique())
        .addColumn('emailVerificado', 'integer', (c) => c.notNull().defaultTo(0))
        .execute();

    await db.insertInto('usuarios_v2').columns(COLS_VIEJAS)
        .expression(db.selectFrom('usuarios').select(COLS_VIEJAS))
        .execute();

    await db.schema.dropTable('usuarios').execute();
    await db.schema.alterTable('usuarios_v2').renameTo('usuarios').execute();
}

export async function down(db) {
    // Vuelve a la tabla anterior. Las cuentas sin contraseña no entran en ella: se descartan
    await db.schema.createTable('usuarios_v1')
        .addColumn('id', 'text', (c) => c.primaryKey())
        .addColumn('nombre', 'text', (c) => c.notNull())
        .addColumn('email', 'text', (c) => c.notNull().unique())
        .addColumn('passwordHash', 'text', (c) => c.notNull())
        .addColumn('rol', 'text')
        .addColumn('creado', 'text')
        .addColumn('tokenVersion', 'integer', (c) => c.notNull().defaultTo(0))
        .execute();

    await db.insertInto('usuarios_v1').columns(COLS_VIEJAS)
        .expression(db.selectFrom('usuarios').select(COLS_VIEJAS).where('passwordHash', 'is not', null))
        .execute();

    await db.schema.dropTable('usuarios').execute();
    await db.schema.alterTable('usuarios_v1').renameTo('usuarios').execute();
}
