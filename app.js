import express from "express";
import cors from "cors";
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

const app = express();
const port = process.env.PORT || 4000; // en el hosting (Render, etc.) el puerto lo asigna el servicio

app.use(express.json());
app.use(express.urlencoded({extended:true}));
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

// En el servidor HOST=127.0.0.1: solo nginx llega a la API (el puerto 4000 no queda abierto a internet)
app.listen(port, process.env.HOST || undefined, () => {
    console.log("Server listening in port: " + port);
})

// Pagos de fechas vencidos (W.O. y amistosos express): al arrancar y despues cada minuto
const vencer = () => procesarVencimientos().catch(err => console.error('Error procesando vencimientos:', err));
vencer();
setInterval(vencer, 60 * 1000);