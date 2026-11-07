// Casos de prueba de pagos de fechas, penalizaciones, multas y amistosos express.
// Crea cuentas de prueba (organizador + capitanes) y 14 torneos, cada uno armado para un caso.
// Se puede correr las veces que haga falta: borra los casos de la corrida anterior y los vuelve a crear.
// No toca el resto de los datos. Antes de escribir hace una copia de la base en databases/backup-casos-<fecha>.db.
//
// Uso:  node casos-prueba.mjs   (se puede correr con la API prendida: los dos usan la misma base)
// Contraseña de todas las cuentas: Prueba123
//
// Nota: para ver hoy los casos "ya vencidos" (W.O., multas, amistosos) se fuerza el vencimiento del pago
// de esas fechas aunque el partido sea en unos días. En la app real vence a las 23:59 del día anterior.

import path from 'path';

const PASSWORD = 'Prueba123';
const DOMINIO = '@torneoslibres.test';
const CUENTAS = {
    organizador: { email: `organizador.casos${DOMINIO}`, nombre: 'Organizador de Casos', rol: 'organizador' },
    alDia: { email: `capitan.aldia${DOMINIO}`, nombre: 'Capitán Al Día', rol: 'capitan', equipo: 'Halcones de Prueba', jugadores: 7 },
    moroso: { email: `capitan.moroso${DOMINIO}`, nombre: 'Capitán Moroso', rol: 'capitan', equipo: 'Deportivo Moroso', jugadores: 7 },
    amistosos: { email: `capitan.amistosos${DOMINIO}`, nombre: 'Capitán Amistosos', rol: 'capitan', equipo: 'Amistosos FC', jugadores: 7 },
    incompleto: { email: `capitan.incompleto${DOMINIO}`, nombre: 'Capitán Incompleto', rol: 'capitan', equipo: 'Incompletos FC', jugadores: 2 },
};
const RIVALES = ['Los Tigres de Prueba', 'Las Panteras de Prueba', 'Atlético Prueba', 'Unión Test', 'Sporting Casos', 'Real Ensayo', 'Juventud Demo', 'Los Lobos de Prueba'];

// ---------- 1) Copia de la base ----------
const { migrar, copiarBase, cerrar, q, tx, DB_FILE } = await import('./db/index.js');
await migrar();
const backup = path.join(path.dirname(DB_FILE), `backup-casos-${Date.now()}.db`);
await copiarBase(backup);
console.log('Copia de la base en', backup);

const { torneosManager, equiposManager, partidosManager, fechasManager, usuariosManager, organizadoresManager,
    clubesManager, amistososManager, multasManager } = await import('./manager/instances.js');
const { procesarVencimientos } = await import('./services/vencimientosService.js');
const { vencimientoPago } = await import('./manager/fechasManager.js');

// ---------- 2) Borrar los casos de una corrida anterior ----------
const emails = Object.values(CUENTAS).map(c => c.email);
const ids = (filas) => filas.map(f => f.id);
const algo = (l) => (l.length ? l : ['-']); // "in ()" vacio no es SQL valido
const usuariosViejos = ids(await q().selectFrom('usuarios').select('id').where('email', 'in', emails).execute());
if (usuariosViejos.length) {
    const orgs = ids(await q().selectFrom('organizadores').select('id').where('ownerId', 'in', usuariosViejos).execute());
    const clubs = ids(await q().selectFrom('clubes').select('id').where('ownerId', 'in', usuariosViejos).execute());
    const tors = ids(await q().selectFrom('torneos').select('id').where('organizadorId', 'in', algo(orgs)).execute());
    const fechas = ids(await q().selectFrom('fechas').select('id').where('tor_id', 'in', algo(tors)).execute());
    // Los amistosos de estos torneos y los que tomaron estos clubes (aunque sean de otro torneo)
    const amis = (await q().selectFrom('amistosos').select(['id', 'tor_id', 'rival']).execute())
        .filter(a => tors.includes(a.tor_id) || clubs.includes(JSON.parse(a.rival ?? 'null')?.clubId));

    await tx(async () => {
        await q().deleteFrom('devoluciones').where('tor_id', 'in', algo(tors)).execute();
        await q().deleteFrom('saldos').where('tor_id', 'in', algo(tors)).execute();
        await q().deleteFrom('fecha_pagos').where('fechaId', 'in', algo(fechas)).execute();
        await q().deleteFrom('fechas').where('id', 'in', algo(fechas)).execute();
        await q().deleteFrom('partidos').where('tor_id', 'in', algo(tors)).execute();
        await q().deleteFrom('equipos').where('tor_id', 'in', algo(tors)).execute();
        await q().deleteFrom('amistosos').where('id', 'in', algo(ids(amis))).execute();
        await q().deleteFrom('multas').where((eb) => eb.or([eb('tor_id', 'in', algo(tors)), eb('clubId', 'in', algo(clubs))])).execute();
        await q().deleteFrom('inscripciones').where((eb) => eb.or([eb('torId', 'in', algo(tors)), eb('clubId', 'in', algo(clubs))])).execute();
        await q().deleteFrom('torneos').where('id', 'in', algo(tors)).execute();
        await q().deleteFrom('club_jugadores').where('clubId', 'in', algo(clubs)).execute();
        await q().deleteFrom('clubes').where('id', 'in', algo(clubs)).execute();
        await q().deleteFrom('organizadores').where('id', 'in', algo(orgs)).execute();
        await q().deleteFrom('usuarios').where('id', 'in', usuariosViejos).execute();
    });
    console.log(`Borrados los casos anteriores: ${tors.length} torneos, ${clubs.length} equipos, ${usuariosViejos.length} cuentas`);
}

// ---------- 4) Cuentas, organizacion y equipos de los capitanes ----------
const usuarios = {};
for (const [clave, c] of Object.entries(CUENTAS)) {
    const u = await usuariosManager.registrar({ nombre: c.nombre, email: c.email, password: PASSWORD, rol: c.rol });
    if (u.error) throw new Error(`${c.email}: ${u.error}`);
    usuarios[clave] = u;
}

const org = await organizadoresManager.crear(usuarios.organizador.id, {
    nombre: 'Liga de Casos de Prueba', zona: 'Palermo', whatsapp: '5491155550000',
    descripcion: 'Organización de prueba con un torneo armado para cada caso de pago, penalización y amistoso.',
});
if (org.error) throw new Error('organización: ' + org.error);

const clubes = {};
let dni = 60000000;
for (const clave of ['alDia', 'moroso', 'amistosos', 'incompleto']) {
    const c = CUENTAS[clave];
    const club = await clubesManager.crear(usuarios[clave].id, {
        nombre: c.equipo, whatsapp: '5491155550001',
        jugadores: Array.from({ length: c.jugadores }, (_, i) => ({ nombre: 'Jugador', apellido: `${c.equipo.split(' ')[0]} ${i + 1}`, dni: String(++dni), nacimiento: `${new Date().getFullYear() - 22 - i}-01-01` })),
    });
    if (club.error) throw new Error(`${c.equipo}: ${club.error}`);
    clubes[clave] = await clubesManager.getRawById(club.id);
}

// ---------- 5) Ayudas ----------
const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date());
const dias = (n) => { const d = new Date(`${hoy}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const diaDe = (iso) => DIAS[new Date(`${iso}T12:00:00Z`).getUTCDay()];

const REGLAS = {
    multa50: { penalizacion: true, multaTipo: 'porcentaje', multaValor: 50, amistosos: true },
    fijo10: { penalizacion: true, multaTipo: 'fijo', multaValor: 10000, amistosos: true },
    sinAmistosos: { penalizacion: true, multaTipo: 'fijo', multaValor: 15000, amistosos: false },
    sinPenalizacion: { penalizacion: false, multaTipo: 'porcentaje', multaValor: 0, amistosos: false },
};

// Crea un torneo de la organizacion de casos. equipos: lista de claves de club ('alDia', 'moroso') o nombres de rivales
// estado: cualquiera (el script lo fuerza; un organizador solo puede crear abiertos o "próximamente").
// fechaInicio: por defecto hace 14 días si está en curso y en 10 días si no
const torneo = async (nombre, { estado = 'en-curso', reglas = REGLAS.multa50, equipos = [], equiposMax = 8, dia = dias(5), precioFecha = 30000, fechaInicio } = {}) => {
    const { error, datos } = torneosManager.sanitize({
        nombre, modalidad: 'f5', categoria: 'mixto', zona: 'Palermo', localidad: 'CABA',
        sede: 'Complejo de Pruebas', direccion: 'Av. Siempre Viva 742', fechaInicio: fechaInicio ?? (estado === 'en-curso' ? dias(-14) : dias(10)),
        diaJuego: diaDe(dia), horario: '18:00 a 23:00', formato: 'Liga a una rueda', equiposMax,
        precioInscripcion: 60000, precioFecha, descripcion: 'Torneo de prueba: ' + nombre, reglasPago: reglas,
    });
    if (error) throw new Error(nombre + ': ' + error);

    const tor = await torneosManager.addTor({ ...datos, estado, whatsapp: '5491155550000', equiposInscriptos: equipos.length, organizador: org.nombre, organizadorId: org.id });

    const creados = [];
    for (const e of equipos) {
        const club = clubes[e];
        creados.push(await equiposManager.addTeam({
            name: club ? club.nombre : e, logo: club?.logo ?? '', club_id: club?.id ?? null, tor_id: tor.id,
            points: 0, played: 0, wins: 0, draws: 0, losses: 0, goal_difference: 0, goals_for: 0, goals_against: 0,
        }));
    }
    return { tor, eqs: creados };
};

// Fecha 1 del torneo (con el fixture del metodo del circulo: se enfrentan 1º vs ultimo, 2º vs anteultimo...)
const fecha = async (tor, dia = dias(5)) => {
    const f = await fechasManager.crear(await torneosManager.getTorneoById(tor.id), { dia: dia < dias(3) ? dias(3) : dia, inicio: '18:00', fin: '23:00', canchas: 3 });
    if (f.error) throw new Error(tor.nombre + ': ' + f.error);
    const raw = await fechasManager.getById(f.id);
    // fechas muy cercanas (caso "vence hoy"): se corren despues de crearlas
    return dia < dias(3) ? moverA(raw, dia) : raw;
};

// Corre una fecha (y sus partidos) a otro dia, salteando la anticipacion minima. Sirve para fechas cercanas o ya jugadas
const moverA = async (raw, dia) => {
    const delta = new Date(`${dia}T12:00:00Z`) - new Date(`${raw.dia}T12:00:00Z`);
    for (const p of await partidosManager.getByFecha(raw.tor_id, raw.numero)) {
        await partidosManager.editMatch(p.id, { date: new Date(Date.parse(p.date) + delta - 3 * 3600e3).toISOString().slice(0, 19) + '-03:00' });
    }
    await q().updateTable('fechas').set({ dia, vencePago: vencimientoPago(dia) }).where('id', '=', raw.id).execute();
    return fechasManager.getById(raw.id);
};

const pagar = async (raw, eq) => { const r = await fechasManager.pagar(raw.id, eq.id, {}); if (r.error) throw new Error(r.error); };

// Fuerza el vencimiento del plazo de pago y lo procesa (W.O., multas, amistosos segun las reglas)
const vencer = async (raw) => {
    await q().updateTable('fechas').set({ vencePago: new Date(Date.now() - 60000).toISOString() }).where('id', '=', raw.id).execute();
    await procesarVencimientos();
};

const resumen = [];

// ---------- 6) Los casos ----------
// 1. Pago pendiente (faltan varios días). El moroso también juega acá: no puede pagar hasta saldar su multa.
{
    const { tor, eqs } = await torneo('Casos 1 · Pago pendiente', { equipos: ['alDia', RIVALES[0], RIVALES[1], RIVALES[2], RIVALES[3], 'moroso'] });
    const f = await fecha(tor, dias(6));
    await pagar(f, eqs[1]); await pagar(f, eqs[4]);
    resumen.push([tor.nombre, 'Al Día y Moroso tienen el pago PENDIENTE (vence en unos días). Moroso no puede pagar hasta saldar su multa.']);
}

// 2. Vence hoy: el partido es mañana (cuenta regresiva en rojo)
{
    const { tor, eqs } = await torneo('Casos 2 · Vence hoy', { reglas: REGLAS.fijo10, equipos: ['alDia', RIVALES[4], RIVALES[5], RIVALES[6]], dia: dias(1) });
    const f = await fecha(tor, dias(1));
    await pagar(f, eqs[3]); // el rival ya pago: solo falta Al Dia
    resumen.push([tor.nombre, 'Al Día: pago pendiente que vence HOY a las 23:59 (aviso rojo) y su rival YA PAGÓ. Multa fija de $10.000.']);
}

// 3. Ya pagado (el rival todavia no)
{
    const { tor, eqs } = await torneo('Casos 3 · Ya pagaste', { equipos: ['alDia', RIVALES[0], RIVALES[2], RIVALES[7]] });
    const f = await fecha(tor);
    await pagar(f, eqs[0]);
    resumen.push([tor.nombre, 'Al Día ya PAGÓ su parte; su rival todavía no.']);
}

// 4. Rival no pagó -> W.O. a favor + amistoso PUBLICADO (para tomarlo con Capitán Amistosos).
//    El que no pagó es el Moroso: pierde 0-3 y recibe multa del 50%. En el mismo partido hay un W.O. doble.
{
    const { tor, eqs } = await torneo('Casos 4 · Rival no pagó (amistoso publicado)', { equipos: ['alDia', RIVALES[1], RIVALES[3], RIVALES[4], RIVALES[5], 'moroso'] });
    const f = await fecha(tor, dias(4));
    await pagar(f, eqs[0]); await pagar(f, eqs[1]); await pagar(f, eqs[4]); // eqs[2] vs eqs[3]: ninguno paga -> W.O. doble
    await vencer(f);
    resumen.push([tor.nombre, 'Al Día gana 3-0 por W.O. y tiene un AMISTOSO PUBLICADO con link para compartir. Moroso pierde 0-3 y debe multa del 50% ($15.000). Hay un W.O. doble entre dos rivales.']);
}

// 5. Rival no pagó -> W.O. a favor + amistoso TOMADO por Capitán Amistosos
{
    const { tor, eqs } = await torneo('Casos 5 · Rival no pagó (amistoso tomado)', { equipos: ['alDia', RIVALES[6], RIVALES[7], RIVALES[0]] });
    const f = await fecha(tor, dias(5));
    await pagar(f, eqs[0]); await pagar(f, eqs[1]); await pagar(f, eqs[2]);
    await vencer(f);
    const ami = (await amistososManager.getPublicados(0)).find(a => a.tor_id === tor.id);
    const r = await amistososManager.tomar(ami.id, usuarios.amistosos.id, {});
    if (r.error) throw new Error('tomar amistoso: ' + r.error);
    resumen.push([tor.nombre, 'Al Día gana por W.O. y su amistoso ya lo TOMÓ Amistosos FC (los dos lo ven en "Tu próxima fecha").']);
}

// 6. Rival no pagó, torneo SIN amistosos (multa fija)
{
    const { tor, eqs } = await torneo('Casos 6 · Rival no pagó (sin amistosos)', { reglas: REGLAS.sinAmistosos, equipos: ['alDia', RIVALES[2], RIVALES[4], RIVALES[5]] });
    const f = await fecha(tor, dias(5));
    await pagar(f, eqs[0]); await pagar(f, eqs[1]); await pagar(f, eqs[2]);
    await vencer(f);
    resumen.push([tor.nombre, 'Al Día gana por W.O. pero el torneo NO publica amistosos (solo puede usar la cancha). El rival debe $15.000.']);
}

// 7. SIN penalización: el moroso no paga y no pasa nada automático (decide el organizador)
{
    const { tor, eqs } = await torneo('Casos 7 · Sin penalización', { reglas: REGLAS.sinPenalizacion, equipos: ['alDia', RIVALES[3], RIVALES[6], RIVALES[7], RIVALES[1], 'moroso'] });
    const f = await fecha(tor, dias(5));
    await pagar(f, eqs[0]); await pagar(f, eqs[2]); await pagar(f, eqs[3]); // eqs[1] vs eqs[4]: paga solo uno
    await pagar(f, eqs[1]);
    await vencer(f);
    resumen.push([tor.nombre, 'Sin penalización: Moroso no pagó y NO pierde por W.O.; Al Día ve "tu rival no pagó, decide el organizador". El organizador ve quién no pagó en el fixture.']);
}

// 8. Te toca libre (cantidad impar de equipos)
{
    const { tor } = await torneo('Casos 8 · Te toca libre', { equipos: ['alDia', RIVALES[0], RIVALES[1], RIVALES[2], RIVALES[3]] });
    await fecha(tor, dias(6));
    resumen.push([tor.nombre, 'Al Día tiene fecha LIBRE: no juega ni paga.']);
}

// 11. Partido confirmado: pagaron los dos equipos
{
    const { tor, eqs } = await torneo('Casos 11 · Partido confirmado', { equipos: ['alDia', RIVALES[5], RIVALES[6], RIVALES[1]] });
    const f = await fecha(tor, dias(5));
    await pagar(f, eqs[0]); await pagar(f, eqs[3]);
    resumen.push([tor.nombre, 'Al Día y su rival PAGARON los dos: partido confirmado.']);
}

// 12. Resultados por cargar: la fecha 1 ya se jugó (hace 2 días) y el organizador todavía no cargó los resultados.
//     Uno de los rivales no pagó: su partido quedó 0-3 por W.O. y no admite resultado.
{
    const { tor, eqs } = await torneo('Casos 12 · Resultados por cargar', { reglas: REGLAS.sinAmistosos, equipos: ['alDia', RIVALES[0], RIVALES[3], RIVALES[5], RIVALES[6], RIVALES[7]] });
    const f = await fecha(tor, dias(5));
    for (const eq of eqs.slice(0, 5)) await pagar(f, eq); // el ultimo no paga -> W.O.
    await vencer(f);
    await moverA(f, dias(-2));
    resumen.push([tor.nombre, 'Organizador: la fecha 1 ya se JUGÓ y faltan cargar los RESULTADOS (botón "Cargar resultados" en el fixture). Un partido es W.O. y no se carga.']);
}

// 13. Inscripción cerrada (el organizador la cerró antes del cierre): todavía no empezó y falta crear la fecha 1.
//     Empieza en 5 días; el día de inicio pasa solo a "en curso"
{
    const { tor } = await torneo('Casos 13 · Inscripción cerrada', { estado: 'inscripcion-cerrada', fechaInicio: dias(5), equipos: ['alDia', RIVALES[2], RIVALES[4], RIVALES[6]] });
    resumen.push([tor.nombre, `Organizador: la inscripción está CERRADA y el torneo empieza el ${tor.fechaInicio}. Creá la fecha 1 desde el fixture; el día de inicio arranca solo.`]);
}

// 14. Sin cobro por fecha (todo se paga con la inscripción): la fecha no tiene pago ni vencimiento
{
    const { tor } = await torneo('Casos 14 · Sin cobro por fecha', { precioFecha: 0, equipos: ['alDia', RIVALES[1], RIVALES[3], RIVALES[7]] });
    // Sin cobro no hace falta la anticipacion de 3 dias: se crea directo para pasado mañana
    const f = await fechasManager.crear(await torneosManager.getTorneoById(tor.id), { dia: dias(2), inicio: '18:00', fin: '23:00', canchas: 2 });
    if (f.error) throw new Error(tor.nombre + ': ' + f.error);
    resumen.push([tor.nombre, 'Precio por fecha $0: Al Día ve su próxima fecha SIN pago (ni W.O. ni multa). Las fechas sin cobro se pueden crear con menos anticipación.']);
}

// 9. Inscripción abierta: para inscribirse (Al Día puede; Moroso está bloqueado por la multa; Incompletos no tiene jugadores)
//    y para que el organizador edite las reglas de pago (todavía no empezó)
{
    const { tor } = await torneo('Casos 9 · Inscripción abierta', { estado: 'inscripcion-abierta', reglas: REGLAS.fijo10, equipos: [RIVALES[4], RIVALES[5], RIVALES[6]] });
    resumen.push([tor.nombre, 'Para INSCRIBIRSE (Al Día puede, Moroso bloqueado por multa, Incompletos no llega al mínimo) y para EDITAR las reglas como organizador.']);
}

// 10. Próximamente, sin penalización (otra combinación de reglas para ver en el detalle)
{
    const { tor } = await torneo('Casos 10 · Próximamente', { estado: 'proximamente', reglas: REGLAS.sinPenalizacion, equipos: [] });
    resumen.push([tor.nombre, 'Torneo próximo sin penalización: se ven las reglas en el detalle y se pueden editar.']);
}

// ---------- 7) Resumen ----------
console.log('\n=== Cuentas (contraseña de todas: ' + PASSWORD + ') ===');
console.table(Object.entries(CUENTAS).map(([k, c]) => ({ cuenta: c.email, rol: c.rol, equipo: c.equipo ?? org.nombre })));
console.log('\n=== Torneos de casos ===');
for (const [nombre, que] of resumen) console.log(`- ${nombre}\n    ${que}`);
console.log(`\nDeuda de Deportivo Moroso: $${await multasManager.deudaDeClub(clubes.moroso.id)} | Amistosos publicados: ${(await amistososManager.getPublicados()).filter(a => a.organizadorId === org.id).length}`);

await cerrar();
