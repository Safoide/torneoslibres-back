import { Router } from '../middleware/router.js';
import { fechasManager, clubesManager, equiposManager, multasManager } from '../manager/instances.js';
import { procesarVencimientos } from '../services/vencimientosService.js';
import { requireAuth, requireRol } from '../middleware/auth.js';
import { conOrganizacion, miTorneo } from '../middleware/organizador.js';

const router = Router();

// Tu proxima fecha (capitan): una por cada torneo en curso donde esta anotado su equipo,
// con el estado del pago de su parte y, si el rival no pago, el resultado por W.O. y el amistoso publicado
router.get('/mias', requireAuth, requireRol('capitan'), async (req, res) => {
    await procesarVencimientos();
    const club = await clubesManager.getRawByOwner(req.userId);
    res.json(club ? await fechasManager.proximasDeClub(club.id) : []);
});

// El capitan paga la parte de su equipo en una fecha. El equipo y el monto los decide el servidor
router.post('/:fechaId/pagar', requireAuth, requireRol('capitan'), async (req, res) => {
    const fecha = await fechasManager.getById(req.params.fechaId);
    if (!fecha) return res.status(404).json({ error: 'No se encontró la fecha' });

    const club = await clubesManager.getRawByOwner(req.userId);
    const equipo = club && await equiposManager.getByTorneoYClub(fecha.tor_id, club.id);
    if (!equipo) return res.status(403).json({ error: 'Tu equipo no juega en este torneo' });

    const bloqueo = await multasManager.bloqueo(club.id); // con multas pendientes no se pueden pagar fechas
    if (bloqueo) return res.status(400).json({ error: bloqueo, multasPendientes: true });

    await procesarVencimientos(); // si el plazo ya vencio, que quede registrado antes de intentar cobrar
    const result = await fechasManager.pagar(fecha.id, equipo.id, { metodo: req.body?.metodo, simular: req.body?.simular });
    res.status(result.error ? 400 : 200).json(result);
});

// Detalle de quien pago cada fecha: solo el organizador dueño del torneo
router.get('/torneo/:torId/pagos', requireAuth, requireRol('organizador'), conOrganizacion, async (req, res) => {
    const { error, status } = await miTorneo(req, req.params.torId);
    if (error) return res.status(status).json({ error });

    const fechas = (await fechasManager.getRawByTorneo(req.params.torId)).filter(x => x.pagos);
    const nombres = new Map((await equiposManager.getByTorneo(req.params.torId)).map(e => [e.id, e.name]));

    const salida = {};
    for (const f of fechas) {
        salida[f.id] = Object.entries(f.pagos).map(([equipoId, p]) => ({
            equipoId, equipo: nombres.get(equipoId) ?? equipoId, estado: p.estado, monto: p.monto,
        }));
    }
    res.json(salida);
});

// Fechas de un torneo (publico)
router.get('/torneo/:torId', async (req, res) => {
    res.json(await fechasManager.getByTorneo(req.params.torId));
});

// Crear una fecha: solo el organizador dueño del torneo
router.post('/', requireAuth, requireRol('organizador'), conOrganizacion, async (req, res) => {
    const { error, status, tor } = await miTorneo(req, req.body?.torId);
    if (error) return res.status(status).json({ error });

    const result = await fechasManager.crear(tor, req.body);
    res.status(result.error ? 400 : 201).json(result);
});

router.delete('/:fechaId', requireAuth, requireRol('organizador'), conOrganizacion, async (req, res) => {
    const fecha = await fechasManager.getById(req.params.fechaId);
    if (!fecha) return res.status(404).json({ error: 'No se encontró la fecha' });

    const { error, status } = await miTorneo(req, fecha.tor_id);
    if (error) return res.status(status).json({ error });

    const result = await fechasManager.eliminar(fecha.id);
    res.status(result.error ? 400 : 200).json(result);
});

export default router;
