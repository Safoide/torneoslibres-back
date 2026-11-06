import { Router } from 'express';
import { partidosManager as manager } from '../manager/instances.js';
import { requireAuth, requireRol } from '../middleware/auth.js';
import { conOrganizacion, miTorneo } from '../middleware/organizador.js';
import { recalcularTabla } from '../services/fixtureService.js';

const router = Router();

const fail = (res, err) => res.status(500).json({ error: err.message || String(err) });

// Lectura: publica

router.get('/', (req, res) => {
    res.json(manager.getPartidos());
});

router.get('/partido/:matchId', (req, res) => {
    res.json(manager.getPartidoById(req.params.matchId));
});

router.get('/equipo/:teamId', (req, res) => {
    res.json(manager.getPartidosByTeam(req.params.teamId));
});

router.get('/torneo/:torId', (req, res) => {
    res.json(manager.getPartidosByTournament(req.params.torId));
});

// Los partidos se crean y se borran junto con su fecha (/fechas), no de a uno.
// Cargar el resultado: solo el organizador dueño del torneo, y solo cuando el partido ya empezó.
router.put('/:matchId', requireAuth, requireRol('organizador'), conOrganizacion, (req, res) => {
    const partido = manager.getPartidoById(req.params.matchId);
    if (partido.error) return res.status(404).json(partido);

    const { error, status } = miTorneo(req, partido.tor_id);
    if (error) return res.status(status).json({ error });

    const local = Number(req.body?.home_goals);
    const visita = Number(req.body?.away_goals);
    const valido = (n) => Number.isInteger(n) && n >= 0 && n <= 99;

    if (!valido(local) || !valido(visita)) return res.status(400).json({ error: 'Los goles deben ser números enteros entre 0 y 99' });
    if (new Date(partido.date).getTime() > Date.now()) return res.status(400).json({ error: 'El partido todavía no se jugó' });
    if (partido.wo) return res.status(400).json({ error: 'Este partido se definió por W.O. (un equipo no pagó a tiempo): no se puede cargar el resultado' });

    // Solo se toman los goles: nunca se copia el body entero
    manager.editMatch(partido.id, { home_goals: local, away_goals: visita })
        .then(async (editado) => { await recalcularTabla(partido.tor_id); res.json(editado); })
        .catch(err => fail(res, err));
});

export default router;
