import { Router } from "express";
import { equiposManager as manager } from "../manager/instances.js";
const router = Router();
let equipos = manager.getEquipos();

router.get('/', (req, res) => {
    try {
        res.json(equipos);
    } catch(err) {
        res.status(500).json({error: err});
    }
})

router.get('/equipo/:teamId', (req, res) => {
    try {
        const { teamId } = req.params;

        res.json(manager.getEquipoById(teamId));
    } catch (err) {
        res.status(500).json({error: err});
    }
})

router.get('/torneo/:torId', (req, res) => {
    try {
        const { torId } = req.params;

        res.json(manager.getEquiposByTournament(torId));
    } catch (err) {
        res.status(500).json({error: err});
    }
})


// Alta, edicion y baja: no se exponen. Los equipos entran por la inscripcion (/inscripciones)
// y se editan desde el equipo del capitan (/clubes); las estadisticas las calcula el servidor.

export default router;