import { Router } from '../middleware/router.js';
import { partidosManager as manager, fechasManager } from '../manager/instances.js';
import { requireAuth, requireRol } from '../middleware/auth.js';
import { conOrganizacion, miTorneo } from '../middleware/organizador.js';
import { procesarVencimientos } from '../services/vencimientosService.js';
import { avisarResultados } from '../services/avisosService.js';

const router = Router();

// Lectura: publica

router.get('/', async (req, res) => {
    res.json(await manager.getPartidos());
});

router.get('/partido/:matchId', async (req, res) => {
    res.json(await manager.getPartidoById(req.params.matchId));
});

router.get('/equipo/:teamId', async (req, res) => {
    res.json(await manager.getPartidosByTeam(req.params.teamId));
});

router.get('/torneo/:torId', async (req, res) => {
    res.json(await manager.getPartidosByTournament(req.params.torId));
});

// Los partidos se crean y se borran junto con su fecha (/fechas), no de a uno.
// Cargar el resultado de un partido: mismas reglas que PUT /fechas/:id/resultados
// (organizador dueño, fecha terminada, torneo en curso; se puede corregir hasta que el torneo finaliza).
router.put('/:matchId', requireAuth, requireRol('organizador'), conOrganizacion, async (req, res) => {
    const partido = await manager.getPartidoById(req.params.matchId);
    if (partido.error) return res.status(404).json(partido);

    const { error, status, tor } = await miTorneo(req, partido.tor_id);
    if (error) return res.status(status).json({ error });

    const fecha = await fechasManager.getByNumero(partido.tor_id, partido.fecha);
    if (!fecha) return res.status(400).json({ error: 'El partido no pertenece a ninguna fecha' });

    await procesarVencimientos();
    const antes = await manager.getByFecha(tor.id, fecha.numero); // para avisar solo si cambió
    const result = await fechasManager.cargarResultados(fecha, tor, [{ id: partido.id, home_goals: req.body?.home_goals, away_goals: req.body?.away_goals }]);
    if (result.error) return res.status(400).json(result);

    avisarResultados(tor, fecha, antes, result); // mails a los capitanes, en segundo plano

    res.json(result.find(p => p.id === partido.id));
});

export default router;
