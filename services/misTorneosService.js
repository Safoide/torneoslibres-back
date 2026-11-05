import { equiposManager, torneosManager, fechasManager } from '../manager/instances.js';

const sumarDias = (iso, dias) => {
    const d = new Date(`${iso}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + dias);
    return d.toISOString().slice(0, 10);
};

// Posiciones: puntos, diferencia de gol y goles a favor (igual que la tabla del torneo)
const ordenar = (equipos) => [...equipos].sort((a, b) =>
    b.points - a.points || b.goal_difference - a.goal_difference || b.goals_for - a.goals_for);

// Todos los torneos donde esta anotado un equipo, ya ordenados:
// 1) en curso, los que terminan antes primero  2) proximos a empezar, los que empiezan antes primero  3) finalizados, los mas recientes primero
export const torneosDeClub = (clubId) => {
    const items = [];

    for (const eq of equiposManager.getEquipos().filter(e => e.club_id === clubId)) {
        const tor = torneosManager.getTorneoById(eq.tor_id);
        if (tor.error) continue;

        const empezado = tor.estado === 'en-curso' || tor.estado === 'finalizado';
        const equiposTor = equiposManager.getEquipos().filter(e => e.tor_id === tor.id);
        const n = equiposTor.length;
        const fechasTotales = n < 2 ? 0 : n % 2 ? n : n - 1; // todos contra todos, una rueda
        const fechas = fechasManager.getByTorneo(tor.id); // de la mas nueva a la mas vieja
        const ultimoDia = fechas[0]?.dia ?? tor.fechaInicio;
        const faltan = Math.max(fechasTotales - fechas.length, 0);

        items.push({
            equipoId: eq.id,
            torneo: {
                id: tor.id, nombre: tor.nombre, modalidad: tor.modalidad, categoria: tor.categoria, estado: tor.estado,
                fechaInicio: tor.fechaInicio, diaJuego: tor.diaJuego, zona: tor.zona, sede: tor.sede,
                organizador: tor.organizador, organizadorId: tor.organizadorId,
            },
            tabla: empezado ? {
                posicion: ordenar(equiposTor).findIndex(e => e.id === eq.id) + 1, equipos: n,
                puntos: eq.points, jugados: eq.played, ganados: eq.wins, empatados: eq.draws, perdidos: eq.losses,
                golesFavor: eq.goals_for, golesContra: eq.goals_against,
            } : null,
            fechasJugadas: fechas.filter(f => f.estado === 'jugada').length,
            fechasTotales,
            // Estimado: la ultima fecha creada + una por semana por cada fecha que falta
            fin: tor.estado === 'en-curso' ? sumarDias(ultimoDia, 7 * faltan) : tor.estado === 'finalizado' ? ultimoDia : null,
        });
    }

    const grupo = (t) => t.estado === 'en-curso' ? 0 : t.estado === 'finalizado' ? 2 : 1;

    return items.sort((a, b) => grupo(a.torneo) - grupo(b.torneo)
        || (grupo(a.torneo) === 0 ? a.fin.localeCompare(b.fin) : 0)
        || (grupo(a.torneo) === 1 ? a.torneo.fechaInicio.localeCompare(b.torneo.fechaInicio) : 0)
        || (grupo(a.torneo) === 2 ? b.fin.localeCompare(a.fin) : 0)
        || a.torneo.nombre.localeCompare(b.torneo.nombre));
};
