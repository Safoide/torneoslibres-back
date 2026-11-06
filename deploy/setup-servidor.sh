#!/usr/bin/env bash
# Prepara el Cloud Server (Ubuntu 22.04 / 24.04) para Torneos Libres. Se corre UNA sola vez, como root:
#   bash setup-servidor.sh torneoslibres.com torneoslibres.com.ar
# El primer dominio es el principal; el segundo (opcional) redirige al primero.
set -euo pipefail

DOMINIO="${1:?Uso: bash setup-servidor.sh dominio-principal [dominio-que-redirige]}"
EXTRA="${2:-}"
BASE=/srv/torneoslibres

echo "==> Paquetes"
apt-get update
apt-get install -y nginx rsync curl ufw certbot python3-certbot-nginx
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs
npm install -g pm2

echo "==> Usuario deploy (GitHub Actions entra con este usuario, no con root)"
id deploy >/dev/null 2>&1 || adduser --disabled-password --gecos "" deploy
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
touch /home/deploy/.ssh/authorized_keys
mkdir -p "$BASE"/{api,front,data,uploads,backups}

if [ ! -f "$BASE/.env" ]; then
  cat > "$BASE/.env" <<EOF
NODE_ENV=production
PORT=4000
HOST=127.0.0.1
JWT_SECRET=$(openssl rand -hex 32)
DATA_DIR=$BASE/data
UPLOADS_DIR=$BASE/uploads
CORS_ORIGIN=https://$DOMINIO,https://www.$DOMINIO
EOF
fi
chmod 600 "$BASE/.env"
chown -R deploy:deploy "$BASE" /home/deploy/.ssh
chmod 600 /home/deploy/.ssh/authorized_keys

echo "==> nginx"
# Headers de seguridad del sitio. Van en un snippet porque nginx descarta los add_header del server
# en cada location que define los suyos: hay que incluirlo en todas. Se reescribe siempre (no pisa nada de certbot).
mkdir -p /etc/nginx/snippets
cat > /etc/nginx/snippets/torneoslibres-headers.conf <<'EOF2'
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "DENY" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
EOF2

if [ -f /etc/nginx/sites-available/torneoslibres ]; then
  echo "   Ya estaba configurado (y quizás con HTTPS de certbot): no lo toco."
  echo "   Si todavía no incluye los headers de seguridad, agregá 'include snippets/torneoslibres-headers.conf;'"
  echo "   en el server y en las location /static/ y = /index.html, y corré: nginx -t && systemctl reload nginx"
else
cat > /etc/nginx/sites-available/torneoslibres <<EOF
server {
    listen 80;
    server_name $DOMINIO www.$DOMINIO;
    root $BASE/front;
    index index.html;
    client_max_body_size 3m;
    server_tokens off;
    include snippets/torneoslibres-headers.conf;

    # La API: torneoslibres.com/api/... -> Node en el puerto 4000
    location /api/ {
        proxy_pass http://127.0.0.1:4000/;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        # Estos headers ya los pone nginx (snippet): se sacan los de la API para que no lleguen duplicados
        proxy_hide_header Strict-Transport-Security;
        proxy_hide_header X-Content-Type-Options;
        proxy_hide_header X-Frame-Options;
        proxy_hide_header Referrer-Policy;
    }

    # Archivos del build con hash en el nombre: se cachean para siempre
    location /static/ {
        expires 1y;
        include snippets/torneoslibres-headers.conf;
        add_header Cache-Control "public, immutable";
    }

    # index.html nunca se cachea, así cada deploy se ve al instante
    location = /index.html {
        include snippets/torneoslibres-headers.conf;
        add_header Cache-Control "no-cache";
    }

    # Rutas de React (/torneos, /amistosos/123...): siempre index.html
    location / {
        try_files \$uri /index.html;
    }
}
EOF
if [ -n "$EXTRA" ]; then
  cat >> /etc/nginx/sites-available/torneoslibres <<EOF

server {
    listen 80;
    server_name $EXTRA www.$EXTRA;
    return 301 https://$DOMINIO\$request_uri;
}
EOF
fi
ln -sf /etc/nginx/sites-available/torneoslibres /etc/nginx/sites-enabled/torneoslibres
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
fi

echo "==> pm2 arranca solo al reiniciar el servidor"
pm2 startup systemd -u deploy --hp /home/deploy >/dev/null

echo "==> Backup diario de los datos (04:00, se guardan 14 días en $BASE/backups)"
cat > /etc/cron.d/torneoslibres-backup <<EOF
0 4 * * * deploy tar -czf $BASE/backups/datos-\$(date +\\%F).tar.gz -C $BASE data uploads && find $BASE/backups -name 'datos-*.tar.gz' -mtime +14 -delete
EOF

echo "==> Firewall"
SSH_PORT=$(ss -tlnpH 2>/dev/null | awk '/"sshd"/{n=split($4,a,":"); print a[n]; exit}' || true)
if [ -n "$SSH_PORT" ]; then
  ufw allow "$SSH_PORT/tcp"
  [ -n "${SSH_PORT_EXTERNO:-}" ] && ufw allow "$SSH_PORT_EXTERNO/tcp"
  ufw allow 'Nginx Full'
  ufw --force enable
else
  echo "   No pude detectar el puerto de SSH: dejo el firewall como estaba."
fi

echo "==> Clave para GitHub Actions"
KEY=$(mktemp -u)
ssh-keygen -t ed25519 -N "" -C "github-actions-torneoslibres" -f "$KEY" >/dev/null
cat "$KEY.pub" >> /home/deploy/.ssh/authorized_keys
echo
echo "================================================================"
echo " Copiá TODO lo que sigue (incluidas las líneas BEGIN/END) y pegalo"
echo " como secret SSH_KEY en los DOS repos de GitHub:"
echo "================================================================"
cat "$KEY"
rm -f "$KEY" "$KEY.pub"
echo "================================================================"
echo " SSH_HOST = $(curl -s -4 ifconfig.me || echo 'la IP del servidor')"
echo " SSH_PORT = ${SSH_PORT:-22}"
echo
echo " Cuando el DNS ya apunte a este servidor, corré:"
CERT="-d $DOMINIO -d www.$DOMINIO"
[ -n "$EXTRA" ] && CERT="$CERT -d $EXTRA -d www.$EXTRA"
echo "   certbot --nginx $CERT --redirect"
echo "================================================================"
