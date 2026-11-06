// pm2: mantiene la API prendida en el servidor (y la vuelve a levantar si se cae o se reinicia la máquina).
// Las variables (JWT_SECRET, DATA_DIR, etc.) salen de /srv/torneoslibres/.env, que NO está en el repo.
module.exports = {
    apps: [{
        name: 'torneoslibres-api',
        cwd: '/srv/torneoslibres/api',
        script: 'app.js',
        node_args: '--env-file=/srv/torneoslibres/.env',
        max_memory_restart: '400M',
        time: true,
    }],
};
