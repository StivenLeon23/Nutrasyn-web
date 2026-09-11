// Verificación de tokens de sesión SIN estado para las APIs de Cotizaciones
// (Node / Netlify Functions).
//
// MANTENER EN SINCRONÍA con la copia gemela en
// netlify/edge-functions/lib/session.js — misma lógica de firma/verificación,
// pero esa corre en Deno (Edge Functions, donde se emite el token al hacer
// login) y esta en Node (Functions, donde solo se verifica). No se pueden
// compartir directamente sin un paso de build, por eso están duplicadas.
//
// El token lo firma netlify/edge-functions/portal-auth.js al validar el
// login y se recibe embebido en el HTML (también se guarda como cookie
// corta "portal_session" para no repetir el login entre páginas, pero
// estas APIs nunca leen esa cookie). El frontend reenvía el token como
// "Authorization: Bearer <token>" en cada llamada a estas APIs.

import { webcrypto } from "node:crypto";

function b64urlDecode(str) {
  return new Uint8Array(Buffer.from(str, "base64url"));
}

async function hmac(secret, message) {
  const key = await webcrypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await webcrypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Buffer.from(new Uint8Array(sig)).toString("base64url");
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Verifica la firma y vigencia de un token. Devuelve { user, role } o null.
export async function verifySessionToken(secret, token) {
  if (!secret || !token) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadB64, sig] = parts;

  const expectedSig = await hmac(secret, payloadB64);
  if (!timingSafeEqual(sig, expectedSig)) return null;

  try {
    const payload = JSON.parse(Buffer.from(b64urlDecode(payloadB64)).toString("utf-8"));
    if (!payload.e || payload.e < Math.floor(Date.now() / 1000)) return null; // expirado
    if (payload.r !== "colaborador" && payload.r !== "cliente") return null;
    return { user: payload.u, role: payload.r };
  } catch {
    return null;
  }
}

export function requireCollaborator(session) {
  return Boolean(session) && session.role === "colaborador";
}

// Extrae el token del header Authorization: Bearer <token>
export function bearerToken(req) {
  const auth = req.headers.get("authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7).trim() : null;
}
