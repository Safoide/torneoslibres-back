import { Router } from 'express';
import TorneosManager from '../manager/torneosManager.js';
const router = Router()
let manager = new TorneosManager('./databases/torneos.json');
let torneos = manager.getTorneos();

router.get('/', (req,res) => {
    try{
        res.json(torneos)
    }
    catch(err){
        res.status(500).json({error:err})
    }
})

router.get('/torneo/:torId', (req,res) => {
    try{
        const { torId } = req.params

        res.json(manager.getProductById(torId))
    }
    catch(err){
        res.status(500).json({error:err})
    }
})


router.post('/', (req, res) => {
    try {
        const newTor = req.body;

        manager.addTor(newTor)
            .then(response => res.json(response));
    } catch (err) {
        res.status(500).json({error: err});
    }
})


router.put('/:torId', (req, res) => {
    try {
        const { torId } = req.params;
        const modifiedTor = req.body;

        manager.editTor(torId, modifiedTor)
            .then(response => res.json(response));
    } catch (err) {
        res.status(500).json({error: err});
    }
})


router.delete('/:torId', (req, res) => {
    try {
        const { torId } = req.params;

        manager.deleteTor(torId)
            .then(response => res.json(response));
    } catch (err) {
        res.status(500).json({error: err});
    }
})

export default router;