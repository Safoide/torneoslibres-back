// Login con Google con botón propio (Google Identity Services, "token client").
// El front abre la ventana de Google con nuestro botón y recibe un ACCESS TOKEN (scopes openid email profile),
// que nos manda. Acá se le pregunta a Google por ese token:
//  - tokeninfo: para quién se emitió (aud/azp). TIENE que ser nuestro Client ID: si no, un token que otra app
//    obtuvo de un usuario serviría para entrar a su cuenta acá. También que no esté vencido.
//  - userinfo: el id fijo de la cuenta (sub), el email verificado y el nombre.
// Solo hace falta el Client ID (es público): no se usa ningún secreto de Google.
export const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';

const TOKENINFO = 'https://oauth2.googleapis.com/tokeninfo';
const USERINFO = 'https://openidconnect.googleapis.com/v1/userinfo';
const NO_VERIFICADO = { error: 'No pudimos verificar tu cuenta de Google. Probá de nuevo.' };

const pedir = async (url, opciones) => {
    const r = await fetch(url, { ...opciones, signal: AbortSignal.timeout(8000) });
    return r.ok ? r.json() : null;
};

// Devuelve { googleId, email, nombre } o { error, status? }
export const verificarGoogle = async (accessToken) => {
    if (!GOOGLE_CLIENT_ID) return { error: 'El ingreso con Google todavía no está disponible', status: 503 };
    if (typeof accessToken !== 'string' || !accessToken || accessToken.length > 4096) return NO_VERIFICADO;

    let info, perfil;
    try {
        [info, perfil] = await Promise.all([
            // Por POST: el token no queda en ninguna URL (ni en logs)
            pedir(TOKENINFO, { method: 'POST', body: new URLSearchParams({ access_token: accessToken }) }),
            pedir(USERINFO, { headers: { Authorization: `Bearer ${accessToken}` } }),
        ]);
    } catch {
        return { error: 'No pudimos comunicarnos con Google. Probá de nuevo en un momento.', status: 502 };
    }

    if (!info || !perfil) return NO_VERIFICADO;
    // El token tiene que ser de NUESTRA app y estar vigente
    if (info.aud !== GOOGLE_CLIENT_ID && info.azp !== GOOGLE_CLIENT_ID) return NO_VERIFICADO;
    if (!(Number(info.expires_in) > 0)) return NO_VERIFICADO;
    if (!perfil.sub || String(perfil.sub) !== String(info.sub)) return NO_VERIFICADO;

    if (!perfil.email) return { error: 'Tu cuenta de Google no tiene un email asociado' };
    // Sin email verificado por Google no sabemos si es el dueño del email: no se usa para entrar ni vincular
    if (perfil.email_verified !== true && perfil.email_verified !== 'true') return { error: 'Tu cuenta de Google no tiene el email verificado' };

    return {
        googleId: String(perfil.sub),
        email: String(perfil.email).trim().toLowerCase(),
        nombre: String(perfil.name || perfil.given_name || perfil.email.split('@')[0]).trim().slice(0, 60),
    };
};
