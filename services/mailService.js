// Envío de mails con Resend (https://resend.com). Usa la API HTTP directo (sin dependencias).
// Variables: RESEND_API_KEY (sin ella, en desarrollo el mail se muestra en la consola) y
// MAIL_FROM (por ejemplo "Torneos Libres <no-responder@torneoslibres.com>", del dominio verificado en Resend).
// Nunca llamarlo dentro de una transacción (es lento).

const API_KEY = process.env.RESEND_API_KEY;
const FROM = process.env.MAIL_FROM || 'Torneos Libres <no-responder@torneoslibres.com>';
const PRODUCCION = process.env.NODE_ENV === 'production';

if (!API_KEY && PRODUCCION) console.warn('Falta RESEND_API_KEY: los mails no se van a enviar');

// Devuelve true si se envió (o se mostró en la consola en desarrollo). Nunca tira error: lo registra.
export const enviarMail = async ({ para, asunto, texto, html }) => {
    if (!API_KEY) {
        if (PRODUCCION) return false;
        console.log(`\n--- Mail (sin RESEND_API_KEY, no se envía) ---\nPara: ${para}\nAsunto: ${asunto}\n\n${texto}\n----------------------------------------------\n`);
        return true;
    }

    try {
        const res = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ from: FROM, to: [para], subject: asunto, text: texto, html }),
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

// Mail simple con un botón. Colores fijos a propósito: los clientes de mail no leen las variables de theme.css
export const plantilla = ({ titulo, parrafos, boton, link, pie }) => `<!DOCTYPE html>
<html lang="es"><body style="margin:0;padding:24px;background:#f4f5f7;font-family:Arial,Helvetica,sans-serif;color:#1d2129">
<div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:12px;padding:28px">
<p style="margin:0 0 16px;font-weight:bold;color:#16a34a">Torneos Libres</p>
<h1 style="margin:0 0 16px;font-size:20px">${escapar(titulo)}</h1>
${parrafos.map((p) => `<p style="margin:0 0 14px;line-height:1.5">${escapar(p)}</p>`).join('')}
<p style="margin:24px 0"><a href="${escapar(link)}" style="display:inline-block;background:#16a34a;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:bold">${escapar(boton)}</a></p>
<p style="margin:0 0 14px;font-size:13px;color:#5f6673;line-height:1.5">Si el botón no funciona, copiá este link en el navegador:<br><span style="word-break:break-all">${escapar(link)}</span></p>
${pie ? `<p style="margin:0;font-size:13px;color:#5f6673;line-height:1.5">${escapar(pie)}</p>` : ''}
</div></body></html>`;
