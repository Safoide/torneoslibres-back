import { Router } from 'express';
import { multasManager as manager, clubesManager } from '../manager/instances.js';
import { requireAuth, requireRol } from '../middleware/auth.js';
import { procesarVencimientos } from '../services/vencimientosService.js';

const router = Router();

const fail = (res, err) => res.status(500).json({ error: err.message || String(err) });

// Multas pendientes de mi equipo (capitan)
router.get('/mias', requireAuth, requireRol('capitan'), async (req, res) => {
    try {
        await procesarVencimientos();
        const club = clubesManager.getRawByOwner(req.userId);
        const multas = club ? manager.pendientesDeClub(club.id) : [];
        res.json({ total: multas.reduce((s, m) => s + m.monto, 0), multas: multas.map(m => manager.publico(m)) });
    } catch (err) {
        fail(res, err);
    }
});

// Pagar todas las multas pendientes de mi equipo de una vez
router.post('/pagar', requireAuth, requireRol('capitan'), (req, res) => {
    const club = clubesManager.getRawByOwner(req.userId);
    if (!club) return res.status(400).json({ error: 'Primero tenés que crear tu equipo' });

    manager.pagarTodas(club.id, { metodo: req.body?.metodo, simular: req.body?.simular })
        .then(r => res.status(r.error ? 400 : 200).json(r))
        .catch(err => fail(res, err));
});

export default router;
