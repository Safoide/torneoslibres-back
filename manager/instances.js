import TorneosManager from './torneosManager.js';
import EquiposManager from './equiposManager.js';
import OrganizadoresManager from './organizadoresManager.js';
import ClubesManager from './clubesManager.js';
import PartidosManager from './partidosManager.js';
import FechasManager from './fechasManager.js';
import UsuariosManager from './usuariosManager.js';
import InscripcionesManager from './inscripcionesManager.js';

export const torneosManager = new TorneosManager('./databases/torneos.json');
export const equiposManager = new EquiposManager('./databases/equipos.json');
export const organizadoresManager = new OrganizadoresManager('./databases/organizadores.json', torneosManager);
export const clubesManager = new ClubesManager('./databases/clubes.json', equiposManager, torneosManager);
export const usuariosManager = new UsuariosManager('./databases/usuarios.json');
export const partidosManager = new PartidosManager('./databases/partidos.json');
export const fechasManager = new FechasManager('./databases/fechas.json', equiposManager, partidosManager);
export const inscripcionesManager = new InscripcionesManager('./databases/inscripciones.json');

torneosManager.getTorneos();
equiposManager.getEquipos();
partidosManager.getPartidos();