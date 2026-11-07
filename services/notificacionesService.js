// Notificaciones por email: qué avisos existen para cada tipo de cuenta y qué eligió cada usuario.
// Es la única fuente de los textos (el front los pide con GET /auth/notificaciones).
// Los mails de seguridad (recuperar contraseña, etc.) no están acá: llegan siempre.
// Antes de mandar un aviso, preguntar quiereMail(usuario, tipo).

export const TIPOS = {
    capitan: [
        { id: 'fechaNueva', titulo: 'Fecha nueva', texto: 'Cuando el organizador arma una fecha de un torneo donde jugás: día, horario, cancha y rival.', porDefecto: true },
        { id: 'recordatorioPago', titulo: 'Recordatorio de pago', texto: 'El día que vence el pago de la fecha, si todavía no pagaste tu parte.', porDefecto: true },
        { id: 'woMultas', titulo: 'W.O. y multas', texto: 'Si un partido tuyo se define por W.O. porque vos o tu rival no pagaron la fecha, o si te llega una multa.', porDefecto: true },
        { id: 'resultados', titulo: 'Resultados', texto: 'Cuando el organizador carga los resultados de una fecha que jugaste.', porDefecto: true },
        { id: 'inscripcion', titulo: 'Inscripciones', texto: 'La confirmación cuando tu equipo queda inscripto y cuando el torneo empieza.', porDefecto: true },
    ],
    organizador: [
        { id: 'equipoInscripto', titulo: 'Equipo inscripto', texto: 'Cada vez que un equipo se inscribe y paga en uno de tus torneos.', porDefecto: true },
        { id: 'pagosVencidos', titulo: 'Pagos de fechas vencidos', texto: 'Cuando algún equipo no pagó una fecha a tiempo.', porDefecto: true },
        { id: 'estadoTorneo', titulo: 'Estado de tus torneos', texto: 'Cuando la inscripción se cierra sola, el torneo empieza o no puede empezar por falta de equipos.', porDefecto: true },
        { id: 'resultadosPendientes', titulo: 'Resultados por cargar', texto: 'Un recordatorio si una fecha ya se jugó y todavía no cargaste los resultados.', porDefecto: true },
    ],
};

export const NOVEDADES = {
    id: 'novedades', titulo: 'Novedades y promociones',
    texto: 'Torneos nuevos, funciones de la app y promociones de Torneos Libres. Pocos mails, y te podés dar de baja cuando quieras.',
};

const tiposDe = (rol) => TIPOS[rol] ?? TIPOS.organizador;

const elegidas = (usuario) => {
    const n = usuario.notificaciones;
    if (!n) return {};
    if (typeof n === 'object') return n;
    try { return JSON.parse(n) ?? {}; } catch { return {}; }
};

// ¿Le mandamos este aviso? (lo que no eligió usa el valor por defecto)
export const quiereMail = (usuario, tipo) => {
    if (tipo === NOVEDADES.id) return !!usuario.novedades;
    const def = tiposDe(usuario.rol).find((t) => t.id === tipo);
    if (!def) return false;
    return elegidas(usuario)[tipo] ?? def.porDefecto;
};

// Lo que ve la cuenta en "Notificaciones": los avisos de su rol con su estado, y las novedades
export const preferenciasDe = (usuario) => ({
    avisos: tiposDe(usuario.rol).map(({ porDefecto, ...t }) => ({ ...t, activa: quiereMail(usuario, t.id) })),
    novedades: { ...NOVEDADES, activa: !!usuario.novedades },
});

// Valida lo que manda el front: { avisos?: { tipo: bool }, novedades?: bool }. Solo tipos del rol y valores si/no.
// Devuelve { notificaciones, novedades? } listo para guardar | { error }
export const limpiarPreferencias = (usuario, body = {}) => {
    const ids = tiposDe(usuario.rol).map((t) => t.id);
    const notificaciones = { ...elegidas(usuario) };

    if (body.avisos !== undefined) {
        if (!body.avisos || typeof body.avisos !== 'object' || Array.isArray(body.avisos)) return { error: 'Preferencias inválidas' };
        for (const [id, valor] of Object.entries(body.avisos)) {
            if (!ids.includes(id)) return { error: 'Ese aviso no existe' };
            if (typeof valor !== 'boolean') return { error: 'Preferencias inválidas' };
            notificaciones[id] = valor;
        }
    }
    // Solo se guardan los tipos que existen (si se saca uno del catálogo, desaparece al guardar)
    for (const id of Object.keys(notificaciones)) if (!ids.includes(id)) delete notificaciones[id];

    if (body.novedades !== undefined && typeof body.novedades !== 'boolean') return { error: 'Preferencias inválidas' };

    return { notificaciones, ...(body.novedades !== undefined ? { novedades: body.novedades } : {}) };
};

// Nombre del aviso (para el pie de los mails y la página de baja). null si no existe
export const tituloDe = (tipo) => (tipo === NOVEDADES.id ? NOVEDADES.titulo
    : Object.values(TIPOS).flat().find((t) => t.id === tipo)?.titulo ?? null);
