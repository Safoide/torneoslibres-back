import { Router } from 'express';
import { clubesManager as manager } from '../manager/instances.js';
import { requireAuth, requireRol } from '../middleware/auth.js';
import { torneosDeClub } from '../services/misTorneosService.js';

const router = Router();

const send = (res, result, ok = 200) => res.status(result?.error ? 400 : ok).json(result);
const fail = (res, err) => res.status(500).json({ error: err.message || String(err) });

// Solo deja pasar si el equipo es del usuario logueado
const esMio = (req, res, next) => {
    const mio = manager.getRawByOwner(req.userId);

    if (!mio || mio.id !== req.params.clubId) return res.status(403).json({ error: 'Este equipo no es tuyo' });

    next();
};

// Mi equipo (con plantel y WhatsApp) o null. No hay ruta publica: son datos personales
router.get('/mio', requireAuth, requireRol('capitan'), (req, res) => {
    res.json(manager.miEquipo(req.userId));
})

// Torneos donde esta anotado mi equipo (en curso, proximos y finalizados)
router.get('/mio/torneos', requireAuth, requireRol('capitan'), (req, res) => {
    const club = manager.getRawByOwner(req.userId);

    res.json(club ? torneosDeClub(club.id) : []);
})

router.post('/', requireAuth, requireRol('capitan'), (req, res) => {
    manager.crear(req.userId, req.body).then(r => send(res, r, 201)).catch(err => fail(res, err));
})

router.put('/:clubId', requireAuth, requireRol('capitan'), esMio, (req, res) => {
    manager.editar(req.params.clubId, req.body).then(r => send(res, r)).catch(err => fail(res, err));
})

router.delete('/:clubId', requireAuth, requireRol('capitan'), esMio, (req, res) => {
    manager.eliminar(req.params.clubId).then(r => send(res, r)).catch(err => fail(res, err));
})

export default router;