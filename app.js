import express from "express";
import cors from "cors";
import helmet from "helmet";
import { limiteGeneral } from "./middleware/limites.js";
import { UPLOADS_DIR } from "./config.js";

import clubesRouter from "./routes/clubes.route.js";
import uploadsRouter from "./routes/uploads.route.js";
import torneosRouter from "./routes/torneos.route.js";
import equiposRouter from "./routes/equipos.route.js";
import fechasRouter from "./routes/fechas.route.js";
import partidosRouter from "./routes/partidos.route.js";
import jugadoresRouter from "./routes/jugadores.route.js";
import inscripcionesRouter from "./routes/inscripciones.route.js";
import organizadoresRouter from "./routes/organizadores.route.js";
import authRouter from "./routes/auth.route.js";
import amistososRouter from "./routes/amistosos.route.js";
import multasRouter from "./routes/multas.route.js";
import { procesarVencimientos } from "./services/vencimientosService.js";
import { procesarEstados } from "./services/estadosService.js";
import { migrar, copiarBase, DB_FILE } from "./db/index.js";
import { importarJsonViejos } from "./db/importarJson.js";

// Crea o actualiza la estructura de la base antes de atender pedidos (en produccion arranca vacia)
await migrar();
// Si la base está vacía y quedaron los JSON de antes en DATA_DIR, los pasa a la base (una sola vez)
try {
    await importarJsonViejos();
} catch (err) {
    console.error("No se pudieron importar los JSON viejos (la base sigue vacía y los JSON quedan como estaban):", err);
}
console.log("Base de datos: " + DB_FILE);

const app = express();
const port = process.env.PORT || 4000; // en el hosting (Render, etc.) el puerto lo asigna el servicio

// En el servidor los pedidos llegan por nginx (en la misma máquina): confiamos en su X-Forwarded-For
// para ver la IP real del usuario (la usan los límites de pedidos). Solo se confía en proxies locales.
app.set('trust proxy', 'loopback');

// Headers de seguridad. 'same-site' deja que el front (otro puerto en desarrollo) muestre los logos de /uploads
app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }));
app.use(limiteGeneral);

app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));
// En producción solo acepta pedidos del dominio del front (CORS_ORIGIN, separados por coma); en desarrollo, todos
const origenes = process.env.CORS_ORIGIN?.split(',').map((o) => o.trim()).filter(Boolean);
app.use(cors(origenes?.length ? { origin: origenes } : undefined));

app.get('/', (req, res) => {
    res.sendFile('/src/index.html', {root: '.'});
})

app.use('/uploads', express.static(UPLOADS_DIR, { setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff') }));
app.use('/uploads', uploadsRouter);
app.use('/clubes', clubesRouter);
app.use('/torneos', torneosRouter);
app.use('/equipos', equiposRouter);
app.use('/partidos', partidosRouter);
app.use('/fechas', fechasRouter);
app.use('/jugadores', jugadoresRouter);
app.use('/inscripciones', inscripcionesRouter);
app.use('/organizadores', organizadoresRouter);
app.use('/amistosos', amistososRouter);
app.use('/multas', multasRouter);
app.use('/auth', authRouter);

app.use((req, res) => res.status(404).json({ error: 'No existe esa ruta' }));

// Errores que no atrapa ninguna ruta (por ejemplo un JSON mal formado): sin mostrar el detalle interno
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
    const status = err.status || err.statusCode || 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status === 413 ? 'Los datos enviados son demasiado grandes' : status < 500 ? 'Los datos enviados no son válidos' : 'Ocurrió un error en el servidor. Probá de nuevo en un rato.' });
});

// En el servidor HOST=127.0.0.1: solo nginx llega a la API (el puerto 4000 no queda abierto a internet)
app.listen(port, process.env.HOST || undefined, () => {
    console.log("Server listening in port: " + port);
})

// Cada minuto (y al arrancar): estados de los torneos (cierre de inscripción e inicio automáticos)
// y pagos de fechas vencidos (W.O. y amistosos express)
const vencer = () => procesarEstados()
    .catch(err => console.error('Error actualizando estados de torneos:', err))
    .then(() => procesarVencimientos())
    .catch(err => console.error('Error procesando vencimientos:', err));
vencer();
setInterval(vencer, 60 * 1000);

// Copia consistente de la base cada hora (el backup diario del servidor se la lleva junto con DATA_DIR)
const copiar = () => copiarBase().catch(err => console.error('Error copiando la base:', err));
copiar();
setInterval(copiar, 60 * 60 * 1000);