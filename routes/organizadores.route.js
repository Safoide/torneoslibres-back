import { fail } from '../middleware/errores.js';
import { Router } from 'express';
import { organizadoresManager as manager } from '../manager/instances.js';
import { requireAuth, requireRol } from '../middleware/auth.js';
import { conOrganizacion } from '../middleware/organizador.js';
import { dashboardDe } from '../services/dashboardService.js';

const router = Router();

const send = (res, result, ok = 200) => res.status(result?.error ? 400 : ok).json(result);

// Solo deja pasar si la organizacion es del usuario logueado
const esMia = (req, res, next) => {
    const mia = manager.miOrganizacion(req.userId);

    if (!mia || mia.id !== req.params.orgId) return res.status(403).json({ error: 'Esta organización no es tuya' });

    next();
};

router.get('/', (req, res) => {
    res.json(manager.getAll());
})

// Debe ir antes de '/:orgId'. Devuelve mi organizacion o null
router.get('/mia', requireAuth, (req, res) => {
    res.json(manager.miOrganizacion(req.userId));
})

// Panel de mi organizacion: estadisticas, plata y torneos. Tambien antes de '/:orgId'
router.get('/mia/dashboard', requireAuth, requireRol('organizador'), conOrganizacion, (req, res) => {
    try {
        res.json(dashboardDe(req.org.id));
    } catch (err) {
        fail(res, err);
    }
})

router.get('/:orgId', (req, res) => {
    const result = manager.getById(req.params.orgId);
    res.status(result.error ? 404 : 200).json(result);
})

router.post('/', requireAuth, requireRol('organizador'), (req, res) => {
    manager.crear(req.userId, req.body).then(r => send(res, r, 201)).catch(err => fail(res, err));
})

router.put('/:orgId', requireAuth, requireRol('organizador'), esMia, (req, res) => {
    manager.editar(req.params.orgId, req.body).then(r => send(res, r)).catch(err => fail(res, err));
})

router.delete('/:orgId', requireAuth, requireRol('organizador'), esMia, (req, res) => {
    manager.eliminar(req.params.orgId).then(r => send(res, r)).catch(err => fail(res, err));
})

export default router;