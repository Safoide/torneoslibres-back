import { Router } from 'express';
import PartidosManager from '../manager/partidosManager.js';
const router = Router();
let manager = new PartidosManager('./databases/partidos.json');
let partidos = manager.getPartidos();

router.get('/',(req,res)=>{
    try{
        res.json(partidos)
    }
    catch(err){
        res.status(500).json({error:err})
    }
})

router.get('/partido/:matchId',(req,res) => {
    try{
        const { matchId } = req.params;

        res.json(manager.getPartidoById(matchId));
    }
    catch(err){
        res.status(500).json({error:err});
    }
})

router.get('/equipo/:teamId',(req,res)=>{
    try{
        const { teamId } = req.params;
        
        res.json(manager.getPartidosByTeam(teamId));
    }
    catch(err){
        res.status(500).json({error:err});
    }
})

router.get('/torneo/:torId',(req,res)=>{
    try{
        const { torId } = req.params;
        
        res.json(manager.getPartidosByTournament(torId));
    }
    catch(err){
        res.status(500).json({error:err});
    }
})


router.post('/', (req, res) => {
    try {
        const newMatch = req.body;

        manager.addMatch(newMatch)
            .then(response => res.json(response));
    } catch (err) {
        res.status(500).json({error: err});
    }
})


router.put('/:matchId', (req, res) => {
    try {
        const { matchId } = req.params;
        const modifiedMatch = req.body;

        manager.editMatch(matchId, modifiedMatch)
            .then(response => res.json(response));
    } catch (err) {
        res.status(500).json({error: err});
    }
})


router.delete('/:matchId', (req, res) => {
    try {
        const { matchId } = req.params;

        manager.deleteMatch(matchId)
            .then(response => res.json(response));
    } catch (err) {
        res.status(500).json({error: err});
    }
})

export default router;