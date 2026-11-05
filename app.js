import express from "express";
import cors from "cors";
import fs from "fs";

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

const app = express();
const port = 4000;

app.use(express.json());
app.use(express.urlencoded({extended:true}));
app.use(cors());

app.get('/', (req, res) => {
    res.sendFile('/src/index.html', {root: '.'});
})

fs.mkdirSync('./uploads', { recursive: true });

app.use('/uploads', express.static('uploads', { setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff') }));
app.use('/uploads', uploadsRouter);
app.use('/clubes', clubesRouter);
app.use('/torneos', torneosRouter);
app.use('/equipos', equiposRouter);
app.use('/partidos', partidosRouter);
app.use('/fechas', fechasRouter);
app.use('/jugadores', jugadoresRouter);
app.use('/inscripciones', inscripcionesRouter);
app.use('/organizadores', organizadoresRouter);
app.use('/auth', authRouter);

app.listen(port,() => {
    console.log("Server listening in port: " + port);
})