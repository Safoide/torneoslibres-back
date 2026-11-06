import { Router } from '../middleware/router.js';
import { inscripcionesManager as manager } from '../manager/instances.js';
import { requireAuth, requireRol } from '../middleware/auth.js';

const router = Router();

const send = (res, result) => result?.error ? res.status(400).json(result) : res.json(result);

// La inscripcion tiene que ser del usuario logueado
const esMia = async (req, res, next) => {
    const insc = await manager.getInscripcionById(req.params.id);

    if (insc.error) return res.status(404).json(insc);
    if (insc.ownerId !== req.userId) return res.status(403).json({ error: 'Esta inscripción no es tuya' });

    req.insc = insc;
    next();
};

router.post('/', requireAuth, requireRol('capitan'), async (req, res) => {
    send(res, await manager.crear(req.userId, req.body));
});

router.get('/:id', requireAuth, esMia, (req, res) => {
    res.json(req.insc);
});

router.post('/:id/pagar', requireAuth, requireRol('capitan'), esMia, async (req, res) => {
    send(res, await manager.pagar(req.params.id, req.body));
});

export default router;
