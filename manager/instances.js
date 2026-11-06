import { dataPath } from '../config.js';
import TorneosManager from './torneosManager.js';
import EquiposManager from './equiposManager.js';
import OrganizadoresManager from './organizadoresManager.js';
import ClubesManager from './clubesManager.js';
import PartidosManager from './partidosManager.js';
import FechasManager from './fechasManager.js';
import UsuariosManager from './usuariosManager.js';
import InscripcionesManager from './inscripcionesManager.js';
import AmistososManager from './amistososManager.js';
import MultasManager from './multasManager.js';

export const torneosManager = new TorneosManager(dataPath('torneos.json'));
export const equiposManager = new EquiposManager(dataPath('equipos.json'));
export const organizadoresManager = new OrganizadoresManager(dataPath('organizadores.json'), torneosManager);
export const clubesManager = new ClubesManager(dataPath('clubes.json'), equiposManager, torneosManager);
export const usuariosManager = new UsuariosManager(dataPath('usuarios.json'));
export const partidosManager = new PartidosManager(dataPath('partidos.json'));
export const fechasManager = new FechasManager(dataPath('fechas.json'), equiposManager, partidosManager);
export const inscripcionesManager = new InscripcionesManager(dataPath('inscripciones.json'));
export const amistososManager = new AmistososManager(dataPath('amistosos.json'));
export const multasManager = new MultasManager(dataPath('multas.json'));

torneosManager.getTorneos();
equiposManager.getEquipos();
partidosManager.getPartidos();