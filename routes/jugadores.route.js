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


// Alta, edicion y baja: no se exponen. Los equipos entran por la inscripcion (/inscripciones)
// y se editan desde el equipo del capitan (/clubes); las estadisticas las calcula el servidor.

export default router;