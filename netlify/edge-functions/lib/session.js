// Utilidades de sesión SIN estado para el portal B2B (Deno / Edge Functions).
//
// El token que se genera aquí NO es una cookie: nunca se guarda en el
// navegador ni en el servidor. portal-auth.js lo firma al validar el
// usuario/clave del POST de login y lo embebe directamente en el HTML de
// respuesta (window.__PORTAL_SESSION__). Vive solo en memoria de esa
// pestaña mientras dura la página, igual que el contenido real del
// portafolio ya funcionaba antes de esto — ver los comentarios de
// portal-auth.js sobre el diseño "sin estado".
//
// netlify/functions/quotes.js y netlify/functions/packaging.js verifican
// este mismo token (enviado como "Authorization: Bearer <token>") usando
// el gemelo de este archivo: netlify/functions/lib/session.js. Es Node,
// no Deno, así que no se puede compartir el mismo archivo entre ambos
// runtimes sin un paso de build — MANTENER AMBAS COPIAS EN SINCRONÍA.

const TOKEN_TTL_SECONDS = 8 * 60 * 60; // 8 horas hábiles

function b64url(bytes) {
  let str = btoa(String.fromCharCode(...bytes));
  return str.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return b64url(new Uint8Array(sig));
}

// Crea un token firmado {usuario, rol, expiración} — el rol es "colaborador" o "cliente".
export async function createSessionToken(secret, user, role) {
  const payload = {
    u: user,
    r: role,
    e: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
  };
  const payloadB64 = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await hmac(secret, payloadB64);
  return `${payloadB64}.${sig}`;
}
