import { organizadoresManager, torneosManager } from '../manager/instances.js';

// Exige que el usuario tenga organizacion y la deja en req.org
export const conOrganizacion = async (req, res, next) => {
    const org = await organizadoresManager.miOrganizacion(req.userId);

    if (!org) return res.status(403).json({ error: 'Primero tenés que crear tu organización' });

    req.org = org;
    next();
};

// Devuelve el torneo si es de la organizacion de req.org; si no, { error, status }
export const miTorneo = async (req, torId) => {
    const tor = await torneosManager.getTorneoById(torId);

    if (tor.error) return { error: tor.error, status: 404 };
    if (tor.organizadorId !== req.org.id) return { error: 'Este torneo no es de tu organización', status: 403 };

    return { tor };
};
