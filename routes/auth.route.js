import { Router } from '../middleware/router.js';
import { usuariosManager as manager, clubesManager, organizadoresManager } from '../manager/instances.js';
import { requireAuth, signToken, firmaValida } from '../middleware/auth.js';
import { quiereMail, tituloDe } from '../services/notificacionesService.js';
import { limiteLoginIp, limiteLoginEmail, limiteRegistro, limiteGoogle, limiteRecuperarIp, limiteRecuperarEmail, limiteRestablecer, limiteVerificacion } from '../middleware/limites.js';
import { verificarGoogle } from '../services/googleService.js';
import { enviarMail, plantilla, textoPlano } from '../services/mailService.js';
import { SITIO_URL } from '../config.js';

const router = Router();

// Manda el link para verificar el email actual de la cuenta (en segundo plano: no frena la respuesta)
const mandarVerificacion = async (userId) => {
    const r = await manager.pedirVerificacion(userId);
    if (!r.token) return r;

    const link = `${SITIO_URL}/verificar#${r.token}`;
    const parrafos = [
        `Hola ${r.usuario.nombre}, confirmá que ${r.usuario.email} es tu email para terminar de configurar tu cuenta de Torneos Libres.`,
        'Así nos aseguramos de que te lleguen los avisos de tus torneos y de que puedas recuperar tu cuenta si olvidás la contraseña.',
    ];
    const pie = 'El link vale por 48 horas. Si no creaste una cuenta en Torneos Libres, ignorá este mail.';
    enviarMail({
        para: r.usuario.email,
        asunto: 'Confirmá tu email de Torneos Libres',
        texto: textoPlano({ titulo: 'Confirmá tu email', parrafos, boton: 'Confirmar mi email', link, pie }),
        html: plantilla({ titulo: 'Confirmá tu email', parrafos, boton: 'Confirmar mi email', link, pie }),
    });
    return { ok: true, email: r.usuario.email };
};

router.post('/register', limiteRegistro, async (req, res) => {
    const user = await manager.registrar(req.body);
    if (user.error) return res.status(400).json(user);

    mandarVerificacion(user.id).catch((err) => console.error('Error mandando la verificación de email:', err));
    res.status(201).json({ user, token: await signToken(user) });
});

// Verificar el email: reenviar el link (con la sesión iniciada) y usarlo (desde el mail, con o sin sesión).
// El token va en el # del link (/verificar#<token>), como el de recuperar contraseña
router.post('/verificar/enviar', requireAuth, limiteVerificacion, async (req, res) => {
    const r = await mandarVerificacion(req.userId);
    res.status(r.error ? 400 : 200).json(r);
});

router.post('/verificar', limiteRestablecer, async (req, res) => {
    const r = await manager.verificarEmail(req.body?.token);
    if (r.error) return res.status(400).json({ error: r.error });
    res.json({ ok: true, email: r.email });
});

router.post('/login', limiteLoginIp, limiteLoginEmail, async (req, res) => {
    const user = await manager.login(req.body);
    if (user.error) return res.status(401).json(user);

    res.json({ user, token: await signToken(user) });
});

// Entrar o registrarse con Google. body: { credential, rol? }
// credential = el access token que Google le da al front con nuestro boton (ver services/googleService.js). Si la cuenta no existe y no viene rol, responde
// { necesitaRol: true, email, nombre } para que el front pregunte el tipo de cuenta y reenvie el mismo credential.
router.post('/google', limiteGoogle, async (req, res) => {
    const perfil = await verificarGoogle(req.body?.credential);
    if (perfil.error) return res.status(perfil.status ?? 400).json({ error: perfil.error });

    // novedades y terminos solo se usan si crea la cuenta
    const r = await manager.entrarConGoogle(perfil, req.body?.rol, { novedades: req.body?.novedades, terminos: req.body?.terminos });
    if (r.error) return res.status(400).json(r);
    if (r.necesitaRol) return res.json(r);

    res.status(r.nueva ? 201 : 200).json({
        user: r.user, token: await signToken(r.user),
        nueva: !!r.nueva, vinculada: !!r.vinculada, passwordBorrada: !!r.passwordBorrada,
    });
});

// ---------- Recuperar contraseña ----------

// Pedir el link. Responde lo mismo exista o no la cuenta (no revela qué emails están registrados)
// y el mail se manda sin esperarlo, así la respuesta tarda igual en los dos casos.
// El token va en el # del link: el navegador no lo manda a ningún servidor ni en el Referer
router.post('/olvide', limiteRecuperarIp, limiteRecuperarEmail, async (req, res) => {
    const r = await manager.pedirRecuperacion(req.body?.email);
    if (r.error) return res.status(400).json({ error: r.error });

    if (r.token) {
        const link = `${SITIO_URL}/restablecer#${r.token}`;
        const extra = r.usuario.tienePassword ? [] : ['Tu cuenta entra con Google: con este link además le creás una contraseña.'];
        const parrafos = [`Hola ${r.usuario.nombre}, pediste cambiar la contraseña de tu cuenta de Torneos Libres.`, ...extra, 'El link vale por 1 hora y se puede usar una sola vez.'];
        const pie = 'Si no fuiste vos, ignorá este mail: tu contraseña no cambia.';

        enviarMail({
            para: r.usuario.email,
            asunto: 'Cambiá tu contraseña de Torneos Libres',
            texto: textoPlano({ titulo: 'Cambiá tu contraseña', parrafos, boton: 'Elegir contraseña nueva', link, pie }),
            html: plantilla({ titulo: 'Cambiá tu contraseña', parrafos, boton: 'Elegir contraseña nueva', link, pie }),
        });
    }

    res.json({ ok: true });
});

// Revisar el link antes de mostrar el formulario. body: { token }
router.post('/restablecer/revisar', limiteRestablecer, async (req, res) => {
    const r = await manager.revisarLink(req.body?.token);
    res.status(r.error ? 400 : 200).json(r);
});

// Poner la contraseña nueva con el link. body: { token, nueva }. Cierra las otras sesiones y deja la cuenta iniciada
router.post('/restablecer', limiteRestablecer, async (req, res) => {
    const r = await manager.restablecerPassword(req.body ?? {});
    if (r.error) return res.status(400).json(r);

    const user = await manager.getById(r.userId);
    res.json({ user, token: await signToken(user) });
});

router.get('/me', requireAuth, async (req, res) => {
    const user = await manager.getById(req.userId);
    if (!user) return res.status(401).json({ error: 'Sesión inválida' });

    res.json(user);
});

// Aceptar los términos y la privacidad vigentes (cuentas creadas antes, o cuando cambia la versión).
// body: { version } (la que mostró el front). Responde la cuenta actualizada
router.post('/terminos', requireAuth, async (req, res) => {
    const user = await manager.aceptarTerminos(req.userId, req.body?.version);
    if (user.error) return res.status(400).json(user);
    res.json(user);
});

// Editar mis datos (nombre y email; y el WhatsApp si es capitan). Cambiar el email pide la contraseña actual
router.put('/me', requireAuth, async (req, res) => {
    // El WhatsApp del capitan vive en su equipo: se valida antes para no guardar nada a medias
    const club = req.rol === 'capitan' && req.body?.whatsapp !== undefined ? await clubesManager.getRawByOwner(req.userId) : null;
    const digitos = String(req.body?.whatsapp ?? '').replace(/\D/g, '');

    if (club && (digitos.length < 10 || digitos.length > 15)) {
        return res.status(400).json({ error: 'Ingresá tu WhatsApp con código de país (10 a 15 dígitos)' });
    }

    const antes = await manager.getRaw(req.userId);
    const user = await manager.actualizar(req.userId, req.body);
    if (user.error) return res.status(400).json(user);

    if (club) await clubesManager.cambiarWhatsapp(club.id, digitos);
    // Email nuevo: queda sin verificar y le mandamos el link
    if (antes && user.email !== antes.email) mandarVerificacion(user.id).catch((err) => console.error('Error mandando la verificación de email:', err));

    res.json(user);
});

// Notificaciones por email: { avisos: [{ id, titulo, texto, activa }], novedades: { id, titulo, texto, activa } }
router.get('/notificaciones', requireAuth, async (req, res) => {
    const p = await manager.preferencias(req.userId);
    if (!p) return res.status(404).json({ error: 'No se encontró la cuenta' });
    res.json(p);
});

// body: { avisos?: { tipo: bool }, novedades?: bool }. Responde las preferencias como quedaron
router.put('/notificaciones', requireAuth, async (req, res) => {
    const p = await manager.guardarPreferencias(req.userId, req.body ?? {});
    res.status(p.error ? 400 : 200).json(p);
});

// Darse de baja de un aviso desde el link del mail (sin iniciar sesión). body: { u: usuarioId, a: tipo, f: firma }
// /revisar muestra qué aviso es (el front pide confirmar con un botón, así los programas que abren links no dan de baja a nadie)
const datosBaja = async (body) => {
    const u = String(body?.u ?? ''), a = String(body?.a ?? '');
    if (!firmaValida(`baja:${u}:${a}`, body?.f)) return { error: 'El link no es válido' };

    const usuario = await manager.getRaw(u);
    const titulo = tituloDe(a);
    if (!usuario || !titulo) return { error: 'El link no es válido' };
    return { usuario, tipo: a, titulo };
};
const emailOculto = (email) => email.replace(/^(.{2})[^@]*/, '$1***');

router.post('/baja/revisar', limiteRestablecer, async (req, res) => {
    const d = await datosBaja(req.body);
    if (d.error) return res.status(400).json({ error: d.error });
    res.json({ titulo: d.titulo, email: emailOculto(d.usuario.email), activa: quiereMail(d.usuario, d.tipo) });
});

router.post('/baja', limiteRestablecer, async (req, res) => {
    const d = await datosBaja(req.body);
    if (d.error) return res.status(400).json({ error: d.error });

    const p = await manager.guardarPreferencias(d.usuario.id, d.tipo === 'novedades' ? { novedades: false } : { avisos: { [d.tipo]: false } });
    if (p.error) return res.status(400).json({ error: p.error });
    res.json({ ok: true, titulo: d.titulo });
});

router.put('/password', requireAuth, async (req, res) => {
    const result = await manager.cambiarPassword(req.userId, req.body);
    if (result.error) return res.status(400).json(result);

    // Las sesiones de otros dispositivos quedaron invalidadas: devolvemos un token nuevo para este
    res.json({ ok: true, token: await signToken(await manager.getById(req.userId)) });
});

// Cierra la sesion en todos los dispositivos (tambien en este)
router.post('/logout-all', requireAuth, async (req, res) => {
    const result = await manager.cerrarSesiones(req.userId);
    res.status(result.error ? 400 : 200).json(result);
});

// Confirmar con Google que es el dueño (cuenta sin contraseña), antes de eliminarla: así el front avisa en el momento
// si eligió otra cuenta de Google. body: { credential }. No cambia nada; eliminar vuelve a verificar
router.post('/confirmar-google', requireAuth, limiteGoogle, async (req, res) => {
    const cuenta = await manager.getRaw(req.userId);
    if (cuenta?.passwordHash) return res.status(400).json({ error: 'Tu cuenta tiene contraseña: confirmá con ella' });

    const check = await manager.confirmarIdentidad(req.userId, { credential: req.body?.credential });
    res.status(check.error ? 400 : 200).json(check);
});

// Eliminar la cuenta. Pide la contraseña y borra tambien lo que depende de ella:
// el equipo del capitan o la organizacion del organizador (con sus torneos).
// Si eso no se puede (equipo anotado en un torneo sin terminar, organizacion con equipos inscriptos), no se borra nada.
router.delete('/me', requireAuth, async (req, res) => {
    // Con contraseña o, si la cuenta entra solo con Google, volviendo a confirmar con Google (credential)
    const check = await manager.confirmarIdentidad(req.userId, { password: req.body?.password, credential: req.body?.credential });
    if (check.error) return res.status(400).json(check);

    if (req.rol === 'capitan') {
        const club = await clubesManager.getRawByOwner(req.userId);
        if (club) {
            const result = await clubesManager.eliminar(club.id);
            if (result.error) return res.status(400).json(result);
        }
    } else {
        const org = await organizadoresManager.miOrganizacion(req.userId);
        if (org) {
            const result = await organizadoresManager.eliminar(org.id);
            if (result.error) return res.status(400).json(result);
        }
    }

    res.json(await manager.eliminar(req.userId));
});

export default router;
