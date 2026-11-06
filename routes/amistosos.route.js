import { Router } from '../middleware/router.js';
import { amistososManager as manager, clubesManager } from '../manager/instances.js';
import { requireAuth, requireRol } from '../middleware/auth.js';
import { procesarVencimientos } from '../services/vencimientosService.js';

const router = Router();

// Amistosos express publicados (publico): los que todavia no empezaron
router.get('/', async (req, res) => {
    await procesarVencimientos();
    res.json((await manager.getPublicados()).map(a => manager.publico(a)));
});

// Los amistosos que tomo mi equipo (capitan). Debe ir antes de '/:id'
router.get('/mios', requireAuth, requireRol('capitan'), async (req, res) => {
    const club = await clubesManager.getRawByOwner(req.userId);
    res.json(club ? (await manager.tomadosPor(club.id)).map(a => manager.publico(a)) : []);
});

// Un amistoso (publico): es el link que comparte el capitan
router.get('/:id', async (req, res) => {
    const a = await manager.getById(req.params.id);
    if (!a) return res.status(404).json({ error: 'No encontramos ese amistoso' });
    res.json(manager.publico(a));
});

// Tomar el amistoso: el capitan paga el precio con descuento y su equipo juega en ese lugar
router.post('/:id/tomar', requireAuth, requireRol('capitan'), async (req, res) => {
    const r = await manager.tomar(req.params.id, req.userId, { metodo: req.body?.metodo, simular: req.body?.simular });
    res.status(r.error ? 400 : 200).json(r);
});

export default router;
