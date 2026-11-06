import { randomUUID } from 'crypto';
import { q, tx } from '../db/index.js';
import { aFila, deFila, deFilas } from '../db/filas.js';
import { torneosManager, equiposManager, clubesManager, multasManager } from './instances.js';
import { cobrar } from '../services/pagosService.js';
import { fueraDeEdad, errorEdad, inscripcionAbierta, cierreDe } from './torneosManager.js';

// Por que no se puede inscribir (el estado o la fecha de cierre, aunque el cierre automatico todavia no haya corrido)
const errorInscripcion = (tor) => tor.estado === 'inscripcion-abierta'
    ? { error: `Las inscripciones cerraron el ${cierreDe(tor)}` }
    : { error: 'El torneo no tiene la inscripción abierta' };

const MIN_JUGADORES = { f5: 5, f7: 7, f8: 8, f11: 11 };
const AGOTADO = { error: 'Se agotaron los cupos o cerró la inscripción' };

class InscripcionesManager {
    constructor() {
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

    async getInscripcionById(id) {
        const fila = await q().selectFrom('inscripciones').selectAll().where('id', '=', String(id ?? '')).executeTakeFirst();
        return fila ? deFila('inscripciones', fila) : { error: 'No se encontro la inscripcion' };
    }

    // Inscripciones confirmadas de varios torneos (panel del organizador)
    async confirmadasDeTorneos(torIds) {
        if (!torIds.length) return [];
        return deFilas('inscripciones', await q().selectFrom('inscripciones').selectAll()
            .where('torId', 'in', torIds).where('estado', '=', 'confirmada').execute());
    }

    // Paso 1: crea la inscripcion "pendiente-pago" con el equipo del capitan
    async crear(ownerId, { torId } = {}) {
        const tor = await torneosManager.getTorneoById(torId);
        if (tor.error) return tor;

        if (!inscripcionAbierta(tor)) return errorInscripcion(tor);
        if (tor.equiposInscriptos >= tor.equiposMax) return { error: 'No quedan cupos disponibles' };

        const club = await clubesManager.getRawByOwner(ownerId);
        if (!club) return { error: 'Primero tenés que crear tu equipo' };

        const bloqueo = await multasManager.bloqueo(club.id); // con multas pendientes no puede inscribirse
        if (bloqueo) return { error: bloqueo, multasPendientes: true };

        const min = MIN_JUGADORES[tor.modalidad] ?? 0;
        if (club.jugadores.length < min) {
            return { error: `Para ${tor.modalidad.toUpperCase()} necesitás al menos ${min} jugadores anotados (tenés ${club.jugadores.length})` };
        }

        // Torneo con limite de edad: todo el plantel tiene que cumplirlo
        const fuera = fueraDeEdad(club.jugadores, tor);
        if (fuera.length) return { error: errorEdad(fuera, tor.limiteEdad), limiteEdad: true };

        const yaEsta = (await equiposManager.getByTorneo(tor.id)).some(e =>
            e.club_id === club.id || e.name.toLowerCase() === club.nombre.toLowerCase());
        if (yaEsta) return { error: 'Tu equipo ya está inscripto en este torneo (o hay otro con el mismo nombre)' };

        return tx(async () => {
            // Si recarga la pagina, reutilizamos la inscripcion pendiente en vez de duplicarla
            const pendiente = await q().selectFrom('inscripciones').selectAll()
                .where('torId', '=', tor.id).where('clubId', '=', club.id).where('estado', '=', 'pendiente-pago').executeTakeFirst();
            if (pendiente) return deFila('inscripciones', pendiente);

            const nueva = {
                id: `INS-${randomUUID().slice(0, 8)}`, // aleatorio: no se puede adivinar
                torId: tor.id,
                clubId: club.id,
                ownerId,
                equipo: { name: club.nombre },
                monto: tor.precioInscripcion, // lo define el servidor, no el cliente
                estado: 'pendiente-pago',
                creada: new Date().toISOString(),
            };

            await q().insertInto('inscripciones').values(aFila('inscripciones', nueva)).execute();
            return this.getInscripcionById(nueva.id);
        });
    }

    // Paso 2: cobra y, si sale bien, anota al equipo en el torneo y descuenta un cupo
    async pagar(id, { metodo = 'tarjeta', simular } = {}) {
        const insc = await this.getInscripcionById(id);
        if (insc.error) return insc;

        if (insc.estado === 'confirmada') return insc; // ya pagada: no se cobra de nuevo
        if (this.procesando.has(id)) return { error: 'El pago ya se está procesando' };

        this.procesando.add(id);
        let reservado = false;

        try {
            const tor = await torneosManager.getTorneoById(insc.torId);
            if (tor.error) return tor;

            // Si empezo a pagar antes del cierre se le respeta: el cierre automatico espera a que termine (ver estadosService)
            if (!inscripcionAbierta(tor)) return errorInscripcion(tor);
            if (tor.equiposInscriptos >= tor.equiposMax) return AGOTADO;

            const club = await clubesManager.getRawByOwner(insc.ownerId);
            if (!club || club.id !== insc.clubId) return { error: 'No encontramos tu equipo' };

            const bloqueo = await multasManager.bloqueo(club.id);
            if (bloqueo) return { error: bloqueo, multasPendientes: true };

            // Por si cambio el plantel entre el paso 1 y el pago
            const fuera = fueraDeEdad(club.jugadores, tor);
            if (fuera.length) return { error: errorEdad(fuera, tor.limiteEdad), limiteEdad: true };

            // Reserva del cupo mientras dura el cobro. Se vuelve a leer el torneo justo antes, sin await en el medio
            const ahora = await torneosManager.getTorneoById(tor.id);
            if (ahora.equiposInscriptos + this.reservados(tor.id) >= ahora.equiposMax) {
                return { error: 'Otro equipo está pagando el último cupo en este momento. Probá de nuevo en unos segundos.' };
            }
            this.reservar(tor.id, 1);
            reservado = true;

            const pago = await cobrar({ monto: insc.monto, metodo: metodo === 'mercadopago' ? 'mercadopago' : 'tarjeta', simular });
            if (!pago.ok) return { error: pago.motivo };

            // Equipo, cupo e inscripcion: todo o nada
            const confirmada = await tx(async () => {
                // Por si el organizador cerro la inscripcion mientras se cobraba (con una pasarela real, aca va la devolucion)
                if (!await torneosManager.sumarInscripto(tor.id)) return null;

                const equipo = await equiposManager.addTeam({
                    name: club.nombre, logo: club.logo, club_id: club.id, tor_id: insc.torId,
                    points: 0, played: 0, wins: 0, draws: 0, losses: 0,
                    goal_difference: 0, goals_for: 0, goals_against: 0,
                });

                await q().updateTable('inscripciones').set(aFila('inscripciones', {
                    estado: 'confirmada',
                    equipoId: equipo.id,
                    pago: { id: pago.id, metodo: pago.metodo, monto: pago.monto, fecha: new Date().toISOString() },
                })).where('id', '=', id).execute();

                return this.getInscripcionById(id);
            });

            return confirmada ?? AGOTADO;
        } finally {
            if (reservado) this.reservar(insc.torId, -1);
            this.procesando.delete(id);
        }
    }
}

export default InscripcionesManager;
