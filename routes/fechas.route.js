import { Router } from 'express';
import { fechasManager, clubesManager, torneosManager, equiposManager, amistososManager, multasManager } from '../manager/instances.js';
import { procesarVencimientos } from '../services/vencimientosService.js';
import { requireAuth, requireRol } from '../middleware/auth.js';
import { conOrganizacion, miTorneo } from '../middleware/organizador.js';

const router = Router();

const fail = (res, err) => res.status(500).json({ error: err.message || String(err) });

// Tu proxima fecha (capitan): una por cada torneo en curso donde esta anotado su equipo,
// con el estado del pago de su parte y, si el rival no pago, el resultado por W.O. y el amistoso publicado
router.get('/mias', requireAuth, requireRol('capitan'), async (req, res) => {
    try {
        await procesarVencimientos();
        const club = clubesManager.getRawByOwner(req.userId);
        res.json(club ? fechasManager.proximasDeClub(club.id, torneosManager, amistososManager, multasManager) : []);
    } catch (err) {
        fail(res, err);
    }
});

// El capitan paga la parte de su equipo en una fecha. El equipo y el monto los decide el servidor
router.post('/:fechaId/pagar', requireAuth, requireRol('capitan'), async (req, res) => {
    try {
        const fecha = fechasManager.getById(req.params.fechaId);
        if (!fecha) return res.status(404).json({ error: 'No se encontró la fecha' });

        const club = clubesManager.getRawByOwner(req.userId);
        const equipo = club && equiposManager.getEquipos().find(e => e.tor_id === fecha.tor_id && e.club_id === club.id);
        if (!equipo) return res.status(403).json({ error: 'Tu equipo no juega en este torneo' });

        const bloqueo = multasManager.bloqueo(club.id); // con multas pendientes no se pueden pagar fechas
        if (bloqueo) return res.status(400).json({ error: bloqueo, multasPendientes: true });

        await procesarVencimientos(); // si el plazo ya vencio, que quede registrado antes de intentar cobrar
        const result = await fechasManager.pagar(fecha.id, equipo.id, { metodo: req.body?.metodo, simular: req.body?.simular });
        res.status(result.error ? 400 : 200).json(result);
    } catch (err) {
        fail(res, err);
    }
});

// Detalle de quien pago cada fecha: solo el organizador dueño del torneo
router.get('/torneo/:torId/pagos', requireAuth, requireRol('organizador'), conOrganizacion, (req, res) => {
    const { error, status } = miTorneo(req, req.params.torId);
    if (error) return res.status(status).json({ error });

    const salida = {};
    for (const f of fechasManager.getRawByTorneo(req.params.torId).filter(x => x.pagos)) {
        salida[f.id] = Object.entries(f.pagos).map(([equipoId, p]) => ({
            equipoId, equipo: equiposManager.getEquipoById(equipoId)?.name ?? equipoId, estado: p.estado, monto: p.monto,
        }));
    }
    res.json(salida);
});

// Fechas de un torneo (publico)
router.get('/torneo/:torId', (req, res) => {
    res.json(fechasManager.getByTorneo(req.params.torId));
});

// Crear una fecha: solo el organizador dueño del torneo
router.post('/', requireAuth, requireRol('organizador'), conOrganizacion, (req, res) => {
    const { error, status, tor } = miTorneo(req, req.body?.torId);
    if (error) return res.status(status).json({ error });

    fechasManager.crear(tor, req.body)
        .then(result => res.status(result.error ? 400 : 201).json(result))
        .catch(err => fail(res, err));
});

router.delete('/:fechaId', requireAuth, requireRol('organizador'), conOrganizacion, (req, res) => {
    const fecha = fechasManager.getById(req.params.fechaId);
    if (!fecha) return res.status(404).json({ error: 'No se encontró la fecha' });

    const { error, status } = miTorneo(req, fecha.tor_id);
    if (error) return res.status(status).json({ error });

    fechasManager.eliminar(fecha.id)
        .then(result => res.status(result.error ? 400 : 200).json(result))
        .catch(err => fail(res, err));
});

export default router;
