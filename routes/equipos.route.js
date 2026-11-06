import { Router } from '../middleware/router.js';
import { equiposManager as manager } from '../manager/instances.js';

const router = Router();

router.get('/', async (req, res) => {
    res.json(await manager.getEquipos());
});

router.get('/equipo/:teamId', async (req, res) => {
    res.json(await manager.getEquipoById(req.params.teamId));
});

router.get('/torneo/:torId', async (req, res) => {
    res.json(await manager.getEquiposByTournament(req.params.torId));
});

// Alta, edicion y baja: no se exponen. Los equipos entran por la inscripcion (/inscripciones)
// y se editan desde el equipo del capitan (/clubes); las estadisticas las calcula el servidor.

export default router;
