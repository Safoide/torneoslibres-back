import express from "express";
import cors from "cors";

import torneosRouter from "./routes/torneos.route.js";
import equiposRouter from "./routes/equipos.route.js";
import partidosRouter from "./routes/partidos.route.js";


const app = express();
const port = 4000;

app.use(express.json());
app.use(express.urlencoded({extended:true}));
app.use(cors());

app.get('/', (req, res) => {
    res.sendFile('/src/index.html', {root: '.'});
})

app.use('/torneos', torneosRouter);
app.use('/equipos', equiposRouter);
app.use('/partidos', partidosRouter);

app.listen(port,() => {
    console.log("Server listening in port: " + port);
})