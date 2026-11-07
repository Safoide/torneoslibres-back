import { Router } from '../middleware/router.js';
import { usuarioOpcional } from '../middleware/auth.js';
import { limiteContacto } from '../middleware/limites.js';
import { usuariosManager } from '../manager/instances.js';
import { enviarMail } from '../services/mailService.js';

// Formulario de contacto (/contacto en el front): manda el mensaje por mail a nuestra casilla
// (contacto@torneoslibres.com, que recibe Resend; CONTACTO_EMAIL la cambia), con "responder a" el email de quien
// escribió. Nunca se le manda nada a ese email (si no, el formulario serviría para mandarle mails a cualquiera
// desde nuestro dominio).
const router = Router();

// En desarrollo va a un dominio de prueba: el mail se ve en la consola de la API
const DESTINO = process.env.CONTACTO_EMAIL?.trim()
    || (process.env.NODE_ENV === 'production' ? 'contacto@torneoslibres.com' : 'contacto@torneoslibres.test');

// Los mismos ids que el select del front (components/pages/Contacto.js)
export const MOTIVOS = {
    consulta: 'Consulta general',
    pagos: 'Pagos, multas o devoluciones',
    torneo: 'Problema con un torneo u organizador',
    organizar: 'Quiero publicar mis torneos',
    datos: 'Mis datos personales (acceso, corrección o baja)',
    error: 'Algo no funciona en la página',
    otro: 'Otro',
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const unaLinea = (v) => String(v ?? '').replace(/[\r\n\t]+/g, ' ').trim();

// body: { nombre, email, motivo, mensaje, sitioWeb }. sitioWeb es una trampa para robots: el campo está oculto
// y una persona nunca lo completa (si viene lleno se responde ok sin mandar nada)
router.post('/', limiteContacto, usuarioOpcional, async (req, res) => {
    const b = req.body ?? {};
    if (unaLinea(b.sitioWeb)) return res.json({ ok: true });

    const nombre = unaLinea(b.nombre).slice(0, 80);
    const email = unaLinea(b.email).toLowerCase();
    const mensaje = String(b.mensaje ?? '').replace(/\r\n/g, '\n').trim();

    if (nombre.length < 2) return res.status(400).json({ error: 'Escribí tu nombre' });
    if (!EMAIL.test(email) || email.length > 120) return res.status(400).json({ error: 'Revisá el email: ahí te vamos a responder' });
    if (!MOTIVOS[b.motivo]) return res.status(400).json({ error: 'Elegí el motivo del mensaje' });
    if (mensaje.length < 10) return res.status(400).json({ error: 'Contanos un poco más en el mensaje' });
    if (mensaje.length > 3000) return res.status(400).json({ error: 'El mensaje es muy largo (máximo 3000 caracteres)' });

    // Si escribió con la sesión iniciada, va la cuenta (ayuda a encontrar el caso; el email puede ser otro)
    const cuenta = req.userId ? await usuariosManager.getRaw(req.userId) : null;
    const datos = [
        `Nombre: ${nombre}`,
        `Email: ${email}`,
        `Motivo: ${MOTIVOS[b.motivo]}`,
        cuenta ? `Cuenta: ${cuenta.id} (${cuenta.rol}, ${cuenta.email})` : 'Cuenta: sin sesión iniciada',
    ];

    const ok = await enviarMail({
        para: DESTINO,
        asunto: `[Contacto] ${MOTIVOS[b.motivo]} · ${nombre}`,
        texto: `${datos.join('\n')}\n\n${mensaje}\n\n--\nRespondé este mail para contestarle a ${email}.`,
        responderA: email,
    });
    if (!ok) return res.status(502).json({ error: 'No pudimos mandar el mensaje. Probá de nuevo en un rato o escribinos directo por mail.' });

    res.json({ ok: true });
});

export default router;
