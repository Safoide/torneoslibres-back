import fs from 'fs';
import { randomUUID } from 'crypto';
import { cobrar } from '../services/pagosService.js';

// Multas por no pagar una fecha a tiempo (si el torneo tiene la penalizacion activada).
// Quedan como deuda del equipo (club del capitan): hasta saldarla no puede pagar fechas,
// inscribirse en torneos ni tomar amistosos.
class MultasManager {
    constructor(path) {
        this.path = path;
        if (!fs.existsSync(path)) fs.writeFileSync(path, '[]');
        this.multas = JSON.parse(fs.readFileSync(path));
        this.procesando = new Set(); // evita cobrar dos veces si se toca "Pagar" dos veces
    }

    save() {
        return fs.promises.writeFile(this.path, JSON.stringify(this.multas, null, 4));
    }

    publico({ pago, ...m }) {
        return { ...m, pagada: pago ? { fecha: pago.fecha, monto: pago.monto } : null };
    }

    // La crea el servidor al procesar un vencimiento (nunca viene del cliente)
    async crear({ tor, fecha, equipo, monto }) {
        if (!monto || monto <= 0) return null;
        if (this.multas.some(m => m.fecha_id === fecha.id && m.equipoId === equipo.id)) return null; // ya existe

        const nueva = {
            id: `MUL-${randomUUID().slice(0, 8)}`,
            clubId: equipo.club_id ?? null, // los equipos de prueba sin capitan no tienen club: la multa queda registrada igual
            equipoId: equipo.id, equipo: equipo.name,
            tor_id: tor.id, torneo: tor.nombre, organizadorId: tor.organizadorId,
            fecha_id: fecha.id, fecha: fecha.numero,
            monto,
            estado: 'pendiente',
            creada: new Date().toISOString(),
        };

        this.multas.push(nueva);
        await this.save();

        return nueva;
    }

    pendientesDeClub(clubId) {
        return clubId ? this.multas.filter(m => m.clubId === clubId && m.estado === 'pendiente') : [];
    }

    deudaDeClub(clubId) {
        return this.pendientesDeClub(clubId).reduce((s, m) => s + m.monto, 0);
    }

    // Mensaje de error si el club tiene deuda (para bloquear pagos e inscripciones), o null
    bloqueo(clubId) {
        const deuda = this.deudaDeClub(clubId);
        if (!deuda) return null;
        const pesos = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(deuda);
        return `Tu equipo tiene multas pendientes por ${pesos}. Pagalas primero desde "Tu próxima fecha".`;
    }

    // Paga todas las multas pendientes del club en un solo cobro
    async pagarTodas(clubId, { metodo = 'tarjeta', simular } = {}) {
        const pendientes = this.pendientesDeClub(clubId);
        if (!pendientes.length) return { error: 'No tenés multas pendientes' };
        if (this.procesando.has(clubId)) return { error: 'El pago ya se está procesando' };

        this.procesando.add(clubId);

        try {
            const total = pendientes.reduce((s, m) => s + m.monto, 0);
            const r = await cobrar({ monto: total, metodo: metodo === 'mercadopago' ? 'mercadopago' : 'tarjeta', simular });
            if (!r.ok) return { error: r.motivo };

            const fecha = new Date().toISOString();
            for (const m of pendientes) {
                m.estado = 'pagada';
                m.pago = { id: r.id, metodo: r.metodo, monto: m.monto, fecha };
            }
            await this.save();

            return { ok: true, total, multas: pendientes.map(m => this.publico(m)) };
        } finally {
            this.procesando.delete(clubId);
        }
    }
}

export default MultasManager;
