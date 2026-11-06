import { Router } from '../middleware/router.js';
import { usuariosManager as manager, clubesManager, organizadoresManager } from '../manager/instances.js';
import { requireAuth, signToken } from '../middleware/auth.js';
import { limiteLoginIp, limiteLoginEmail, limiteRegistro, limiteGoogle } from '../middleware/limites.js';
import { verificarGoogle } from '../services/googleService.js';

const router = Router();

router.post('/register', limiteRegistro, async (req, res) => {
    const user = await manager.registrar(req.body);
    if (user.error) return res.status(400).json(user);

    res.status(201).json({ user, token: await signToken(user) });
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

    const r = await manager.entrarConGoogle(perfil, req.body?.rol);
    if (r.error) return res.status(400).json(r);
    if (r.necesitaRol) return res.json(r);

    res.status(r.nueva ? 201 : 200).json({
        user: r.user, token: await signToken(r.user),
        nueva: !!r.nueva, vinculada: !!r.vinculada, passwordBorrada: !!r.passwordBorrada,
    });
});

router.get('/me', requireAuth, async (req, res) => {
    const user = await manager.getById(req.userId);
    if (!user) return res.status(401).json({ error: 'Sesión inválida' });

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

    const user = await manager.actualizar(req.userId, req.body);
    if (user.error) return res.status(400).json(user);

    if (club) await clubesManager.cambiarWhatsapp(club.id, digitos);

    res.json(user);
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
