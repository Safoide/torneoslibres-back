import { Router } from '../middleware/router.js';
import { clubesManager as manager } from '../manager/instances.js';
import { requireAuth, requireRol } from '../middleware/auth.js';
import { torneosDeClub } from '../services/misTorneosService.js';

const router = Router();

const send = (res, result, ok = 200) => res.status(result?.error ? 400 : ok).json(result);

// Solo deja pasar si el equipo es del usuario logueado
const esMio = async (req, res, next) => {
    const mio = await manager.getRawByOwner(req.userId);

    if (!mio || mio.id !== req.params.clubId) return res.status(403).json({ error: 'Este equipo no es tuyo' });

    next();
};

// Mi equipo (con plantel y WhatsApp) o null. No hay ruta publica: son datos personales
router.get('/mio', requireAuth, requireRol('capitan'), async (req, res) => {
    res.json(await manager.miEquipo(req.userId));
});

// Torneos donde esta anotado mi equipo (en curso, proximos y finalizados)
router.get('/mio/torneos', requireAuth, requireRol('capitan'), async (req, res) => {
    const club = await manager.getRawByOwner(req.userId);

    res.json(club ? await torneosDeClub(club.id) : []);
});

router.post('/', requireAuth, requireRol('capitan'), async (req, res) => {
    send(res, await manager.crear(req.userId, req.body), 201);
});

router.put('/:clubId', requireAuth, requireRol('capitan'), esMio, async (req, res) => {
    send(res, await manager.editar(req.params.clubId, req.body));
});

router.delete('/:clubId', requireAuth, requireRol('capitan'), esMio, async (req, res) => {
    send(res, await manager.eliminar(req.params.clubId));
});

export default router;
