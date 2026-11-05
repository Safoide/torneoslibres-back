import { Router } from 'express';
import { inscripcionesManager as manager } from '../manager/instances.js';
import { requireAuth, requireRol } from '../middleware/auth.js';

const router = Router();

const send = (res, result) => result?.error ? res.status(400).json(result) : res.json(result);
const fail = (res, err) => res.status(500).json({ error: err.message || String(err) });

// La inscripcion tiene que ser del usuario logueado
const esMia = (req, res, next) => {
    const insc = manager.getInscripcionById(req.params.id);

    if (insc.error) return res.status(404).json(insc);
    if (insc.ownerId !== req.userId) return res.status(403).json({ error: 'Esta inscripción no es tuya' });

    req.insc = insc;
    next();
};

router.post('/', requireAuth, requireRol('capitan'), (req, res) => {
    manager.crear(req.userId, req.body).then(r => send(res, r)).catch(err => fail(res, err));
})

router.get('/:id', requireAuth, esMia, (req, res) => {
    res.json(req.insc);
})

router.post('/:id/pagar', requireAuth, requireRol('capitan'), esMia, (req, res) => {
    manager.pagar(req.params.id, req.body).then(r => send(res, r)).catch(err => fail(res, err));
})

export default router;