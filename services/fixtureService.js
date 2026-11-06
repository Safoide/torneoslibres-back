import { equiposManager, partidosManager } from '../manager/instances.js';
import { tx } from '../db/index.js';

// Fixture "todos contra todos" (metodo del circulo): devuelve la lista de fechas, cada una con sus partidos [local, visita].
// Con cantidad impar de equipos, a uno le toca libre en cada fecha.
export const rondasDe = (equipos) => {
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
        lista.splice(1, 0, lista.pop());
    }

    return rondas;
};

// Recalcula la tabla de posiciones de un torneo a partir de los partidos con resultado.
// W.O. simple: ya tiene el 3-0 cargado y cuenta como cualquier resultado.
// W.O. doble (no pago ninguno): los dos suman un partido perdido, sin goles ni puntos.
export const recalcularTabla = (torId) => tx(async () => {
    const equipos = await equiposManager.getByTorneo(torId);
    const delTorneo = await partidosManager.getByTorneo(torId);
    const jugados = delTorneo.filter(p => p.home_goals !== null && p.away_goals !== null);

    const tabla = new Map(equipos.map(e => [e.id, {
        points: 0, played: 0, wins: 0, draws: 0, losses: 0, goal_difference: 0, goals_for: 0, goals_against: 0,
    }]));

    for (const p of delTorneo.filter(x => x.wo === 'doble')) {
        for (const id of [p.home_id, p.away_id]) {
            const t = tabla.get(id);
            if (t) { t.played++; t.losses++; }
        }
    }

    for (const p of jugados) {
        for (const [id, gf, gc] of [[p.home_id, p.home_goals, p.away_goals], [p.away_id, p.away_goals, p.home_goals]]) {
            const t = tabla.get(id);
            if (!t) continue;

            t.played++; t.goals_for += gf; t.goals_against += gc; t.goal_difference += gf - gc;
            if (gf > gc) { t.wins++; t.points += 3; } else if (gf === gc) { t.draws++; t.points++; } else t.losses++;
        }
    }

    for (const [id, stats] of tabla) await equiposManager.editTeam(id, stats);
});
