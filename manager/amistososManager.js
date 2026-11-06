import fs from 'fs';
import { randomUUID } from 'crypto';
import { byId } from '../assets.js';
import { clubesManager, multasManager } from './instances.js';
import { cobrar } from '../services/pagosService.js';

const MIN_JUGADORES = { f5: 5, f7: 7, f8: 8, f11: 11 };
export const DESCUENTO_AMISTOSO = 0.5; // el amistoso express se publica a mitad de precio de la fecha

// Amistosos express: cuando un equipo no paga su fecha a tiempo pierde por W.O. y su lugar se publica
// como amistoso (misma fecha, hora y cancha) para que el equipo que si pago pueda jugar igual.
class AmistososManager {
    constructor(path) {
        this.path = path;
        if (!fs.existsSync(path)) fs.writeFileSync(path, '[]');
        this.amistosos = JSON.parse(fs.readFileSync(path));
        this.procesando = new Set(); // evita cobrar dos veces si se toca "Pagar" dos veces
    }

    save() {
        return fs.promises.writeFile(this.path, JSON.stringify(this.amistosos, null, 4));
    }

    // Lo que ve cualquiera: sin ids de cuentas ni datos del pago
    publico({ anfitrion, rival, ausenteClubId, pago, ...a }) {
        return {
            ...a,
            anfitrion: { equipoId: anfitrion.equipoId, name: anfitrion.name, logo: anfitrion.logo },
            rival: rival ? { name: rival.name, logo: rival.logo } : null,
        };
    }

    getById(id) {
        return this.amistosos.find(byId(id)) || null;
    }

    getByPartido(partidoId) {
        return this.amistosos.find(a => a.partido_id === partidoId) || null;
    }

    // Publicados que todavia no empezaron, los mas cercanos primero
    getPublicados(ahora = Date.now()) {
        return this.amistosos
            .filter(a => a.estado === 'publicado' && Date.parse(a.date) > ahora)
            .sort((a, b) => a.date.localeCompare(b.date));
    }

    // Amistosos que tomo un club (como rival) y todavia no terminaron
    tomadosPor(clubId, ahora = Date.now()) {
        return this.amistosos
            .filter(a => a.estado === 'tomado' && a.rival?.clubId === clubId && Date.parse(a.date) + 3 * 3600e3 > ahora)
            .sort((a, b) => a.date.localeCompare(b.date));
    }

    // Lo arma el servidor al procesar un vencimiento (nunca viene del cliente)
    async publicar({ tor, fecha, partido, anfitrion, ausente }) {
        if (this.getByPartido(partido.id)) return this.getByPartido(partido.id);

        const nuevo = {
            id: `AMI-${randomUUID().slice(0, 8)}`,
            tor_id: tor.id, fecha_id: fecha.id, partido_id: partido.id,
            date: partido.date, cancha: partido.cancha ?? null,
            torneo: tor.nombre, organizador: tor.organizador, organizadorId: tor.organizadorId,
            modalidad: tor.modalidad, categoria: tor.categoria,
            sede: tor.sede, direccion: tor.direccion, zona: tor.zona, localidad: tor.localidad,
            anfitrion: { equipoId: anfitrion.id, clubId: anfitrion.club_id ?? null, name: anfitrion.name, logo: anfitrion.logo ?? '' },
            ausenteClubId: ausente.club_id ?? null,
            precioOriginal: fecha.precio,
            precio: Math.round(fecha.precio * DESCUENTO_AMISTOSO),
            estado: 'publicado',
            rival: null,
            creado: new Date().toISOString(),
        };

        this.amistosos.push(nuevo);
        await this.save();

        return nuevo;
    }

    // Un capitan toma el amistoso pagando el precio con descuento
    async tomar(id, ownerId, { metodo = 'tarjeta', simular } = {}) {
        const a = this.getById(id);
        if (!a) return { error: 'No encontramos ese amistoso' };
        if (a.estado === 'tomado') return a.rival?.ownerId === ownerId ? this.publico(a) : { error: 'Otro equipo ya tomó este amistoso' };
        if (Date.parse(a.date) <= Date.now()) return { error: 'El amistoso ya empezó' };

        const club = clubesManager.getRawByOwner(ownerId);
        if (!club) return { error: 'Primero tenés que crear tu equipo' };
        if (club.id === a.anfitrion.clubId) return { error: 'Este amistoso es de tu propio equipo: compartí el link para que lo tome otro' };
        if (club.id === a.ausenteClubId) return { error: 'Tu equipo no se presentó a este partido: no puede tomar el amistoso' };
        const bloqueo = multasManager.bloqueo(club.id);
        if (bloqueo) return { error: bloqueo, multasPendientes: true };

        const min = MIN_JUGADORES[a.modalidad] ?? 0;
        if (club.jugadores.length < min) {
            return { error: `Para ${a.modalidad.toUpperCase()} necesitás al menos ${min} jugadores anotados (tenés ${club.jugadores.length})` };
        }

        if (this.procesando.has(id)) return { error: 'Otro equipo está pagando este amistoso en este momento' };
        this.procesando.add(id);

        try {
            const r = await cobrar({ monto: a.precio, metodo: metodo === 'mercadopago' ? 'mercadopago' : 'tarjeta', simular });
            if (!r.ok) return { error: r.motivo };

            a.estado = 'tomado';
            a.rival = { clubId: club.id, ownerId, name: club.nombre, logo: club.logo ?? '' };
            a.pago = { id: r.id, metodo: r.metodo, monto: r.monto, fecha: new Date().toISOString() };
            await this.save();

            return this.publico(a);
        } finally {
            this.procesando.delete(id);
        }
    }
}

export default AmistososManager;
