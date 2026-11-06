import { fail } from '../middleware/errores.js';
import { Router } from 'express';
import { torneosManager as manager, organizadoresManager } from '../manager/instances.js';
import { reglasDe } from '../manager/torneosManager.js';
import { requireAuth } from '../middleware/auth.js';
const router = Router()

// Orden de los estados: inscripcion-abierta y proximamente son la misma etapa (se puede ir y volver)
const ETAPA = { 'proximamente': 0, 'inscripcion-abierta': 0, 'en-curso': 1, 'finalizado': 2 };

const sendResult = (res, result) => {
    if (result && result.error) return res.status(400).json(result);
    res.json(result);
}


// Exige que el usuario tenga organizacion y la deja en req.org
const conOrganizacion = (req, res, next) => {
    const org = organizadoresManager.miOrganizacion(req.userId);

    if (!org) return res.status(403).json({ error: 'Primero tenés que crear tu organización' });

    req.org = org;
    next();
};

// Ademas exige que el torneo sea de esa organizacion y lo deja en req.tor
const esDeMiOrganizacion = (req, res, next) => {
    const tor = manager.getTorneoById(req.params.torId);

    if (tor.error) return res.status(404).json(tor);
    if (tor.organizadorId !== req.org.id) return res.status(403).json({ error: 'Este torneo no es de tu organización' });

    req.tor = tor;
    next();
};

// GET /torneos?modalidad=f5,f7&zona=Palermo&estado=inscripcion-abierta&precioMax=50000&q=copa&orden=precio
router.get('/', (req,res) => {
    try{
        res.json(manager.searchTorneos(req.query))
    }
    catch(err){
        fail(res, err)
    }
})

// Valores disponibles para los filtros (zonas, modalidades, etc.)
router.get('/filtros', (req,res) => {
    try{
        res.json(manager.getFiltros())
    }
    catch(err){
        fail(res, err)
    }
})

router.get('/:torId', (req,res) => {
    try{
        const { torId } = req.params
        const result = manager.getTorneoById(torId)

        if (result.error) return res.status(404).json(result);

        // Las reglas de pago resueltas (los torneos viejos no las tienen guardadas y usan las default)
        res.json({ ...result, reglasPago: reglasDe(result) })
    }
    catch(err){
        fail(res, err)
    }
})

// Ruta anterior, se mantiene por compatibilidad
router.get('/torneo/:torId', (req,res) => {
    try{
        const result = manager.getTorneoById(req.params.torId)

        if (result.error) return res.status(404).json(result);

        res.json(result)
    }
    catch(err){
        fail(res, err)
    }
})

router.post('/', requireAuth, conOrganizacion, (req, res) => {
    const { error, datos } = manager.sanitize(req.body);
    if (error) return res.status(400).json({ error });

    // organizador, organizadorId y equiposInscriptos los pone el servidor, nunca el cliente
    manager.addTor({
        whatsapp: req.org.whatsapp,
        ...datos,
        equiposInscriptos: 0,
        organizador: req.org.nombre,
        organizadorId: req.org.id,
    })
        .then(response => sendResult(res, response))
        .catch(err => fail(res, err));
})

router.put('/:torId', requireAuth, conOrganizacion, esDeMiOrganizacion, (req, res) => {
    const { error, datos } = manager.sanitize(req.body, { parcial: true });
    if (error) return res.status(400).json({ error });

    // El estado solo avanza (abierto/proximamente -> en curso -> finalizado). Volver atras permitiria,
    // por ejemplo, cambiar las reglas de pago de un torneo que ya empezo y despues ponerlo de nuevo "en curso"
    if (datos.estado !== undefined && ETAPA[datos.estado] < ETAPA[req.tor.estado]) {
        return res.status(400).json({ error: 'Un torneo que ya empezó o terminó no puede volver a un estado anterior' });
    }

    // La edad de cada jugador se calcula al dia de inicio: moverlo con equipos anotados podria dejar
    // dentro del limite a alguien que no lo cumple (o afuera a alguien que si)
    if (datos.fechaInicio !== undefined && datos.fechaInicio !== req.tor.fechaInicio
        && req.tor.limiteEdad && req.tor.equiposInscriptos > 0) {
        return res.status(400).json({ error: 'La fecha de inicio no se puede cambiar porque el torneo tiene límite de edad y ya hay equipos inscriptos' });
    }

    // Las reglas de pago quedan fijas cuando el torneo empieza, para no cambiarlas a mitad de camino
    if (datos.reglasPago && ['en-curso', 'finalizado'].includes(req.tor.estado)) {
        return res.status(400).json({ error: 'Las reglas de pago no se pueden cambiar una vez que el torneo empezó' });
    }

    // Cambiar el limite de edad con equipos ya anotados dejaria afuera a alguno que se inscribio cumpliendo
    if (datos.limiteEdad !== undefined && req.tor.equiposInscriptos > 0
        && JSON.stringify(datos.limiteEdad) !== JSON.stringify(req.tor.limiteEdad ?? null)) {
        return res.status(400).json({ error: 'El límite de edad no se puede cambiar porque ya hay equipos inscriptos' });
    }

    if (datos.equiposMax !== undefined && datos.equiposMax < req.tor.equiposInscriptos) {
        return res.status(400).json({ error: `Ya hay ${req.tor.equiposInscriptos} equipos inscriptos: el cupo no puede ser menor` });
    }

    manager.editTor(req.params.torId, datos)
        .then(response => sendResult(res, response))
        .catch(err => fail(res, err));
})

router.delete('/:torId', requireAuth, conOrganizacion, esDeMiOrganizacion, (req, res) => {
    if (req.tor.equiposInscriptos > 0) {
        return res.status(400).json({ error: 'No se puede eliminar un torneo con equipos inscriptos' });
    }

    manager.deleteTor(req.params.torId)
        .then(() => res.json({ ok: true }))
        .catch(err => fail(res, err));
})

export default router;
