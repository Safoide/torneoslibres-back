// Error inesperado: el detalle queda en el log del servidor, al cliente le llega un mensaje genérico
// (el mensaje interno puede mostrar rutas de archivos o datos de cómo está armado el servidor)
export const fail = (res, err) => {
    console.error(err);
    res.status(500).json({ error: 'Ocurrió un error en el servidor. Probá de nuevo en un rato.' });
};
