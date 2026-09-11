// Utilidades de sesión para el portal B2B (Deno / Edge Functions).
//
// El token firmado aquí sirve para dos cosas:
//  1. Se embebe en el HTML de cada respuesta autenticada como
//     window.__PORTAL_SESSION__, para que el frontend lo reenvíe como
//     "Authorization: Bearer <token>" a /api/quotes y /api/packaging.
//  2. También se guarda como cookie corta ("portal_session", HttpOnly,
//     Secure, SameSite=Strict, 2 horas) para no pedir usuario/clave en
//     cada navegación entre /portafolio.html y /cotizaciones.html.
//
// Esto SÍ reintroduce una cookie de sesión (el diseño original del portal
// era deliberadamente sin cookies — ver portal-auth.js). La decisión de
// aceptar ese trade-off (comodidad vs. "cero rastro de sesión") la tomó
// el dueño del sitio explícitamente. Lo que se mantiene sin negociar es
// la razón original para evitar cookies: que la CDN de Netlify pudiera
// cachear una respuesta autenticada y servírsela a otra persona. Por eso
// TODA respuesta que lleve contenido real (con o sin cookie) sigue
// marcada "Cache-Control: private, no-store, no-cache, must-revalidate"
// en portal-auth.js — la cookie no cambia esa parte.
//
// netlify/functions/quotes.js y netlify/functions/packaging.js verifican
// este mismo token (vía Bearer, nunca leen la cookie) usando el gemelo de
// este archivo: netlify/functions/lib/session.js. Es Node, no Deno, así
// que no se puede compartir el mismo archivo entre ambos runtimes sin un
// paso de build — MANTENER AMBAS COPIAS EN SINCRONÍA (incluyendo
// TOKEN_TTL_SECONDS: debe coincidir con el Max-Age de la cookie).

export const TOKEN_TTL_SECONDS = 2 * 60 * 60; // 2 horas

function b64url(bytes) {
  let str = btoa(String.fromCharCode(...bytes));
  return str.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(str) {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4) str += "=";
  const bin = atob(str);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
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

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
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

// Verifica la firma y vigencia de un token (usado para la cookie de sesión
// al recargar/navegar sin volver a mandar usuario/clave). Devuelve
// { user, role } o null.
export async function verifySessionToken(secret, token) {
  if (!secret || !token) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadB64, sig] = parts;

  const expectedSig = await hmac(secret, payloadB64);
  if (!timingSafeEqual(sig, expectedSig)) return null;

  try {
    const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(payloadB64)));
    if (!payload.e || payload.e < Math.floor(Date.now() / 1000)) return null;
    if (payload.r !== "colaborador" && payload.r !== "cliente") return null;
    return { user: payload.u, role: payload.r };
  } catch {
    return null;
  }
}

// Lee la cookie "portal_session" de un header Cookie crudo.
export function readSessionCookie(cookieHeader) {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const name = part.slice(0, idx).trim();
    if (name === "portal_session") return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

export function sessionCookieHeader(token) {
  return `portal_session=${token}; Path=/; Max-Age=${TOKEN_TTL_SECONDS}; HttpOnly; Secure; SameSite=Strict`;
}

export function clearSessionCookieHeader() {
  return `portal_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
}
