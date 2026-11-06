import { Router } from '../middleware/router.js';
import { torneosManager as manager, fechasManager } from '../manager/instances.js';
import { reglasDe, errorCierre } from '../manager/torneosManager.js';
import { requireAuth, requireRol } from '../middleware/auth.js';
import { conOrganizacion } from '../middleware/organizador.js';
import { cambiarEstado } from '../services/estadosService.js';

const router = Router();

const EMPEZADO = ['en-curso', 'finalizado'];
const tieneFechas = async (torId) => (await fechasManager.filasDeTorneo([torId])).length > 0;

const sendResult = (res, result) => {
    if (result && result.error) return res.status(400).json(result);
    res.json(result);
};

// Exige que el torneo sea de la organizacion del usuario (req.org, de conOrganizacion) y lo deja en req.tor
const esDeMiOrganizacion = async (req, res, next) => {
    const tor = await manager.getTorneoById(req.params.torId);

    if (tor.error) return res.status(404).json(tor);
    if (tor.organizadorId !== req.org.id) return res.status(403).json({ error: 'Este torneo no es de tu organización' });

    req.tor = tor;
    next();
};

const soloOrganizador = [requireAuth, requireRol('organizador'), conOrganizacion];

// GET /torneos?modalidad=f5,f7&zona=Palermo&estado=inscripcion-abierta&precioMax=50000&q=copa&orden=precio
router.get('/', async (req, res) => {
    res.json(await manager.searchTorneos(req.query));
});

// Valores disponibles para los filtros (zonas, modalidades, etc.)
router.get('/filtros', async (req, res) => {
    res.json(await manager.getFiltros());
});

router.get('/:torId', async (req, res) => {
    const result = await manager.getTorneoById(req.params.torId);
    if (result.error) return res.status(404).json(result);

    // Las reglas de pago resueltas (los torneos viejos no las tienen guardadas y usan las default)
    res.json({ ...result, reglasPago: reglasDe(result) });
});

// Ruta anterior, se mantiene por compatibilidad
router.get('/torneo/:torId', async (req, res) => {
    const result = await manager.getTorneoById(req.params.torId);
    if (result.error) return res.status(404).json(result);

    res.json(result);
});

router.post('/', ...soloOrganizador, async (req, res) => {
    const { error, datos } = manager.sanitize(req.body);
    if (error) return res.status(400).json({ error });

    // El cierre de inscripción tiene que respetar el inicio y el cobro por fecha, y no puede haber pasado
    const errC = errorCierre(datos, { exigirFuturo: true });
    if (errC) return res.status(400).json({ error: errC });

    // organizador, organizadorId y equiposInscriptos los pone el servidor, nunca el cliente
    sendResult(res, await manager.addTor({
        whatsapp: req.org.whatsapp,
        ...datos,
        equiposInscriptos: 0,
        organizador: req.org.nombre,
        organizadorId: req.org.id,
    }));
});

router.put('/:torId', ...soloOrganizador, esDeMiOrganizacion, async (req, res) => {
    const { error, datos } = manager.sanitize(req.body, { parcial: true });
    if (error) return res.status(400).json({ error });

    // El estado no se edita acá (sanitize lo rechaza): va por PUT /torneos/:id/estado

    // Inicio, cierre de inscripción y precio por fecha: se pueden cambiar mientras no haya fechas creadas ni haya
    // empezado (las fechas ya se armaron con esos datos). Juntos tienen que seguir siendo coherentes
    const cambia = (c) => datos[c] !== undefined && datos[c] !== req.tor[c];
    if (['fechaInicio', 'cierreInscripcion', 'precioFecha'].some(cambia)) {
        if (EMPEZADO.includes(req.tor.estado)) return res.status(400).json({ error: 'El torneo ya empezó: el inicio, el cierre de inscripción y el precio por fecha no se pueden cambiar' });
        if (await tieneFechas(req.tor.id)) return res.status(400).json({ error: 'Ya hay fechas creadas: el inicio, el cierre de inscripción y el precio por fecha no se pueden cambiar' });

        // Si el cierre era el automático y no mandan otro, sigue siendo automático (se mueve con el inicio)
        if (datos.cierreInscripcion === undefined && req.tor.cierreAutomatico) datos.cierreInscripcion = null;

        const errC = errorCierre({ ...req.tor, ...datos }, {
            // Con la inscripción abierta o sin abrir, el cierre no puede quedar en el pasado
            exigirFuturo: ['inscripcion-abierta', 'proximamente'].includes(req.tor.estado),
        });
        if (errC) return res.status(400).json({ error: errC });
    }

    // La edad de cada jugador se calcula al dia de inicio: moverlo con equipos anotados podria dejar
    // dentro del limite a alguien que no lo cumple (o afuera a alguien que si)
    if (datos.fechaInicio !== undefined && datos.fechaInicio !== req.tor.fechaInicio
        && req.tor.limiteEdad && req.tor.equiposInscriptos > 0) {
        return res.status(400).json({ error: 'La fecha de inicio no se puede cambiar porque el torneo tiene límite de edad y ya hay equipos inscriptos' });
    }

    // Las reglas de pago quedan fijas cuando se crea la primera fecha (cada fecha guarda una copia) o empieza el torneo
    if (datos.reglasPago && (EMPEZADO.includes(req.tor.estado) || await tieneFechas(req.tor.id))) {
        return res.status(400).json({ error: 'Las reglas de pago no se pueden cambiar una vez que hay fechas creadas o el torneo empezó' });
    }

    // Cambiar el limite de edad con equipos ya anotados dejaria afuera a alguno que se inscribio cumpliendo
    if (datos.limiteEdad !== undefined && req.tor.equiposInscriptos > 0
        && JSON.stringify(datos.limiteEdad) !== JSON.stringify(req.tor.limiteEdad ?? null)) {
        return res.status(400).json({ error: 'El límite de edad no se puede cambiar porque ya hay equipos inscriptos' });
    }

    if (datos.equiposMax !== undefined && datos.equiposMax < req.tor.equiposInscriptos) {
        return res.status(400).json({ error: `Ya hay ${req.tor.equiposInscriptos} equipos inscriptos: el cupo no puede ser menor` });
    }

    sendResult(res, await manager.editTor(req.params.torId, datos));
});

// Cambiar el estado: abrir, volver a "próximamente", cerrar o reabrir la inscripción, finalizar.
// body: { estado }. Las reglas de cada cambio están en services/estadosService.js
router.put('/:torId/estado', ...soloOrganizador, esDeMiOrganizacion, async (req, res) => {
    sendResult(res, await cambiarEstado(req.tor, String(req.body?.estado ?? '')));
});

router.delete('/:torId', ...soloOrganizador, esDeMiOrganizacion, async (req, res) => {
    if (req.tor.equiposInscriptos > 0) {
        return res.status(400).json({ error: 'No se puede eliminar un torneo con equipos inscriptos' });
    }

    sendResult(res, await manager.deleteTor(req.params.torId));
});

export default router;
