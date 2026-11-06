import { Router } from '../middleware/router.js';
import { partidosManager as manager } from '../manager/instances.js';
import { requireAuth, requireRol } from '../middleware/auth.js';
import { conOrganizacion, miTorneo } from '../middleware/organizador.js';
import { recalcularTabla } from '../services/fixtureService.js';
import { tx } from '../db/index.js';

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
// Cargar el resultado: solo el organizador dueño del torneo, y solo cuando el partido ya empezó.
router.put('/:matchId', requireAuth, requireRol('organizador'), conOrganizacion, async (req, res) => {
    const partido = await manager.getPartidoById(req.params.matchId);
    if (partido.error) return res.status(404).json(partido);

    const { error, status } = await miTorneo(req, partido.tor_id);
    if (error) return res.status(status).json({ error });

    const local = Number(req.body?.home_goals);
    const visita = Number(req.body?.away_goals);
    const valido = (n) => Number.isInteger(n) && n >= 0 && n <= 99;

    if (!valido(local) || !valido(visita)) return res.status(400).json({ error: 'Los goles deben ser números enteros entre 0 y 99' });
    if (new Date(partido.date).getTime() > Date.now()) return res.status(400).json({ error: 'El partido todavía no se jugó' });
    if (partido.wo) return res.status(400).json({ error: 'Este partido se definió por W.O. (un equipo no pagó a tiempo): no se puede cargar el resultado' });

    // Solo se toman los goles: nunca se copia el body entero. Resultado y tabla, todo junto
    const editado = await tx(async () => {
        const p = await manager.editMatch(partido.id, { home_goals: local, away_goals: visita });
        await recalcularTabla(partido.tor_id);
        return p;
    });
    res.json(editado);
});

export default router;
