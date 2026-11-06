import { fail } from '../middleware/errores.js';
import { Router } from "express";
import { equiposManager as manager } from "../manager/instances.js";
const router = Router();
let equipos = manager.getEquipos();

router.get('/', (req, res) => {
    try {
        res.json(equipos);
    } catch(err) {
        fail(res, err);
    }
})

router.get('/equipo/:teamId', (req, res) => {
    try {
        const { teamId } = req.params;

        res.json(manager.getEquipoById(teamId));
    } catch (err) {
        fail(res, err);
    }
})

router.get('/torneo/:torId', (req, res) => {
    try {
        const { torId } = req.params;

        res.json(manager.getEquiposByTournament(torId));
    } catch (err) {
        fail(res, err);
    }
})


// Alta, edicion y baja: no se exponen. Los equipos entran por la inscripcion (/inscripciones)
// y se editan desde el equipo del capitan (/clubes); las estadisticas las calcula el servidor.

export default router;