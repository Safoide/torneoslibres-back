import { Router } from "express";
import EquiposManager from "../manager/equiposManager.js";
const router = Router();
let manager = new EquiposManager('./databases/equipos.json');
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


router.post('/', (req, res) => {
    try {
        const newTeam = req.body;

        manager.addTeam(newTeam)
            .then(response => res.json(response));
    } catch (err) {
        res.status(500).json({error: err});
    }
})


router.put('/:teamId', (req, res) => {
    try {
        const { teamId } = req.params;
        const modifiedTeam = req.body;

        manager.editTeam(teamId, modifiedTeam)
            .then(response => res.json(response));
    } catch (err) {
        res.status(500).json({error: err});
    }
})


router.delete('/:teamId', (req, res) => {
    try {
        const { teamId } = req.params;

        manager.deleteTeam(teamId)
            .then(response => res.json(response));
    } catch (err) {
        res.status(500).json({error: err});
    }
})

export default router;