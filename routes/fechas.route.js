import { Router } from '../middleware/router.js';
import { fechasManager, clubesManager, equiposManager, multasManager, partidosManager } from '../manager/instances.js';
import { procesarVencimientos } from '../services/vencimientosService.js';
import { avisarFechaNueva, avisarResultados, avisarFechaCancelada, avisarDevolucionHecha } from '../services/avisosService.js';
import { saldosDeTorneo, devolucionesDeClub, devolucionesDeTorneos, getDevolucion, marcarDevuelta } from '../services/saldosService.js';
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
            conSaldo: p.pago?.saldo ?? 0, // cuánto se pagó con saldo a favor (de una fecha cancelada)
        }));
    }
    res.json(salida);
});

// Devoluciones (saldo a favor que quedó al terminar el torneo; ver saldosService.js)
// Del capitán: las de su equipo en todos los torneos
router.get('/devoluciones/mias', requireAuth, requireRol('capitan'), async (req, res) => {
    const club = await clubesManager.getRawByOwner(req.userId);
    res.json(club ? await devolucionesDeClub(club.id) : []);
});

// Del organizador dueño: las del torneo
router.get('/torneo/:torId/devoluciones', requireAuth, requireRol('organizador'), conOrganizacion, async (req, res) => {
    const { error, status } = await miTorneo(req, req.params.torId);
    if (error) return res.status(status).json({ error });
    res.json(await devolucionesDeTorneos([req.params.torId]));
});

// El organizador dueño marca que ya le devolvió la plata al equipo
router.put('/devoluciones/:id/devuelta', requireAuth, requireRol('organizador'), conOrganizacion, async (req, res) => {
    const dev = await getDevolucion(req.params.id);
    if (!dev) return res.status(404).json({ error: 'No se encontró la devolución' });

    const { error, status } = await miTorneo(req, dev.tor_id);
    if (error) return res.status(status).json({ error });

    if (!await marcarDevuelta(dev.id)) return res.status(400).json({ error: 'Ya estaba marcada como devuelta' });
    avisarDevolucionHecha(dev); // mail al capitán, en segundo plano
    res.json(await getDevolucion(dev.id));
});

// Saldos a favor de los equipos del torneo (de fechas canceladas que ya habían pagado): solo el organizador dueño
router.get('/torneo/:torId/saldos', requireAuth, requireRol('organizador'), conOrganizacion, async (req, res) => {
    const { error, status } = await miTorneo(req, req.params.torId);
    if (error) return res.status(status).json({ error });

    const saldos = await saldosDeTorneo(req.params.torId);
    const nombres = new Map((await equiposManager.getByTorneo(req.params.torId)).map(e => [e.id, e.name]));
    res.json([...saldos].filter(([, monto]) => monto > 0).map(([equipoId, monto]) => ({ equipoId, equipo: nombres.get(equipoId) ?? equipoId, monto })));
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
    if (result.error) return res.status(400).json(result);

    avisarFechaNueva(tor, result); // mails a los capitanes, en segundo plano (no frena la respuesta)
    res.status(201).json(result);
});

// Cargar o corregir los resultados de una fecha terminada: solo el organizador dueño, mientras el torneo esté en curso.
// body: { resultados: [{ id: 'MATCH-1', home_goals: 2, away_goals: 1 }, ...] } (se pueden mandar solo algunos)
router.put('/:fechaId/resultados', requireAuth, requireRol('organizador'), conOrganizacion, async (req, res) => {
    const fecha = await fechasManager.getById(req.params.fechaId);
    if (!fecha) return res.status(404).json({ error: 'No se encontró la fecha' });

    const { error, status, tor } = await miTorneo(req, fecha.tor_id);
    if (error) return res.status(status).json({ error });

    await procesarVencimientos(); // que los W.O. pendientes queden aplicados antes de cargar resultados
    const antes = await partidosManager.getByFecha(tor.id, fecha.numero); // para avisar solo los que cambiaron
    const result = await fechasManager.cargarResultados(fecha, tor, req.body?.resultados);
    if (result.error) return res.status(400).json(result);

    avisarResultados(tor, fecha, antes, result); // mails a los capitanes, en segundo plano
    res.json(result);
});

router.delete('/:fechaId', requireAuth, requireRol('organizador'), conOrganizacion, async (req, res) => {
    const fecha = await fechasManager.getById(req.params.fechaId);
    if (!fecha) return res.status(404).json({ error: 'No se encontró la fecha' });

    const { error, status, tor } = await miTorneo(req, fecha.tor_id);
    if (error) return res.status(status).json({ error });

    const partidos = await partidosManager.getByFecha(fecha.tor_id, fecha.numero); // para el aviso (se borran)
    const result = await fechasManager.eliminar(fecha.id);
    if (result.error) return res.status(400).json(result);

    avisarFechaCancelada(tor, fecha, partidos, result.acreditados); // mails a los capitanes, en segundo plano
    res.json(result);
});

export default router;
