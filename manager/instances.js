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
import JugadoresManager from './jugadoresManager.js';

// Un solo manager de cada tipo para toda la API. Los datos viven en la base (db/index.js), no en memoria:
// solo quedan en memoria los candados de pagos en curso y los intentos de contraseña.
export const torneosManager = new TorneosManager();
export const equiposManager = new EquiposManager();
export const organizadoresManager = new OrganizadoresManager();
export const clubesManager = new ClubesManager();
export const usuariosManager = new UsuariosManager();
export const partidosManager = new PartidosManager();
export const fechasManager = new FechasManager();
export const inscripcionesManager = new InscripcionesManager();
export const amistososManager = new AmistososManager();
export const multasManager = new MultasManager();
export const jugadoresManager = new JugadoresManager();
