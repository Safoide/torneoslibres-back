// Conversión entre filas de la base y los objetos que usa la API (los mismos que había en los JSON).
// Por tabla: columnas, cuáles guardan un objeto como texto JSON y cuáles son si/no (0/1).

const T = {
    usuarios: { cols: ['id', 'nombre', 'email', 'passwordHash', 'rol', 'creado', 'tokenVersion', 'googleId', 'emailVerificado', 'notificaciones', 'novedades', 'novedadesFecha'], json: ['notificaciones'], bool: ['emailVerificado', 'novedades'] },
    organizadores: { cols: ['id', 'nombre', 'zona', 'descripcion', 'instagram', 'whatsapp', 'logo', 'ownerId', 'creada'] },
    clubes: { cols: ['id', 'nombre', 'logo', 'whatsapp', 'ownerId', 'creado'] },
    club_jugadores: { cols: ['clubId', 'orden', 'nombre', 'apellido', 'dni', 'nacimiento'] },
    torneos: {
        cols: ['id', 'nombre', 'organizador', 'organizadorId', 'modalidad', 'categoria', 'zona', 'localidad', 'sede', 'direccion',
            'fechaInicio', 'diaJuego', 'horario', 'formato', 'equiposMax', 'equiposInscriptos', 'precioInscripcion', 'precioFecha',
            'estado', 'whatsapp', 'descripcion', 'reglasPago', 'limiteEdad', 'cierreInscripcion', 'avisoSinEquipos'],
        json: ['reglasPago', 'limiteEdad'],
    },
    equipos: { cols: ['id', 'name', 'logo', 'club_id', 'tor_id', 'points', 'played', 'wins', 'draws', 'losses', 'goal_difference', 'goals_for', 'goals_against'] },
    jugadores: { cols: ['id', 'full_name', 'tor_id', 'team_id', 'played', 'goals', 'yellow_cards', 'red_cards', 'mvp'] },
    fechas: {
        cols: ['id', 'tor_id', 'numero', 'dia', 'inicio', 'fin', 'canchas', 'precio', 'creada', 'cobro', 'vencePago', 'reglas', 'pagosProcesados', 'avisoResultados'],
        json: ['reglas'], bool: ['cobro', 'pagosProcesados'],
    },
    fecha_pagos: { cols: ['fechaId', 'equipoId', 'orden', 'estado', 'monto', 'pago', 'recordado'], json: ['pago'] },
    partidos: { cols: ['id', 'tor_id', 'fecha', 'home_id', 'away_id', 'date', 'cancha', 'home_goals', 'away_goals', 'wo'] },
    inscripciones: { cols: ['id', 'torId', 'clubId', 'ownerId', 'equipo', 'monto', 'estado', 'creada', 'equipoId', 'pago'], json: ['equipo', 'pago'] },
    multas: {
        cols: ['id', 'clubId', 'equipoId', 'equipo', 'tor_id', 'torneo', 'organizadorId', 'fecha_id', 'fecha', 'monto', 'estado', 'creada', 'pago'],
        json: ['pago'],
    },
    saldos: { cols: ['id', 'equipoId', 'tor_id', 'monto', 'motivo', 'fechaNumero', 'creado'] },
    devoluciones: { cols: ['id', 'equipoId', 'tor_id', 'monto', 'estado', 'creada', 'devuelta'] },
    amistosos: {
        cols: ['id', 'tor_id', 'fecha_id', 'partido_id', 'date', 'cancha', 'torneo', 'organizador', 'organizadorId', 'modalidad', 'categoria',
            'sede', 'direccion', 'zona', 'localidad', 'anfitrion', 'ausenteClubId', 'precioOriginal', 'precio', 'estado', 'rival', 'pago', 'creado'],
        json: ['anfitrion', 'rival', 'pago'],
    },
};

export const TABLAS = Object.keys(T);

// Objeto -> fila: solo las columnas de la tabla (nunca se guarda un campo de mas) y objetos a texto JSON.
// Las claves que no vienen no se tocan (sirve para updates parciales).
export const aFila = (tabla, obj) => {
    const { cols, json = [], bool = [] } = T[tabla];
    const fila = {};
    for (const c of cols) {
        if (obj[c] === undefined) continue;
        const v = obj[c];
        fila[c] = json.includes(c) ? (v === null ? null : JSON.stringify(v))
            : bool.includes(c) ? (v ? 1 : 0)
            : v;
    }
    return fila;
};

// Fila -> objeto
export const deFila = (tabla, fila) => {
    if (!fila) return fila;
    const { json = [], bool = [] } = T[tabla];
    const obj = { ...fila };
    for (const c of json) if (typeof obj[c] === 'string') obj[c] = JSON.parse(obj[c]);
    for (const c of bool) if (c in obj) obj[c] = !!obj[c];
    return obj;
};

export const deFilas = (tabla, filas) => filas.map((f) => deFila(tabla, f));
