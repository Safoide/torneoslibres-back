import { Router } from 'express';
import { amistososManager as manager, clubesManager } from '../manager/instances.js';
import { requireAuth, requireRol } from '../middleware/auth.js';
import { procesarVencimientos } from '../services/vencimientosService.js';

const router = Router();

const fail = (res, err) => res.status(500).json({ error: err.message || String(err) });

// Amistosos express publicados (publico): los que todavia no empezaron
router.get('/', async (req, res) => {
    try {
        await procesarVencimientos();
        res.json(manager.getPublicados().map(a => manager.publico(a)));
    } catch (err) {
        fail(res, err);
    }
});

// Los amistosos que tomo mi equipo (capitan). Debe ir antes de '/:id'
router.get('/mios', requireAuth, requireRol('capitan'), (req, res) => {
    const club = clubesManager.getRawByOwner(req.userId);
    res.json(club ? manager.tomadosPor(club.id).map(a => manager.publico(a)) : []);
});

// Un amistoso (publico): es el link que comparte el capitan
router.get('/:id', (req, res) => {
    const a = manager.getById(req.params.id);
    if (!a) return res.status(404).json({ error: 'No encontramos ese amistoso' });
    res.json(manager.publico(a));
});

// Tomar el amistoso: el capitan paga el precio con descuento y su equipo juega en ese lugar
router.post('/:id/tomar', requireAuth, requireRol('capitan'), (req, res) => {
    manager.tomar(req.params.id, req.userId, { metodo: req.body?.metodo, simular: req.body?.simular })
        .then(r => res.status(r.error ? 400 : 200).json(r))
        .catch(err => fail(res, err));
});

export default router;
