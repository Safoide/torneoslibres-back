import { SITIO_URL } from '../config.js';

// Envío de mails con Resend (https://resend.com). Usa la API HTTP directo (sin dependencias).
// Variables: RESEND_API_KEY (sin ella, en desarrollo el mail se muestra en la consola) y
// MAIL_FROM (por ejemplo "Torneos Libres <no-responder@torneoslibres.com>", del dominio verificado en Resend).
// Nunca llamarlo dentro de una transacción (es lento).

const API_KEY = process.env.RESEND_API_KEY;
const FROM = process.env.MAIL_FROM || 'Torneos Libres <no-responder@torneoslibres.com>';
const PRODUCCION = process.env.NODE_ENV === 'production';

if (!API_KEY && PRODUCCION) console.warn('Falta RESEND_API_KEY: los mails no se van a enviar');

// Resend acepta ~2 envíos por segundo: los mails salen de a uno, con una pausa entre cada uno
const PAUSA_MS = 600;
let cola = Promise.resolve();
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

// Devuelve true si se envió (o se mostró en la consola en desarrollo). Nunca tira error: lo registra.
// headers: encabezados extra (por ejemplo List-Unsubscribe en los avisos)
export const enviarMail = (mail) => {
    const envio = cola.then(() => enviarAhora(mail));
    cola = envio.then(() => (API_KEY ? espera(PAUSA_MS) : null));
    return envio;
};

// Dominios de prueba (cuentas de casos-prueba / seed): no existen, mandarles rebota y le baja la reputación al dominio
const DE_PRUEBA = /@[^@]+\.(test|example|invalid|localhost)$/i;

const enviarAhora = async ({ para, asunto, texto, html, headers }) => {
    if (!API_KEY || (!PRODUCCION && DE_PRUEBA.test(para))) {
        if (PRODUCCION) return false;
        console.log(`\n--- Mail (no se envía: sin RESEND_API_KEY o email de prueba) ---\nPara: ${para}\nAsunto: ${asunto}\n\n${texto}\n----------------------------------------------\n`);
        return true;
    }

    try {
        const res = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ from: FROM, to: [para], subject: asunto, text: texto, html, ...(headers ? { headers } : {}) }),
            signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) {
            console.error(`Resend respondió ${res.status}:`, await res.text().catch(() => ''));
            return false;
        }
        return true;
    } catch (err) {
        console.error('No se pudo enviar el mail:', err);
        return false;
    }
};

const escapar = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- Diseño ----------
// Colores fijos a propósito: los clientes de mail no leen las variables de theme.css. Son los del sitio:
// encabezado como el tema oscuro (con el logo) y el contenido en claro, que se lee bien en cualquier cliente.
// Maquetado con tablas y estilos en línea (Outlook y Gmail ignoran casi todo el CSS moderno).
const C = {
    fondo: '#eef1f5', tarjeta: '#ffffff', encabezado: '#0d1117', texto: '#121a26', suave: '#4a5465', tenue: '#7a8394',
    borde: '#e2e6ec', acento: '#0f8a47', acentoTexto: '#ffffff', detalleFondo: '#f5f7fa',
};
const FUENTE = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

// Logo en PNG (Gmail y Outlook no muestran SVG). Está en el front: public/email/logo.png.
// En desarrollo se usa el del sitio publicado (un cliente de mail no puede abrir localhost)
const LOGO_URL = process.env.MAIL_LOGO_URL
    || `${/^http:\/\/(localhost|127\.)/.test(SITIO_URL) ? 'https://torneoslibres.com' : SITIO_URL}/email/logo.png`;
const AJUSTES_URL = `${SITIO_URL}/cuenta/ajustes#notificaciones`;
const SITIO_TEXTO = SITIO_URL.replace(/^https?:\/\//, '');

// Mail con el diseño del sitio.
//  parrafos: textos; detalles: [[etiqueta, valor], ...] (por ejemplo día, hora y cancha)
//  boton + link: la acción principal; pie: aclaración debajo del botón
//  baja: { texto, link } en los avisos (footer con "Dejar de recibir este aviso" y "Configurar notificaciones").
//  Sin baja (mails de seguridad), el footer aclara que llegan siempre.
export const plantilla = ({ titulo, parrafos = [], detalles = [], boton, link, pie, baja }) => {
    const resumen = escapar(parrafos[0] ?? titulo); // lo que muestra la bandeja de entrada al lado del asunto

    const cuerpo = [
        `<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;font-weight:800;color:${C.texto}">${escapar(titulo)}</h1>`,
        ...parrafos.map((p) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:${C.suave}">${escapar(p)}</p>`),
        detalles.length ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 18px;background:${C.detalleFondo};border:1px solid ${C.borde};border-radius:10px;border-collapse:separate">
${detalles.map(([k, v], i) => `<tr><td style="padding:10px 14px;${i ? `border-top:1px solid ${C.borde};` : ''}font-size:13px;color:${C.tenue};white-space:nowrap;vertical-align:top;width:1%">${escapar(k)}</td><td style="padding:10px 14px 10px 0;${i ? `border-top:1px solid ${C.borde};` : ''}font-size:14px;font-weight:700;color:${C.texto}">${escapar(v)}</td></tr>`).join('\n')}
</table>` : '',
        link ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0 8px"><tr><td style="border-radius:10px;background:${C.acento}">
<a href="${escapar(link)}" style="display:inline-block;padding:13px 24px;font-size:15px;font-weight:700;color:${C.acentoTexto};text-decoration:none;border-radius:10px">${escapar(boton)}</a>
</td></tr></table>` : '',
        pie ? `<p style="margin:16px 0 0;font-size:13px;line-height:1.55;color:${C.suave}">${escapar(pie)}</p>` : '',
        link ? `<p style="margin:18px 0 0;font-size:12px;line-height:1.5;color:${C.tenue}">Si el botón no funciona, copiá este link en el navegador:<br><a href="${escapar(link)}" style="color:${C.tenue};word-break:break-all">${escapar(link)}</a></p>` : '',
    ].join('\n');

    const footer = baja
        ? `${escapar(baja.texto)}<br><a href="${escapar(baja.link)}" style="color:${C.suave};text-decoration:underline">Dejar de recibir este aviso</a>&nbsp;&nbsp;·&nbsp;&nbsp;<a href="${AJUSTES_URL}" style="color:${C.suave};text-decoration:underline">Configurar notificaciones</a>`
        : 'Es un mail de seguridad de tu cuenta: te llega siempre, aunque desactives los avisos.';

    return `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escapar(titulo)}</title></head>
<body style="margin:0;padding:0;background:${C.fondo};font-family:${FUENTE};-webkit-font-smoothing:antialiased">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${resumen}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.fondo}"><tr><td align="center" style="padding:28px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
<tr><td style="background:${C.encabezado};border-radius:14px 14px 0 0;padding:22px 28px">
<a href="${SITIO_URL}" style="text-decoration:none"><img src="${LOGO_URL}" width="200" height="41" alt="Torneos Libres" style="display:block;border:0;width:200px;height:auto;color:#eef1f6;font-size:20px;font-weight:800"></a>
</td></tr>
<tr><td style="background:${C.tarjeta};padding:30px 28px 28px;border-radius:0 0 14px 14px">
${cuerpo}
</td></tr>
<tr><td style="padding:22px 28px 6px;text-align:center;font-size:12px;line-height:1.7;color:${C.tenue}">
${footer}
</td></tr>
<tr><td style="padding:6px 28px 0;text-align:center;font-size:12px;line-height:1.6;color:${C.tenue}">
<a href="${SITIO_URL}" style="color:${C.tenue};text-decoration:none;font-weight:700">Torneos Libres</a> · Torneos de fútbol 5, 7, 8 y 11 en Buenos Aires<br>
Mail automático: no lo respondas. · <a href="${SITIO_URL}" style="color:${C.tenue}">${SITIO_TEXTO}</a>
</td></tr>
</table>
</td></tr></table>
</body></html>`;
};

// Versión en texto (para los clientes que no muestran HTML)
export const textoPlano = ({ titulo, parrafos = [], detalles = [], boton, link, pie, baja }) => [
    titulo, '', ...parrafos.flatMap((p) => [p, '']),
    ...(detalles.length ? [...detalles.map(([k, v]) => `${k}: ${v}`), ''] : []),
    ...(link ? [`${boton}: ${link}`, ''] : []),
    ...(pie ? [pie, ''] : []),
    '--',
    ...(baja
        ? [baja.texto, `Dejar de recibir este aviso: ${baja.link}`, `Configurar notificaciones: ${AJUSTES_URL}`]
        : ['Es un mail de seguridad de tu cuenta: te llega siempre, aunque desactives los avisos.']),
    `Torneos Libres · ${SITIO_TEXTO} · Mail automático: no lo respondas.`,
].join('\n').trim();
