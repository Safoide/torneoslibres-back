import { Router } from 'express';
import JugadoresManager from '../manager/jugadoresManager.js';
const router = Router();
let manager = new JugadoresManager('./databases/jugadores.json');
let partidos = manager.getJugadores();

router.get('/',(req,res)=>{
    try{
        res.json(partidos)
    }
    catch(err){
        res.status(500).json({error:err})
    }
})

router.get('/jugador/:playerId',(req,res) => {
    try{
        const { playerId } = req.params;

        res.json(manager.getJugadorById(playerId));
    }
    catch(err){
        res.status(500).json({error:err});
    }
})

router.get('/equipo/:teamId',(req,res)=>{
    try{
        const { teamId } = req.params;
        
        res.json(manager.getJugadoresByTeam(teamId));
    }
    catch(err){
        res.status(500).json({error:err});
    }
})

router.get('/torneo/:torId',(req,res)=>{
    try{
        const { torId } = req.params;
        
        res.json(manager.getJugadoresByTournament(torId));
    }
    catch(err){
        res.status(500).json({error:err});
    }
})


router.post('/', (req, res) => {
    try {
        const newPlayer = req.body;

        manager.addPlayer(newPlayer)
            .then(response => res.json(response));
    } catch (err) {
        res.status(500).json({error: err});
    }
})


router.put('/:playerId', (req, res) => {
    try {
        const { playerId } = req.params;
        const modifiedPlayer = req.body;

        manager.editPlayer(playerId, modifiedPlayer)
            .then(response => res.json(response));
    } catch (err) {
        res.status(500).json({error: err});
    }
})


router.delete('/:playerId', (req, res) => {
    try {
        const { playerId } = req.params;

        manager.deletePlayer(playerId)
            .then(response => res.json(response));
    } catch (err) {
        res.status(500).json({error: err});
    }
})

export default router;