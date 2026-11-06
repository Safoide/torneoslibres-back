import { Router } from '../middleware/router.js';
import { multasManager as manager, clubesManager } from '../manager/instances.js';
import { requireAuth, requireRol } from '../middleware/auth.js';
import { procesarVencimientos } from '../services/vencimientosService.js';

const router = Router();

// Multas pendientes de mi equipo (capitan)
router.get('/mias', requireAuth, requireRol('capitan'), async (req, res) => {
    await procesarVencimientos();
    const club = await clubesManager.getRawByOwner(req.userId);
    const multas = club ? await manager.pendientesDeClub(club.id) : [];
    res.json({ total: multas.reduce((s, m) => s + m.monto, 0), multas: multas.map(m => manager.publico(m)) });
});

// Pagar todas las multas pendientes de mi equipo de una vez
router.post('/pagar', requireAuth, requireRol('capitan'), async (req, res) => {
    const club = await clubesManager.getRawByOwner(req.userId);
    if (!club) return res.status(400).json({ error: 'Primero tenés que crear tu equipo' });

    const r = await manager.pagarTodas(club.id, { metodo: req.body?.metodo, simular: req.body?.simular });
    res.status(r.error ? 400 : 200).json(r);
});

export default router;
