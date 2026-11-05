import fs from 'fs';
import { byId, formatId } from '../assets.js';
import { rondasDe } from '../services/fixtureService.js';

const DURACION = { f5: 40, f7: 50, f8: 60, f11: 90 }; // minutos por partido
const HORA_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const AR = '-03:00'; // Argentina no usa horario de verano

const minutos = (hhmm) => parseInt(hhmm.slice(0, 2), 10) * 60 + parseInt(hhmm.slice(3), 10);
const aMs = (dia, hhmm) => new Date(`${dia}T${hhmm}:00${AR}`).getTime();
// ms -> "2026-11-07T16:00:00-03:00"
const aIso = (ms) => new Date(ms - 3 * 3600e3).toISOString().slice(0, 19) + AR;
const hoyAR = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date());

class FechasManager {
    constructor(path, equiposManager, partidosManager) {
        this.path = path;
        this.equiposManager = equiposManager;
        this.partidosManager = partidosManager;
        if (!fs.existsSync(path)) fs.writeFileSync(path, '[]');
        this.fechas = JSON.parse(fs.readFileSync(path));
    }

    save() {
        return fs.promises.writeFile(this.path, JSON.stringify(this.fechas, null, 4));
    }

    // Inicio y fin reales (el fin puede ser pasada la medianoche: "20:00" a "00:00")
    rango(f) {
        const ini = aMs(f.dia, f.inicio);
        let fin = aMs(f.dia, f.fin);
        if (fin <= ini) fin += 24 * 3600e3;
        return { ini, fin };
    }

    // programada | en-juego | jugada
    publico(f, ahora = Date.now()) {
        const { ini, fin } = this.rango(f);
        return { ...f, estado: ahora < ini ? 'programada' : ahora < fin ? 'en-juego' : 'jugada' };
    }

    getByTorneo(torId) {
        return this.fechas.filter(f => f.tor_id === torId)
            .sort((a, b) => b.numero - a.numero)
            .map(f => this.publico(f));
    }

    getById(id) {
        return this.fechas.find(byId(id)) || null;
    }

    async crear(tor, data = {}) {
        if (tor.estado !== 'en-curso') return { error: 'Solo se pueden crear fechas en torneos en curso. Primero pasá el torneo a "En curso".' };

        const dia = String(data.dia ?? '').trim();
        const inicio = String(data.inicio ?? '').trim();
        const fin = String(data.fin ?? '').trim();
        const canchas = Number(data.canchas ?? 2);

        const d = new Date(`${dia}T00:00:00Z`);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dia) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== dia) return { error: 'El día no es válido' };
        if (dia < hoyAR()) return { error: 'El día no puede ser anterior a hoy' };
        if (!HORA_RE.test(inicio) || !HORA_RE.test(fin)) return { error: 'Elegí un horario de inicio y de finalización válidos' };
        if (inicio === fin) return { error: 'El horario de inicio y de finalización no pueden ser iguales' };
        if (!Number.isInteger(canchas) || canchas < 1 || canchas > 8) return { error: 'La cantidad de canchas debe ser entre 1 y 8' };

        const previas = this.fechas.filter(f => f.tor_id === tor.id);
        const ultima = previas.reduce((a, f) => (f.numero > (a?.numero ?? 0) ? f : a), null);
        if (ultima && dia <= ultima.dia) return { error: `El día tiene que ser posterior al de la fecha ${ultima.numero} (${ultima.dia})` };

        const numero = (ultima?.numero ?? 0) + 1;
        const equipos = this.equiposManager.getEquipos().filter(e => e.tor_id === tor.id);
        if (equipos.length < 2) return { error: 'El torneo necesita al menos 2 equipos para armar una fecha' };

        const rondas = rondasDe(equipos);
        if (numero > rondas.length) return { error: `Ya se programaron las ${rondas.length} fechas del fixture (todos contra todos)` };

        const partidos = rondas[numero - 1];
        const dur = DURACION[tor.modalidad] ?? 50;
        const { ini, fin: finMs } = this.rango({ dia, inicio, fin });
        const ventana = (finMs - ini) / 60000;
        const turnos = Math.ceil(partidos.length / canchas);

        if (turnos * dur > ventana) {
            const necesarios = turnos * dur;
            return { error: `No entran ${partidos.length} partidos de ${dur} min con ${canchas} ${canchas === 1 ? 'cancha' : 'canchas'} en ${ventana} min. Ampliá el horario (necesitás ${necesarios} min) o sumá canchas.` };
        }

        const fecha = {
            id: formatId('FECHA', this.fechas.reduce((m, f) => Math.max(m, parseInt(f.id.split('-')[1], 10) || 0), 0) + 1),
            tor_id: tor.id, numero, dia, inicio, fin, canchas, precio: tor.precioFecha, creada: new Date().toISOString(),
        };

        await this.partidosManager.addMatches(partidos.map(([local, visita], i) => ({
            tor_id: tor.id, fecha: numero, home_id: local.id, away_id: visita.id,
            date: aIso(ini + Math.floor(i / canchas) * dur * 60000), cancha: (i % canchas) + 1,
            home_goals: null, away_goals: null,
        })));

        this.fechas.push(fecha);
        await this.save();

        return this.publico(fecha);
    }

    // Solo se puede cancelar la ultima fecha y antes de que empiece
    async eliminar(id) {
        const f = this.getById(id);
        if (!f) return { error: 'No se encontró la fecha' };

        if (this.fechas.some(x => x.tor_id === f.tor_id && x.numero > f.numero)) return { error: 'Solo se puede cancelar la última fecha creada' };
        if (this.publico(f).estado !== 'programada') return { error: 'La fecha ya empezó: no se puede cancelar' };

        await this.partidosManager.deleteByFecha(f.tor_id, f.numero);
        this.fechas = this.fechas.filter(x => x.id !== id);
        await this.save();

        return { ok: true };
    }

    // "Tu proxima fecha" del capitan: por cada torneo en curso donde esta su equipo, la fecha mas cercana que todavia no termino
    proximasDeClub(clubId, torneosManager) {
        const ahora = Date.now();
        const salida = [];

        for (const eq of this.equiposManager.getEquipos().filter(e => e.club_id === clubId)) {
            const tor = torneosManager.getTorneoById(eq.tor_id);
            if (tor.error || tor.estado !== 'en-curso') continue;

            const f = this.fechas
                .filter(x => x.tor_id === tor.id && this.rango(x).fin > ahora)
                .sort((a, b) => a.numero - b.numero)[0];
            if (!f) continue;

            const p = this.partidosManager.getPartidos().find(x => x.tor_id === tor.id && x.fecha === f.numero && (x.home_id === eq.id || x.away_id === eq.id));
            const rivalId = p ? (p.home_id === eq.id ? p.away_id : p.home_id) : null;
            const rival = rivalId ? this.equiposManager.getEquipoById(rivalId) : null;

            salida.push({
                torneo: { id: tor.id, nombre: tor.nombre, modalidad: tor.modalidad, sede: tor.sede, direccion: tor.direccion, zona: tor.zona, organizador: tor.organizador, organizadorId: tor.organizadorId },
                fecha: this.publico(f, ahora),
                equipo: { id: eq.id, name: eq.name },
                partido: p ? { id: p.id, date: p.date, cancha: p.cancha ?? null, local: p.home_id === eq.id, rival: { id: rival.id, name: rival.name, logo: rival.logo } } : null, // null = te toca libre
            });
        }

        return salida.sort((a, b) => this.rango(a.fecha).ini - this.rango(b.fecha).ini);
    }
}

export default FechasManager;
