import express from 'express';
import { fail } from './errores.js';

// Express 4 no atrapa los errores de las funciones async: si una consulta a la base falla, la promesa
// rechazada tumbaria el proceso. Este Router envuelve cada middleware y handler de las rutas para que,
// si algo falla, responda el error generico (fail) en vez de caerse.
const envolver = (fn) => {
    if (typeof fn !== 'function' || fn.length === 4) return fn; // los manejadores de errores (err, req, res, next) van tal cual
    return (req, res, next) => {
        try {
            const r = fn(req, res, next);
            if (r && typeof r.catch === 'function') r.catch((err) => (res.headersSent ? next(err) : fail(res, err)));
        } catch (err) {
            fail(res, err);
        }
    };
};

export const Router = () => {
    const router = express.Router();
    for (const metodo of ['get', 'post', 'put', 'patch', 'delete']) {
        const original = router[metodo].bind(router);
        router[metodo] = (ruta, ...handlers) => original(ruta, ...handlers.map(envolver));
    }
    return router;
};
