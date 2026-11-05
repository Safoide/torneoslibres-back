import { Router } from 'express';
import { fechasManager, clubesManager, torneosManager } from '../manager/instances.js';
import { requireAuth, requireRol } from '../middleware/auth.js';
import { conOrganizacion, miTorneo } from '../middleware/organizador.js';

const router = Router();

const fail = (res, err) => res.status(500).json({ error: err.message || String(err) });

// Tu proxima fecha (capitan): una por cada torneo en curso donde esta anotado su equipo
router.get('/mias', requireAuth, requireRol('capitan'), (req, res) => {
    const club = clubesManager.getRawByOwner(req.userId);

    res.json(club ? fechasManager.proximasDeClub(club.id, torneosManager) : []);
});

// Fechas de un torneo (publico)
router.get('/torneo/:torId', (req, res) => {
    res.json(fechasManager.getByTorneo(req.params.torId));
});

// Crear una fecha: solo el organizador dueño del torneo
router.post('/', requireAuth, requireRol('organizador'), conOrganizacion, (req, res) => {
    const { error, status, tor } = miTorneo(req, req.body?.torId);
    if (error) return res.status(status).json({ error });

    fechasManager.crear(tor, req.body)
        .then(result => res.status(result.error ? 400 : 201).json(result))
        .catch(err => fail(res, err));
});

router.delete('/:fechaId', requireAuth, requireRol('organizador'), conOrganizacion, (req, res) => {
    const fecha = fechasManager.getById(req.params.fechaId);
    if (!fecha) return res.status(404).json({ error: 'No se encontró la fecha' });

    const { error, status } = miTorneo(req, fecha.tor_id);
    if (error) return res.status(status).json({ error });

    fechasManager.eliminar(fecha.id)
        .then(result => res.status(result.error ? 400 : 200).json(result))
        .catch(err => fail(res, err));
});

export default router;
