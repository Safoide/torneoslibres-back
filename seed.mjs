// Datos de prueba: borra TODOS los torneos (y sus equipos, jugadores, partidos e inscripciones)
// y crea 25 torneos nuevos con equipos, fixture y tabla de posiciones.
// Tambien crea una cuenta de organizador para cada organizacion que no tenia dueño.
//
// Uso:  node seed.mjs   (se puede correr con la API prendida: escribe todo junto en una transaccion)
// Antes de escribir hace una copia de la base en databases/backup-<fecha>.db

import path from 'path';
import bcrypt from 'bcryptjs';

const { migrar, copiarBase, cerrar, DB_FILE } = await import('./db/index.js');
const { exportarTodo, reemplazarTodo } = await import('./db/datos.js');
await migrar();
const datos = await exportarTodo();
const PASSWORD = 'Torneos123';
const HOY = '2026-11-05';

// ---------- utilidades ----------
let semilla = 20261105; // random con semilla: cada corrida genera lo mismo
const rnd = () => {
    semilla |= 0; semilla = (semilla + 0x6D2B79F5) | 0;
    let t = Math.imul(semilla ^ (semilla >>> 15), 1 | semilla);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const entre = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const elegir = (arr) => arr[Math.floor(rnd() * arr.length)];
const mezclar = (arr) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const poisson = (l) => { const L = Math.exp(-l); let k = 0, p = 1; do { k++; p *= rnd(); } while (p > L); return k - 1; };
const id = (palabra, n) => n > 9 ? `${palabra}-${n}` : `${palabra}-0${n}`; // igual que assets.js

const leer = (n) => datos[n];
const escribir = (n, data) => { datos[n] = data; };

const sumarDias = (iso, dias) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + dias); return d.toISOString().slice(0, 10); };
const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const diaDe = (iso) => DIAS[new Date(`${iso}T12:00:00Z`).getUTCDay()];

// ---------- nombres ----------
const LOS = ['Tigres', 'Leones', 'Halcones', 'Lobos', 'Toros', 'Cóndores', 'Pumas del Sur', 'Zorros', 'Tiburones', 'Guerreros', 'Cracks', 'Pibes', 'Galácticos', 'Mosqueteros', 'Gladiadores', 'Vikingos', 'Titanes', 'Cuervos', 'Chanchos', 'Muchachos', 'Bohemios', 'Rebeldes', 'Magos', 'Dragones', 'Jaguares', 'Búhos', 'Cocodrilos', 'Rayos', 'Ñoños', 'Tanques'].map(n => `Los ${n}`);
const LAS = ['Gallinas', 'Panteras', 'Águilas', 'Leonas', 'Tigresas', 'Pibas', 'Guerreras', 'Cobras', 'Fieras', 'Lobas', 'Brujas', 'Amazonas', 'Estrellas', 'Halconas', 'Diablas', 'Gacelas', 'Piratas', 'Cracks', 'Tormentas', 'Chicas del Barrio'].map(n => `Las ${n}`);
const CLUBES = ['Deportivo Alvear', 'Atlético Monte', 'Sporting Villa Real', 'Unión Central', 'FC Bonaerense', 'Club Estrella Sur', 'Juventud Unida', 'Defensores del Oeste', 'Nueva Esperanza', 'Social Norte', 'Los Amigos FC', 'Atlético Pueblo', 'Real Barrio', 'San Cayetano FC', 'Deportivo Los Andes', 'Villa Libertad', 'Argentinos del Sur', 'Estudiantes Unidos', 'La Pampa FC', 'Ferro Oeste Jr', 'Sportivo Norte', 'Santa Rita FC', 'El Fortín', 'La Resistencia'];
const M_NOMBRES = ['Juan', 'Mateo', 'Santiago', 'Lucas', 'Nicolás', 'Facundo', 'Matías', 'Tomás', 'Franco', 'Agustín', 'Gonzalo', 'Ezequiel', 'Joaquín', 'Bruno', 'Leandro', 'Martín', 'Diego', 'Federico', 'Sebastián', 'Maximiliano', 'Ignacio', 'Emiliano', 'Cristian', 'Pablo'];
const F_NOMBRES = ['Sofía', 'Valentina', 'Camila', 'Lucía', 'Martina', 'Julieta', 'Agustina', 'Micaela', 'Florencia', 'Milagros', 'Carolina', 'Brenda', 'Rocío', 'Luciana', 'Natalia', 'Paula', 'Romina', 'Daniela', 'Belén', 'Candela', 'Antonella', 'Abril'];
const APELLIDOS = ['González', 'Rodríguez', 'Gómez', 'Fernández', 'López', 'Díaz', 'Martínez', 'Pérez', 'Romero', 'Sánchez', 'García', 'Sosa', 'Álvarez', 'Torres', 'Ruiz', 'Ramírez', 'Flores', 'Acosta', 'Benítez', 'Medina', 'Herrera', 'Suárez', 'Aguirre', 'Giménez', 'Gutiérrez', 'Peralta', 'Castro', 'Ortiz', 'Silva', 'Molina', 'Rojas', 'Ibarra', 'Cabrera', 'Ríos', 'Morales', 'Domínguez'];

const poolEquipos = (cat) => cat === 'femenino' ? [...LAS, ...CLUBES.slice(0, 12)]
    : cat === 'masculino' ? [...LOS, ...CLUBES] : [...LOS.slice(0, 15), ...LAS.slice(0, 10), ...CLUBES];

// ---------- organizaciones / cuentas ----------
const CUENTAS = { // email de cada organizacion que todavia no tiene dueño
    'ORG-01': 'parquenorte', 'ORG-02': 'belgrano', 'ORG-03': 'urquiza', 'ORG-04': 'caballito', 'ORG-05': 'pibasfc',
    'ORG-06': 'almagro5', 'ORG-07': 'crespojuega', 'ORG-08': 'flores', 'ORG-09': 'pp', 'ORG-10': 'zonanorte',
    'ORG-11': 'sanisidro', 'ORG-12': 'lanus5', 'ORG-13': 'avellaneda8',
};

const SEDES = { // sede y direccion por organizacion
    'ORG-01': ['Complejo Las Heras', 'Av. Las Heras 4100'], 'ORG-02': ['Canchas Juramento', 'Juramento 2350'],
    'ORG-03': ['Urquiza Sports Center', 'Av. Triunvirato 4800'], 'ORG-04': ['Predio Caballito', 'Av. Pedro Goyena 900'],
    'ORG-05': ['Núñez Soccer', 'Av. del Libertador 7200'], 'ORG-06': ['Almagro 5 Arena', 'Medrano 750'],
    'ORG-07': ['Crespo Juega', 'Av. Corrientes 5900'], 'ORG-08': ['Polideportivo Flores', 'Av. Rivadavia 7800'],
    'ORG-09': ['PP Sports', 'Av. Caseros 3300'], 'ORG-10': ['Complejo Zona Norte', 'Av. Maipú 1500'],
    'ORG-11': ['Club Atlético San Isidro', 'Av. Centenario 800'], 'ORG-12': ['Lanús F5', 'Av. Hipólito Yrigoyen 3900'],
    'ORG-13': ['Avellaneda 8', 'Av. Mitre 600'], 'ORG-14': ['Gambeta Arena', 'Av. Cerviño 3500'],
};

const LOCALIDAD = { 'Vicente López': 'GBA Norte', 'San Isidro': 'GBA Norte', 'Lanús': 'GBA Sur', 'Avellaneda': 'GBA Sur' };

// ---------- los 25 torneos ----------
// [org, nombre, modalidad, categoria, estado, inscriptos, cupoMax, inicio, formato]
const R1 = 'Liga a una rueda', R2 = 'Liga a una rueda + playoffs', R3 = 'Todos contra todos';
const TORNEOS = [
    // en curso (9)
    ['ORG-01', 'Copa Palermo Apertura', 'f5', 'masculino', 'en-curso', 8, 8, '2026-10-03', R2],
    ['ORG-02', 'Liga Nocturna Belgrano', 'f7', 'masculino', 'en-curso', 10, 10, '2026-09-14', R1],
    ['ORG-05', 'Liga Femenina Núñez', 'f7', 'femenino', 'en-curso', 6, 8, '2026-10-14', R1],
    ['ORG-06', 'Relámpago Almagro F5', 'f5', 'masculino', 'en-curso', 12, 12, '2026-10-17', R2],
    ['ORG-08', 'Liga Flores F7 Mixto', 'f7', 'mixto', 'en-curso', 7, 8, '2026-10-02', R3],
    ['ORG-04', 'Gran Copa Caballito F11', 'f11', 'masculino', 'en-curso', 5, 6, '2026-10-11', R1],
    ['ORG-12', 'Torneo Lanús F5', 'f5', 'masculino', 'en-curso', 14, 14, '2026-10-24', R1],
    ['ORG-14', 'Gambeta Simple Cup', 'f5', 'mixto', 'en-curso', 4, 4, '2026-10-25', R1],
    ['ORG-09', 'Torneo Parque Patricios F8', 'f8', 'masculino', 'en-curso', 6, 6, '2026-10-18', R1],
    // finalizados (4)
    ['ORG-01', 'Copa Otoño Palermo F7', 'f7', 'masculino', 'finalizado', 8, 8, '2026-08-08', R1],
    ['ORG-03', 'Torneo Invierno Urquiza F8', 'f8', 'mixto', 'finalizado', 6, 8, '2026-07-05', R1],
    ['ORG-10', 'Copa Vicente López F11', 'f11', 'masculino', 'finalizado', 6, 6, '2026-08-16', R1],
    ['ORG-07', 'Crespo Juega Clausura F5', 'f5', 'femenino', 'finalizado', 5, 8, '2026-09-05', R1],
    // inscripcion abierta (9)
    ['ORG-01', 'Copa Palermo Clausura', 'f5', 'masculino', 'inscripcion-abierta', 11, 16, '2026-11-14', R2],
    ['ORG-02', 'Liga Belgrano F5 Mixto', 'f5', 'mixto', 'inscripcion-abierta', 9, 12, '2026-11-17', R1],
    ['ORG-03', 'Torneo Villa Urquiza F8', 'f8', 'masculino', 'inscripcion-abierta', 6, 12, '2026-11-22', R1],
    ['ORG-04', 'Copa Caballito F7 Femenino', 'f7', 'femenino', 'inscripcion-abierta', 8, 10, '2026-11-25', R1],
    ['ORG-11', 'Liga San Isidro F7', 'f7', 'masculino', 'inscripcion-abierta', 5, 12, '2026-11-29', R1],
    ['ORG-13', 'Copa Avellaneda F8', 'f8', 'mixto', 'inscripcion-abierta', 12, 12, '2026-11-21', R2],
    ['ORG-14', 'Gambeta Simple Verano', 'f5', 'masculino', 'inscripcion-abierta', 0, 10, '2026-11-15', R1],
    ['ORG-05', 'Pibas FC Verano', 'f5', 'femenino', 'inscripcion-abierta', 3, 8, '2026-11-28', R1],
    ['ORG-12', 'Lanús F7 Apertura', 'f7', 'masculino', 'inscripcion-abierta', 13, 14, '2026-11-20', R2],
    // proximamente (3)
    ['ORG-07', 'Copa Villa Crespo F5 Mixto', 'f5', 'mixto', 'proximamente', 2, 16, '2027-01-16', R1],
    ['ORG-09', 'Torneo Parque Patricios F11', 'f11', 'masculino', 'proximamente', 0, 12, '2027-01-17', R1],
    ['ORG-10', 'Copa Zona Norte F8', 'f8', 'masculino', 'proximamente', 3, 12, '2027-01-23', R2],
];

const PRECIO = { f5: [70000, 95000, 28000, 35000], f7: [100000, 140000, 38000, 48000], f8: [110000, 150000, 42000, 52000], f11: [160000, 220000, 60000, 80000] };
const JUGADORES = { f5: 8, f7: 10, f8: 11, f11: 15 };
const GOLES_BASE = { f5: 3.2, f7: 2.6, f8: 2.2, f11: 1.4 };
const redondear = (n) => Math.round(n / 1000) * 1000;

const HORARIO = (dia) => dia === 'Sábado' ? '16:00 a 22:00' : dia === 'Domingo' ? '10:00 a 16:00' : '20:00 a 00:00';

// Fixture "todos contra todos" (metodo del circulo). Con cantidad impar, a uno le toca libre cada fecha.
const fixture = (equipos) => {
    const lista = equipos.length % 2 ? [...equipos, null] : [...equipos];
    const n = lista.length;
    const rondas = [];

    for (let r = 0; r < n - 1; r++) {
        const partidos = [];
        for (let i = 0; i < n / 2; i++) {
            const a = lista[i], b = lista[n - 1 - i];
            if (a && b) partidos.push(r % 2 ? [b, a] : [a, b]);
        }
        rondas.push(partidos);
        lista.splice(1, 0, lista.pop()); // rota todos menos el primero
    }

    return rondas;
};

// ---------- arma todo ----------
const backup = path.join(path.dirname(DB_FILE), `backup-${Date.now()}.db`);
await copiarBase(backup);
console.log('Copia de la base en', backup);

// cuentas de organizador (se reusan si ya existian de una corrida anterior)
const usuarios = leer('usuarios');
const organizaciones = leer('organizadores');
const hash = bcrypt.hashSync(PASSWORD, 10);
const cuentas = [];

for (const org of organizaciones) {
    const slug = CUENTAS[org.id];
    if (!slug) continue;

    const email = `${slug}@torneoslibres.test`;
    let user = usuarios.find(u => u.email === email);

    if (!user) {
        user = {
            id: `USR-${Math.floor(rnd() * 0xffffffff).toString(16).padStart(8, '0')}`,
            nombre: org.nombre, email, passwordHash: hash, rol: 'organizador', creado: new Date().toISOString(),
        };
        usuarios.push(user);
    }

    org.ownerId = user.id;
    cuentas.push([org.nombre, email]);
}

const torneos = [], equipos = [], jugadores = [], partidos = [], fechas = [];

// El equipo del capitan que ya existe (si hay) se anota en estos torneos en curso para probar "Tu proxima fecha"
const club = leer('clubes')[0];
const CON_CLUB = ['TOR-01', 'TOR-08', 'TOR-10', 'TOR-14', 'TOR-23']; // en curso, finalizado, abierto y proximamente
const resumen = [];

for (const [i, [orgId, nombre, modalidad, categoria, estado, inscriptos, equiposMax, fechaInicio, formato]] of TORNEOS.entries()) {
    const org = organizaciones.find(o => o.id === orgId);
    const dia = diaDe(fechaInicio);
    const [pMin, pMax, fMin, fMax] = PRECIO[modalidad];
    const torId = id('TOR', i + 1);
    const [sede, direccion] = SEDES[orgId];

    torneos.push({
        id: torId, nombre, organizador: org.nombre, modalidad, categoria, zona: org.zona,
        localidad: LOCALIDAD[org.zona] ?? 'CABA', sede, direccion, fechaInicio, diaJuego: dia,
        horario: HORARIO(dia), formato, equiposMax, equiposInscriptos: inscriptos,
        precioInscripcion: redondear(pMin + rnd() * (pMax - pMin)), precioFecha: redondear(fMin + rnd() * (fMax - fMin)),
        estado, whatsapp: org.whatsapp || '5491100000099',
        descripcion: `Torneo de ${modalidad.toUpperCase()} ${categoria} con árbitros y fixture online. Organiza ${org.nombre}.`,
        organizadorId: orgId,
    });

    // equipos inscriptos
    const nombres = mezclar(poolEquipos(categoria)).filter(n => n !== club?.nombre).slice(0, inscriptos);
    const equiposTor = nombres.map((n, k) => {
        const esClub = club && CON_CLUB.includes(torId) && k === 0;
        const e = {
            id: id('TEAM', equipos.length + 1), name: esClub ? club.nombre : n, logo: esClub ? club.logo : '', ...(esClub && { club_id: club.id }), tor_id: torId, points: 0, played: 0, wins: 0,
            draws: 0, losses: 0, goal_difference: 0, goals_for: 0, goals_against: 0,
        };
        e.fuerza = 0.6 + rnd();
        equipos.push(e);
        return e;
    });

    // jugadores de cada equipo (las estadisticas se completan despues, con los partidos)
    const plantel = new Map();
    for (const e of equiposTor) {
        const usados = new Set();
        const lista = [];

        while (lista.length < JUGADORES[modalidad]) {
            const mujer = categoria === 'femenino' || (categoria === 'mixto' && rnd() < 0.4);
            const full = `${elegir(mujer ? F_NOMBRES : M_NOMBRES)} ${elegir(APELLIDOS)}`;
            if (usados.has(full)) continue;
            usados.add(full);

            lista.push({
                id: id('PLAYER', jugadores.length + 1), full_name: full, tor_id: torId, team_id: e.id,
                played: 0, goals: 0, yellow_cards: 0, red_cards: 0, mvp: 0, peso: rnd() ** 2 + 0.05,
            });
            jugadores.push(lista.at(-1));
        }
        plantel.set(e.id, lista);
    }

    if (estado !== 'en-curso' && estado !== 'finalizado') { resumen.push([torId, nombre, estado, inscriptos, equiposMax, '-']); continue; }

    // fixture: finalizado = todo jugado; en curso = jugadas las fechas cuya fecha ya paso + la proxima programada
    const rondas = fixture(equiposTor);
    const fechaDe = (r) => sumarDias(fechaInicio, 7 * r);
    const jugadas = estado === 'finalizado' ? rondas.length
        : Math.min(rondas.filter((_, r) => fechaDe(r) < HOY).length, rondas.length - 1);
    const precioFecha = torneos.at(-1).precioFecha;
    const horaInicio = parseInt(HORARIO(dia), 10);

    rondas.slice(0, jugadas).forEach((ronda, r) => { // solo fechas ya jugadas: la proxima la crea el organizador desde la app
        const hh = (h) => `${String(h % 24).padStart(2, '0')}:00`;
        fechas.push({
            id: id('FECHA', fechas.length + 1), tor_id: torId, numero: r + 1, dia: fechaDe(r),
            inicio: hh(horaInicio), fin: hh(horaInicio + Math.ceil(ronda.length / 2)), canchas: 2,
            precio: precioFecha, creada: `${sumarDias(fechaDe(r), -3)}T15:00:00.000Z`,
        });

        ronda.forEach(([local, visita], k) => {
            const jugado = true;
            const hora = String((horaInicio + Math.floor(k / 2)) % 24).padStart(2, '0');
            const p = {
                id: id('MATCH', partidos.length + 1), tor_id: torId, fecha: r + 1, home_id: local.id, away_id: visita.id,
                date: `${fechaDe(r)}T${hora}:00:00-03:00`, home_goals: null, away_goals: null,
            };

            if (jugado) {
                const base = GOLES_BASE[modalidad];
                p.home_goals = poisson(base * Math.sqrt(local.fuerza / visita.fuerza));
                p.away_goals = poisson(base * Math.sqrt(visita.fuerza / local.fuerza));

                for (const [eq, gf, gc] of [[local, p.home_goals, p.away_goals], [visita, p.away_goals, p.home_goals]]) {
                    eq.played++; eq.goals_for += gf; eq.goals_against += gc; eq.goal_difference += gf - gc;
                    if (gf > gc) { eq.wins++; eq.points += 3; } else if (gf === gc) { eq.draws++; eq.points++; } else eq.losses++;

                    // goles, tarjetas y mvp de los jugadores
                    const lista = plantel.get(eq.id);
                    const peso = lista.reduce((a, j) => a + j.peso, 0);
                    for (let g = 0; g < gf; g++) {
                        let x = rnd() * peso;
                        lista.find(j => (x -= j.peso) < 0).goals++;
                    }
                    const presentes = lista.filter(() => rnd() > 0.15);
                    presentes.forEach(j => { j.played++; if (rnd() < 0.08) j.yellow_cards++; if (rnd() < 0.01) j.red_cards++; });
                    if (presentes.length && rnd() < 0.7) elegir(presentes).mvp++;
                }
            }

            partidos.push(p);
        });
    });

    resumen.push([torId, nombre, estado, inscriptos, equiposMax, `${jugadas}/${rondas.length}`]);
}

// los partidos mas nuevos primero (asi los guarda la app, que agrega al principio)
partidos.sort((a, b) => parseInt(b.id.split('-')[1]) - parseInt(a.id.split('-')[1]));

escribir('usuarios', usuarios);
escribir('organizadores', organizaciones);
escribir('torneos', torneos);
escribir('equipos', equipos.map(({ fuerza, ...e }) => e));
escribir('jugadores', jugadores.map(({ peso, ...j }) => j));
escribir('partidos', partidos);
escribir('inscripciones', []);
escribir('fechas', fechas);

await reemplazarTodo(datos);
await cerrar();

console.table(resumen.map(([id, nombre, estado, insc, max, fechas]) => ({ id, nombre, estado, equipos: `${insc}/${max}`, fechas })));
console.log(`\nPassword de todas las cuentas: ${PASSWORD}`);
console.table(cuentas.map(([organizacion, email]) => ({ organizacion, email })));
