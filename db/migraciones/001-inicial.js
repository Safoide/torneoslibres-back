import { sql } from 'kysely';

// Estructura inicial (la de los JSON de antes). Las columnas se llaman igual que las claves de los JSON,
// asi la API devuelve exactamente lo mismo que antes.
//  - Los objetos chicos (reglas de pago, limite de edad, datos de un pago) se guardan como texto JSON.
//  - Los si/no se guardan como 0/1.
//  - Sin funciones propias de SQLite: esta migracion tiene que poder correr igual en PostgreSQL.
// NUNCA editar esta migracion una vez publicada: los cambios van en una migracion nueva.

const texto = (t, c, req = false) => t.addColumn(c, 'text', (col) => (req ? col.notNull() : col));
const entero = (t, c, def) => t.addColumn(c, 'integer', (col) => (def === undefined ? col : col.notNull().defaultTo(def)));

export async function up(db) {
    let t;

    // ---- cuentas ----
    await db.schema.createTable('usuarios')
        .addColumn('id', 'text', (c) => c.primaryKey())
        .addColumn('nombre', 'text', (c) => c.notNull())
        .addColumn('email', 'text', (c) => c.notNull().unique())
        .addColumn('passwordHash', 'text', (c) => c.notNull())
        .addColumn('rol', 'text') // null: cuentas anteriores a los roles (eran de organizador)
        .addColumn('creado', 'text')
        .addColumn('tokenVersion', 'integer', (c) => c.notNull().defaultTo(0))
        .execute();

    t = db.schema.createTable('organizadores').addColumn('id', 'text', (c) => c.primaryKey());
    for (const c of ['nombre', 'zona']) t = texto(t, c, true);
    for (const c of ['descripcion', 'instagram', 'whatsapp', 'logo', 'creada']) t = texto(t, c);
    t = t.addColumn('ownerId', 'text', (c) => c.unique()); // una organizacion por cuenta
    await t.execute();

    t = db.schema.createTable('clubes').addColumn('id', 'text', (c) => c.primaryKey());
    t = texto(t, 'nombre', true);
    for (const c of ['logo', 'whatsapp', 'creado']) t = texto(t, c);
    t = t.addColumn('ownerId', 'text', (c) => c.notNull().unique()); // un equipo por cuenta de capitan
    await t.execute();

    // Plantel del club (datos personales: solo los ve el dueño y los organizadores de sus torneos)
    await db.schema.createTable('club_jugadores')
        .addColumn('clubId', 'text', (c) => c.notNull().references('clubes.id').onDelete('cascade'))
        .addColumn('orden', 'integer', (c) => c.notNull())
        .addColumn('nombre', 'text', (c) => c.notNull())
        .addColumn('apellido', 'text', (c) => c.notNull())
        .addColumn('dni', 'text', (c) => c.notNull())
        .addColumn('nacimiento', 'text', (c) => c.notNull())
        .addPrimaryKeyConstraint('club_jugadores_pk', ['clubId', 'orden'])
        .execute();

    // ---- torneos ----
    t = db.schema.createTable('torneos').addColumn('id', 'text', (c) => c.primaryKey());
    for (const c of ['nombre', 'modalidad', 'zona', 'fechaInicio', 'estado']) t = texto(t, c, true);
    for (const c of ['organizador', 'organizadorId', 'categoria', 'localidad', 'sede', 'direccion', 'diaJuego', 'horario', 'formato', 'whatsapp', 'descripcion']) t = texto(t, c);
    t = entero(t, 'equiposMax', 0);
    t = entero(t, 'equiposInscriptos', 0);
    t = entero(t, 'precioInscripcion', 0);
    t = entero(t, 'precioFecha', 0);
    t = texto(t, 'reglasPago'); // JSON
    t = texto(t, 'limiteEdad'); // JSON o null
    await t.execute();

    // Un equipo por torneo (con las estadisticas de la tabla); club_id lo vincula al club del capitan
    t = db.schema.createTable('equipos').addColumn('id', 'text', (c) => c.primaryKey());
    t = texto(t, 'name', true);
    t = texto(t, 'logo');
    t = texto(t, 'club_id');
    t = texto(t, 'tor_id', true);
    for (const c of ['points', 'played', 'wins', 'draws', 'losses', 'goal_difference', 'goals_for', 'goals_against']) t = entero(t, c, 0);
    await t.execute();

    // Estadisticas por jugador (datos viejos de prueba; no se cargan desde la app)
    t = db.schema.createTable('jugadores').addColumn('id', 'text', (c) => c.primaryKey());
    for (const c of ['full_name', 'tor_id', 'team_id']) t = texto(t, c);
    for (const c of ['played', 'goals', 'yellow_cards', 'red_cards', 'mvp']) t = entero(t, c, 0);
    await t.execute();

    t = db.schema.createTable('fechas').addColumn('id', 'text', (c) => c.primaryKey());
    t = texto(t, 'tor_id', true);
    t = entero(t, 'numero', 0);
    for (const c of ['dia', 'inicio', 'fin']) t = texto(t, c, true);
    t = entero(t, 'canchas', 1);
    t = entero(t, 'precio', 0);
    t = texto(t, 'creada');
    t = entero(t, 'cobro', 0); // 1 = con cobro online (tiene pagos por equipo); 0 = fecha anterior al cobro
    t = texto(t, 'vencePago');
    t = texto(t, 'reglas'); // JSON: copia de las reglas del torneo al crear la fecha
    t = entero(t, 'pagosProcesados', 0);
    t = t.addUniqueConstraint('fechas_torneo_numero', ['tor_id', 'numero']);
    await t.execute();

    // La parte que paga cada equipo en una fecha
    await db.schema.createTable('fecha_pagos')
        .addColumn('fechaId', 'text', (c) => c.notNull().references('fechas.id').onDelete('cascade'))
        .addColumn('equipoId', 'text', (c) => c.notNull())
        .addColumn('orden', 'integer', (c) => c.notNull().defaultTo(0)) // el de los partidos: local, visita, local, visita...
        .addColumn('estado', 'text', (c) => c.notNull()) // pendiente | pagado | vencido
        .addColumn('monto', 'integer', (c) => c.notNull().defaultTo(0))
        .addColumn('pago', 'text') // JSON: datos del cobro
        .addPrimaryKeyConstraint('fecha_pagos_pk', ['fechaId', 'equipoId'])
        .execute();

    t = db.schema.createTable('partidos').addColumn('id', 'text', (c) => c.primaryKey());
    t = texto(t, 'tor_id', true);
    t = entero(t, 'fecha');
    for (const c of ['home_id', 'away_id', 'date']) t = texto(t, c);
    t = entero(t, 'cancha');
    t = entero(t, 'home_goals');
    t = entero(t, 'away_goals');
    t = texto(t, 'wo'); // local | visita | doble
    await t.execute();

    // ---- plata ----
    t = db.schema.createTable('inscripciones').addColumn('id', 'text', (c) => c.primaryKey());
    for (const c of ['torId', 'clubId', 'ownerId', 'estado']) t = texto(t, c, true);
    t = texto(t, 'equipo'); // JSON { name }
    t = entero(t, 'monto', 0);
    t = texto(t, 'creada');
    t = texto(t, 'equipoId');
    t = texto(t, 'pago'); // JSON
    await t.execute();

    t = db.schema.createTable('multas').addColumn('id', 'text', (c) => c.primaryKey());
    for (const c of ['clubId', 'equipo', 'tor_id', 'torneo', 'organizadorId', 'creada']) t = texto(t, c);
    t = texto(t, 'equipoId', true);
    t = texto(t, 'fecha_id', true);
    t = entero(t, 'fecha');
    t = entero(t, 'monto', 0);
    t = texto(t, 'estado', true);
    t = texto(t, 'pago'); // JSON
    t = t.addUniqueConstraint('multas_fecha_equipo', ['fecha_id', 'equipoId']); // una multa por equipo y fecha
    await t.execute();

    t = db.schema.createTable('amistosos').addColumn('id', 'text', (c) => c.primaryKey());
    for (const c of ['tor_id', 'fecha_id', 'date', 'estado']) t = texto(t, c, true);
    t = t.addColumn('partido_id', 'text', (c) => c.notNull().unique()); // un amistoso por partido
    t = entero(t, 'cancha');
    for (const c of ['torneo', 'organizador', 'organizadorId', 'modalidad', 'categoria', 'sede', 'direccion', 'zona', 'localidad', 'ausenteClubId', 'creado']) t = texto(t, c);
    t = texto(t, 'anfitrion'); // JSON
    t = texto(t, 'rival'); // JSON o null
    t = texto(t, 'pago'); // JSON
    t = entero(t, 'precioOriginal', 0);
    t = entero(t, 'precio', 0);
    await t.execute();

    // ---- indices ----
    // Nombres unicos sin importar mayusculas (no puede haber dos equipos "Los Tigres" y "los tigres")
    await db.schema.createIndex('clubes_nombre').unique().on('clubes').expression(sql`lower(nombre)`).execute();
    await db.schema.createIndex('organizadores_nombre').unique().on('organizadores').expression(sql`lower(nombre)`).execute();
    // Un club no se puede anotar dos veces en el mismo torneo (club_id null = equipo de prueba sin capitan)
    await db.schema.createIndex('equipos_torneo_club').unique().on('equipos').columns(['tor_id', 'club_id']).execute();

    const indices = [
        ['torneos', 'organizadorId'], ['equipos', 'tor_id'], ['equipos', 'club_id'], ['jugadores', 'tor_id'], ['jugadores', 'team_id'],
        ['fechas', 'tor_id'], ['partidos', 'tor_id'], ['inscripciones', 'torId'], ['inscripciones', 'clubId'],
        ['multas', 'clubId'], ['multas', 'tor_id'], ['amistosos', 'tor_id'], ['amistosos', 'estado'],
    ];
    for (const [tabla, col] of indices) await db.schema.createIndex(`${tabla}_${col}`).on(tabla).column(col).execute();
}

export async function down(db) {
    for (const t of ['amistosos', 'multas', 'inscripciones', 'partidos', 'fecha_pagos', 'fechas', 'jugadores', 'equipos', 'torneos', 'club_jugadores', 'clubes', 'organizadores', 'usuarios']) {
        await db.schema.dropTable(t).ifExists().execute();
    }
}
