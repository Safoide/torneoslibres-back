import { torneosManager, equiposManager, fechasManager, partidosManager, inscripcionesManager } from '../manager/instances.js';

const MESES = 6; // cuantos meses muestra el grafico de ingresos

const hoyAR = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date());

// "2026-11" de los ultimos n meses, del mas viejo al actual
const ultimosMeses = (n) => {
    const [y, m] = hoyAR().split('-').map(Number);
    return Array.from({ length: n }, (_, i) => {
        const d = new Date(Date.UTC(y, m - 1 - (n - 1 - i), 1));
        return d.toISOString().slice(0, 7);
    });
};

const jugado = (p) => p.home_goals !== null && p.home_goals !== undefined && p.away_goals !== null && p.away_goals !== undefined;

// Todos contra todos a una rueda: n-1 fechas si es par, n si es impar (a uno le toca libre)
const fechasDelFixture = (n) => (n < 2 ? 0 : n % 2 ? n : n - 1);
const equiposPorFecha = (n) => (n % 2 ? n - 1 : n);

// Panel del organizador: numeros de todos los torneos de su organizacion.
// La plata es la que corresponde segun los precios (los pagos son simulados): inscripcion por equipo
// y precio de la fecha por cada equipo que juega esa fecha.
export const dashboardDe = (orgId) => {
    const hoy = hoyAR();
    const meses = ultimosMeses(MESES);
    const porMes = Object.fromEntries(meses.map(m => [m, 0]));
    const sumarMes = (dia, monto) => { const m = dia.slice(0, 7); if (m in porMes) porMes[m] += monto; };

    const confirmadas = new Map(inscripcionesManager.inscripciones
        .filter(i => i.estado === 'confirmada' && i.equipoId)
        .map(i => [i.equipoId, i]));

    const totales = {
        torneos: 0, porEstado: { 'inscripcion-abierta': 0, proximamente: 0, 'en-curso': 0, finalizado: 0 },
        equipos: 0, cupos: 0, fechasJugadas: 0, partidosJugados: 0, partidosProgramados: 0, goles: 0, resultadosPendientes: 0,
    };
    const dinero = { inscripciones: 0, fechas: 0, porCobrar: 0, restante: 0 };
    const proximas = [];
    const torneos = [];

    for (const tor of torneosManager.getTorneos().filter(t => t.organizadorId === orgId)) {
        const equipos = equiposManager.getEquipos().filter(e => e.tor_id === tor.id);
        const partidos = partidosManager.getPartidos().filter(p => p.tor_id === tor.id);
        const fechas = fechasManager.getByTorneo(tor.id); // de la mas nueva a la mas vieja, con estado
        const n = equipos.length;

        totales.torneos++;
        totales.porEstado[tor.estado] = (totales.porEstado[tor.estado] ?? 0) + 1;
        totales.equipos += n;
        if (tor.estado === 'inscripcion-abierta') totales.cupos += Math.max(tor.equiposMax - tor.equiposInscriptos, 0);

        // Inscripciones: el monto realmente cobrado si hay registro; si no (datos cargados a mano), el precio del torneo
        let ingInscripciones = 0;
        for (const eq of equipos) {
            const insc = confirmadas.get(eq.id);
            const monto = insc?.pago?.monto ?? insc?.monto ?? tor.precioInscripcion ?? 0;
            ingInscripciones += monto;
            const dia = insc?.pago?.fecha?.slice(0, 10) ?? (tor.fechaInicio < hoy ? tor.fechaInicio : hoy);
            sumarMes(dia, monto);
        }

        // Fechas: precio por cada equipo que juega (al que le toca libre no se le cobra)
        let ingFechas = 0, porCobrar = 0, pendientes = 0;
        for (const f of fechas) {
            const deLaFecha = partidos.filter(p => p.fecha === f.numero);
            const monto = (f.precio ?? 0) * deLaFecha.length * 2;

            if (f.estado === 'jugada') {
                ingFechas += monto;
                sumarMes(f.dia, monto);
                totales.fechasJugadas++;
                pendientes += deLaFecha.filter(p => !jugado(p)).length;
            } else {
                porCobrar += monto;
                proximas.push({
                    torneo: { id: tor.id, nombre: tor.nombre, modalidad: tor.modalidad },
                    fecha: { id: f.id, numero: f.numero, dia: f.dia, inicio: f.inicio, fin: f.fin, canchas: f.canchas, estado: f.estado },
                    partidos: deLaFecha.length,
                });
            }
        }

        // Lo que falta programar del fixture en los torneos en curso
        const fechasTotales = fechasDelFixture(n);
        const faltan = tor.estado === 'en-curso' ? Math.max(fechasTotales - fechas.length, 0) : 0;
        const restante = faltan * equiposPorFecha(n) * (tor.precioFecha ?? 0);

        const jugados = partidos.filter(jugado);
        const goles = jugados.reduce((s, p) => s + p.home_goals + p.away_goals, 0);

        totales.partidosJugados += jugados.length;
        totales.partidosProgramados += partidos.length - jugados.length;
        totales.goles += goles;
        totales.resultadosPendientes += pendientes;

        dinero.inscripciones += ingInscripciones;
        dinero.fechas += ingFechas;
        dinero.porCobrar += porCobrar;
        dinero.restante += restante;

        torneos.push({
            id: tor.id, nombre: tor.nombre, modalidad: tor.modalidad, categoria: tor.categoria, estado: tor.estado,
            fechaInicio: tor.fechaInicio, diaJuego: tor.diaJuego, zona: tor.zona,
            equipos: n, equiposMax: tor.equiposMax,
            fechasCreadas: fechas.length, fechasJugadas: fechas.filter(f => f.estado === 'jugada').length, fechasTotales,
            partidosJugados: jugados.length, goles,
            resultadosPendientes: pendientes,
            ingresos: ingInscripciones + ingFechas, inscripciones: ingInscripciones, fechas: ingFechas,
        });
    }

    const orden = { 'en-curso': 0, 'inscripcion-abierta': 1, proximamente: 2, finalizado: 3 };
    torneos.sort((a, b) => (orden[a.estado] ?? 9) - (orden[b.estado] ?? 9) || a.fechaInicio.localeCompare(b.fechaInicio));

    return {
        totales: { ...totales, promedioGoles: totales.partidosJugados ? +(totales.goles / totales.partidosJugados).toFixed(2) : 0 },
        dinero: { ...dinero, cobrado: dinero.inscripciones + dinero.fechas },
        porMes: meses.map(mes => ({ mes, monto: porMes[mes] })),
        proximasFechas: proximas.sort((a, b) => a.fecha.dia.localeCompare(b.fecha.dia) || a.fecha.inicio.localeCompare(b.fecha.inicio)).slice(0, 5),
        torneos,
    };
};
