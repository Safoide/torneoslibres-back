import fs from 'fs';
import { randomUUID } from 'crypto';
import { byId } from '../assets.js';
import { torneosManager, equiposManager, clubesManager, multasManager } from './instances.js';
import { cobrar } from '../services/pagosService.js';
import { fueraDeEdad, errorEdad } from './torneosManager.js';

const MIN_JUGADORES = { f5: 5, f7: 7, f8: 8, f11: 11 };

class InscripcionesManager {
    constructor(path) {
        this.path = path;
        this.inscripciones = JSON.parse(fs.readFileSync(path));
        this.procesando = new Set(); // evita cobrar dos veces si se toca "Pagar" dos veces
        // Cupos reservados por pagos en curso (torId -> cantidad): el cobro tarda, y sin esto
        // dos equipos que pagan el último cupo a la vez entrarían los dos
        this.reservas = new Map();
    }

    reservados(torId) {
        return this.reservas.get(torId) ?? 0;
    }

    reservar(torId, delta) {
        const n = this.reservados(torId) + delta;
        n > 0 ? this.reservas.set(torId, n) : this.reservas.delete(torId);
    }

    save() {
        return fs.promises.writeFile(this.path, JSON.stringify(this.inscripciones, null, 4));
    }

    getInscripcionById(id) {
        return this.inscripciones.find(byId(id)) || { error: 'No se encontro la inscripcion' };
    }

    // Paso 1: crea la inscripcion "pendiente-pago" con el equipo del capitan
    async crear(ownerId, { torId } = {}) {
        const tor = torneosManager.getTorneoById(torId);
        if (tor.error) return tor;

        if (tor.estado !== 'inscripcion-abierta') return { error: 'El torneo no tiene la inscripción abierta' };
        if (tor.equiposInscriptos >= tor.equiposMax) return { error: 'No quedan cupos disponibles' };

        const club = clubesManager.getRawByOwner(ownerId);
        if (!club) return { error: 'Primero tenés que crear tu equipo' };

        const bloqueo = multasManager.bloqueo(club.id); // con multas pendientes no puede inscribirse
        if (bloqueo) return { error: bloqueo, multasPendientes: true };

        const min = MIN_JUGADORES[tor.modalidad] ?? 0;
        if (club.jugadores.length < min) {
            return { error: `Para ${tor.modalidad.toUpperCase()} necesitás al menos ${min} jugadores anotados (tenés ${club.jugadores.length})` };
        }

        // Torneo con limite de edad: todo el plantel tiene que cumplirlo
        const fuera = fueraDeEdad(club.jugadores, tor);
        if (fuera.length) return { error: errorEdad(fuera, tor.limiteEdad), limiteEdad: true };

        const yaEsta = equiposManager.getEquipos().some(e =>
            e.tor_id === torId && (e.club_id === club.id || e.name.toLowerCase() === club.nombre.toLowerCase()));
        if (yaEsta) return { error: 'Tu equipo ya está inscripto en este torneo (o hay otro con el mismo nombre)' };

        // Si recarga la pagina, reutilizamos la inscripcion pendiente en vez de duplicarla
        const pendiente = this.inscripciones.find(i => i.torId === torId && i.clubId === club.id && i.estado === 'pendiente-pago');
        if (pendiente) return pendiente;

        const nueva = {
            id: `INS-${randomUUID().slice(0, 8)}`, // aleatorio: no se puede adivinar
            torId,
            clubId: club.id,
            ownerId,
            equipo: { name: club.nombre },
            monto: tor.precioInscripcion, // lo define el servidor, no el cliente
            estado: 'pendiente-pago',
            creada: new Date().toISOString(),
        };

        this.inscripciones.push(nueva);
        await this.save();

        return nueva;
    }

    // Paso 2: cobra y, si sale bien, anota al equipo en el torneo y descuenta un cupo
    async pagar(id, { metodo = 'tarjeta', simular } = {}) {
        const insc = this.inscripciones.find(byId(id));
        if (!insc) return { error: 'No se encontro la inscripcion' };

        if (insc.estado === 'confirmada') return insc; // ya pagada: no se cobra de nuevo
        if (this.procesando.has(id)) return { error: 'El pago ya se está procesando' };

        this.procesando.add(id);
        let reservado = false;

        try {
            const tor = torneosManager.getTorneoById(insc.torId);
            if (tor.error) return tor;

            if (tor.estado !== 'inscripcion-abierta' || tor.equiposInscriptos >= tor.equiposMax) {
                return { error: 'Se agotaron los cupos o cerró la inscripción' };
            }
            if (tor.equiposInscriptos + this.reservados(tor.id) >= tor.equiposMax) {
                return { error: 'Otro equipo está pagando el último cupo en este momento. Probá de nuevo en unos segundos.' };
            }

            const club = clubesManager.getRawByOwner(insc.ownerId);
            if (!club || club.id !== insc.clubId) return { error: 'No encontramos tu equipo' };

            const bloqueo = multasManager.bloqueo(club.id);
            if (bloqueo) return { error: bloqueo, multasPendientes: true };

            // Por si cambio el plantel entre el paso 1 y el pago
            const fuera = fueraDeEdad(club.jugadores, tor);
            if (fuera.length) return { error: errorEdad(fuera, tor.limiteEdad), limiteEdad: true };

            // Desde aca hasta anotar al equipo no hay ningun await antes de reservar: nadie mas puede tomar este cupo
            this.reservar(tor.id, 1);
            reservado = true;

            const pago = await cobrar({ monto: insc.monto, metodo: metodo === 'mercadopago' ? 'mercadopago' : 'tarjeta', simular });
            if (!pago.ok) return { error: pago.motivo };

            const equipo = await equiposManager.addTeam({
                name: club.nombre, logo: club.logo, club_id: club.id, tor_id: insc.torId,
                points: 0, played: 0, wins: 0, draws: 0, losses: 0,
                goal_difference: 0, goals_for: 0, goals_against: 0,
            });

            // Se lee el valor actual (no el de antes del cobro) por si otro equipo se anoto mientras tanto
            const actual = torneosManager.getTorneoById(tor.id);
            await torneosManager.editTor(tor.id, { equiposInscriptos: actual.equiposInscriptos + 1 });

            insc.estado = 'confirmada';
            insc.equipoId = equipo.id;
            insc.pago = { id: pago.id, metodo: pago.metodo, monto: pago.monto, fecha: new Date().toISOString() };
            await this.save();

            return insc;
        } finally {
            if (reservado) this.reservar(insc.torId, -1);
            this.procesando.delete(id);
        }
    }
}

export default InscripcionesManager;