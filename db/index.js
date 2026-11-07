import { AsyncLocalStorage } from 'async_hooks';
import path from 'path';
import Database from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';
import { Migrator } from 'kysely/migration';
import { DATA_DIR } from '../config.js';
import * as m001 from './migraciones/001-inicial.js';
import * as m002 from './migraciones/002-login-google.js';
import * as m003 from './migraciones/003-cierre-inscripcion.js';
import * as m004 from './migraciones/004-recuperar-password.js';
import * as m005 from './migraciones/005-notificaciones.js';
import * as m006 from './migraciones/006-recordatorio-pago.js';
import * as m007 from './migraciones/007-avisos-organizador.js';
import * as m008 from './migraciones/008-saldos.js';
import * as m009 from './migraciones/009-devoluciones.js';
import * as m010 from './migraciones/010-verificar-email.js';

// Base de datos: SQLite (un archivo en DATA_DIR) a través de Kysely.
// Kysely arma las consultas: para pasar a PostgreSQL se cambia el dialecto de acá (y poco más),
// no los managers. Por eso las consultas no usan funciones propias de SQLite.

export const DB_FILE = process.env.DB_FILE || path.join(DATA_DIR, 'torneoslibres.db');

export const sqlite = new Database(DB_FILE);
sqlite.pragma('journal_mode = WAL'); // lecturas y escrituras en paralelo, y aguanta cortes sin corromperse
sqlite.pragma('foreign_keys = ON');
sqlite.pragma('busy_timeout = 5000'); // si otro proceso (un script) esta escribiendo, espera en vez de fallar

export const db = new Kysely({ dialect: new SqliteDialect({ database: sqlite }) });

// ---------- Transacciones ----------
// Todo lo que corre dentro de tx(...) usa la misma transaccion sin tener que pasarla de mano en mano:
// los managers piden la conexion con q(). Si algo falla adentro, no se guarda nada.
// Ojo: nunca hacer un cobro (await lento) dentro de una transaccion: frena al resto de la API.
const actual = new AsyncLocalStorage();

export const q = () => actual.getStore() ?? db;

export const tx = (fn) => actual.getStore()
    ? fn() // ya estamos en una transaccion: se suma a esa
    : db.transaction().execute((trx) => actual.run(trx, fn));

// ---------- Migraciones ----------
// Cada cambio de estructura va en un archivo nuevo de db/migraciones/ (nunca editar uno ya publicado)
// y se agrega a esta lista. Corren solas al arrancar la API: en produccion la base arranca vacia.
const MIGRACIONES = { '001-inicial': m001, '002-login-google': m002, '003-cierre-inscripcion': m003, '004-recuperar-password': m004, '005-notificaciones': m005, '006-recordatorio-pago': m006, '007-avisos-organizador': m007, '008-saldos': m008, '009-devoluciones': m009, '010-verificar-email': m010 };

export const migrar = async () => {
    const migrator = new Migrator({ db, provider: { getMigrations: async () => MIGRACIONES } });
    const { error, results } = await migrator.migrateToLatest();

    for (const r of results ?? []) {
        if (r.status === 'Success') console.log(`Migración aplicada: ${r.migrationName}`);
        if (r.status === 'Error') console.error(`Falló la migración ${r.migrationName}`);
    }
    if (error) throw error;
};

// ---------- Copia de seguridad ----------
// Copia consistente de la base (aunque la API este escribiendo). El backup diario del servidor
// (tar de DATA_DIR a las 04:00) se lleva esta copia.
export const COPIA_FILE = DB_FILE.replace(/\.db$/, '') + '-copia.db';
export const copiarBase = (destino = COPIA_FILE) => sqlite.backup(destino);

export const cerrar = () => db.destroy();

// ---------- Ayudas ----------
// Error por clave repetida (UNIQUE): SQLite y PostgreSQL lo informan distinto
export const esDuplicado = (err) => err?.code === 'SQLITE_CONSTRAINT_UNIQUE' || err?.code === 'SQLITE_CONSTRAINT_PRIMARYKEY' || err?.code === '23505';

// Orden "natural" de ids como TEAM-9, TEAM-10 (como texto, TEAM-10 quedaria antes que TEAM-9)
export const porId = (qb, dir = 'asc') => qb.orderBy((eb) => eb.fn('length', ['id']), dir).orderBy('id', dir);

// Proximo id secuencial (TOR-05, TEAM-123...). Llamarlo dentro de tx() para que dos pedidos no tomen el mismo.
export const siguienteId = async (tabla, prefijo) => {
    const filas = await q().selectFrom(tabla).select('id').where('id', 'like', `${prefijo}-%`).execute();
    const max = filas.reduce((m, { id }) => Math.max(m, parseInt(id.slice(prefijo.length + 1), 10) || 0), 0);
    return max + 1;
};
