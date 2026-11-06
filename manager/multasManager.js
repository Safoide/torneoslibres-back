import { randomUUID } from 'crypto';
import { q, tx } from '../db/index.js';
import { aFila, deFila, deFilas } from '../db/filas.js';
import { cobrar } from '../services/pagosService.js';

// Multas por no pagar una fecha a tiempo (si el torneo tiene la penalizacion activada).
// Quedan como deuda del equipo (club del capitan): hasta saldarla no puede pagar fechas,
// inscribirse en torneos ni tomar amistosos.
class MultasManager {
    constructor() {
        this.procesando = new Set(); // evita cobrar dos veces si se toca "Pagar" dos veces
    }

    publico({ pago, ...m }) {
        return { ...m, pagada: pago ? { fecha: pago.fecha, monto: pago.monto } : null };
    }

    // La crea el servidor al procesar un vencimiento (nunca viene del cliente). null si no corresponde o ya existia
    async crear({ tor, fecha, equipo, monto }) {
        if (!monto || monto <= 0) return null;

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

        // Una multa por equipo y fecha: si ya existe no se crea otra (ON CONFLICT no corta la transaccion de vencimientos)
        const r = await q().insertInto('multas').values(aFila('multas', nueva))
            .onConflict((oc) => oc.columns(['fecha_id', 'equipoId']).doNothing())
            .executeTakeFirst();

        return Number(r.numInsertedOrUpdatedRows) ? nueva : null;
    }

    async getDe(fechaId, equipoId) {
        const fila = await q().selectFrom('multas').selectAll().where('fecha_id', '=', fechaId).where('equipoId', '=', equipoId).executeTakeFirst();
        return fila ? deFila('multas', fila) : null;
    }

    async getByTorneos(torIds) {
        return torIds.length ? deFilas('multas', await q().selectFrom('multas').selectAll().where('tor_id', 'in', torIds).execute()) : [];
    }

    async pendientesDeClub(clubId) {
        if (!clubId) return [];
        return deFilas('multas', await q().selectFrom('multas').selectAll()
            .where('clubId', '=', clubId).where('estado', '=', 'pendiente').orderBy('creada').execute());
    }

    async deudaDeClub(clubId) {
        return (await this.pendientesDeClub(clubId)).reduce((s, m) => s + m.monto, 0);
    }

    // Mensaje de error si el club tiene deuda (para bloquear pagos e inscripciones), o null
    async bloqueo(clubId) {
        const deuda = await this.deudaDeClub(clubId);
        if (!deuda) return null;
        const pesos = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(deuda);
        return `Tu equipo tiene multas pendientes por ${pesos}. Pagalas primero desde "Tu próxima fecha".`;
    }

    // Paga todas las multas pendientes del club en un solo cobro
    async pagarTodas(clubId, { metodo = 'tarjeta', simular } = {}) {
        if (this.procesando.has(clubId)) return { error: 'El pago ya se está procesando' };
        const pendientes = await this.pendientesDeClub(clubId);
        if (!pendientes.length) return { error: 'No tenés multas pendientes' };

        this.procesando.add(clubId);

        try {
            const total = pendientes.reduce((s, m) => s + m.monto, 0);
            const r = await cobrar({ monto: total, metodo: metodo === 'mercadopago' ? 'mercadopago' : 'tarjeta', simular });
            if (!r.ok) return { error: r.motivo };

            const fecha = new Date().toISOString();
            await tx(async () => {
                for (const m of pendientes) {
                    m.estado = 'pagada';
                    m.pago = { id: r.id, metodo: r.metodo, monto: m.monto, fecha };
                    await q().updateTable('multas').set(aFila('multas', { estado: m.estado, pago: m.pago }))
                        .where('id', '=', m.id).where('estado', '=', 'pendiente').execute();
                }
            });

            return { ok: true, total, multas: pendientes.map(m => this.publico(m)) };
        } finally {
            this.procesando.delete(clubId);
        }
    }
}

export default MultasManager;
