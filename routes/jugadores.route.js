import { Router } from '../middleware/router.js';
import { jugadoresManager as manager } from '../manager/instances.js';

const router = Router();

router.get('/', async (req, res) => {
    res.json(await manager.getJugadores());
});

router.get('/jugador/:playerId', async (req, res) => {
    res.json(await manager.getJugadorById(req.params.playerId));
});

router.get('/equipo/:teamId', async (req, res) => {
    res.json(await manager.getJugadoresByTeam(req.params.teamId));
});

router.get('/torneo/:torId', async (req, res) => {
    res.json(await manager.getJugadoresByTournament(req.params.torId));
});

// Alta, edicion y baja: no se exponen (las estadisticas las calcula el servidor).

export default router;
