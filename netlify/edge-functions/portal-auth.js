// Netlify Edge Function: protege /portafolio.html a nivel de servidor.
// Sin cookie de sesión válida, el visitante NUNCA recibe el HTML real de
// portafolio.html (ni las fórmulas embebidas en él) — solo este formulario
// de usuario + clave.
//
// Configuración en Netlify (Site configuration -> Environment variables):
//
//   PORTAL_USERS  (recomendado) — una cuenta por colaborador, formato:
//     usuario1:clave1,usuario2:clave2,usuario3:clave3
//     (sin comas ni dos puntos dentro de usuarios/claves)
//
//   PORTAL_PASSWORD (alternativa simple) — si no defines PORTAL_USERS,
//     se acepta cualquier nombre de usuario (no vacío) junto con esta
//     clave única compartida.
//
// Para dar de alta/baja o rotar la clave de un colaborador: editar
// PORTAL_USERS (o PORTAL_PASSWORD) y volver a desplegar. No hay que
// tocar código.

const COOKIE_NAME = "portal_auth";
// Sin Max-Age: cookie de sesión. El navegador la borra al cerrarse, así que
// cada vez que se abre el sitio de nuevo, vuelve a pedir usuario y clave
// (el colaborador puede guardarla en su gestor de contraseñas para no
// tener que escribirla a mano cada vez).

async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function getCookie(request, name) {
  const header = request.headers.get("cookie") || "";
  const match = header.split(";").map(c => c.trim()).find(c => c.startsWith(name + "="));
  return match ? match.slice(name.length + 1) : null;
}

// Resuelve el modo de autenticación activo a partir de las variables de entorno.
function getAuthConfig() {
  const usersRaw = Deno.env.get("PORTAL_USERS") || "";
  const accounts = usersRaw
    .split(",")
    .map(entry => entry.trim())
    .filter(Boolean)
    .map(entry => {
      const idx = entry.indexOf(":");
      if (idx === -1) return null;
      return { user: entry.slice(0, idx).trim(), pass: entry.slice(idx + 1).trim() };
    })
    .filter(Boolean);

  if (accounts.length > 0) {
    return {
      matches: (u, p) => accounts.some(a => a.user === u && a.pass === p),
      identifierFor: (u, p) => `user:${u}:${p}`,
      validIdentifiers: accounts.map(a => `user:${a.user}:${a.pass}`),
    };
  }

  // Alternativa simple: una sola clave compartida, cualquier usuario no vacío.
  const singlePassword = Deno.env.get("PORTAL_PASSWORD") || "";
  return {
    matches: (u, p) => Boolean(singlePassword) && Boolean(u) && p === singlePassword,
    identifierFor: (u, p) => `shared:${p}`,
    validIdentifiers: singlePassword ? [`shared:${singlePassword}`] : [], // vacío = nadie entra (fail-closed)
  };
}

function loginPage({ error = false } = {}) {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex, nofollow, noarchive">
<title>Acceso Restringido | NutraSyn Lab</title>
<link rel="icon" type="image/svg+xml" href="https://res.cloudinary.com/dj761bgxw/image/upload/v1777037267/svg_1_-cropped_p9sqmo.svg">
<link href="https://fonts.googleapis.com/css2?family=Lexend:wght@700;800&family=Manrope:wght@400;600;700&display=swap" rel="stylesheet">
<style>
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; background: #061727; font-family: 'Manrope', sans-serif; padding: 24px; }
  .card { max-width: 380px; width: 100%; background: #0A2540; border: 1px solid rgba(255,255,255,0.1); border-radius: 24px; padding: 32px; text-align: center; box-shadow: 0 20px 50px rgba(0,0,0,0.4); }
  .icon { width: 64px; height: 64px; margin: 0 auto 20px; border-radius: 16px; background: rgba(0,168,150,0.1); color: #00A896; display: flex; align-items: center; justify-content: center; }
  h1 { font-family: 'Lexend', sans-serif; font-size: 20px; font-weight: 800; color: #fff; margin: 0 0 8px; }
  p { color: #94a3b8; font-size: 14px; line-height: 1.5; margin: 0 0 24px; }
  input { width: 100%; padding: 14px 16px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.1); background: rgba(255,255,255,0.05); color: #fff; font-size: 14px; text-align: center; outline: none; margin-bottom: 12px; }
  input[type=password] { letter-spacing: 0.1em; }
  input:focus { border-color: #00A896; }
  .err { color: #f87171; font-size: 12px; margin: 0 0 12px; }
  button { width: 100%; padding: 13px; border-radius: 12px; border: 2px solid #00A896; background: transparent; color: #00A896; font-weight: 700; font-size: 14px; cursor: pointer; transition: all .3s; }
  button:hover { background: #00A896; color: #fff; }
  a { display: block; margin-top: 18px; color: #64748b; font-size: 12px; text-decoration: none; }
  a:hover { color: #00A896; }
</style>
</head>
<body>
  <div class="card">
    <div class="icon">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
    </div>
    <h1>Acceso Colaboradores</h1>
    <p>Este portafolio es de uso exclusivo para colaboradores y clientes autorizados de NutraSyn Lab.</p>
    <form method="POST">
      <input type="text" name="username" placeholder="Usuario" autocomplete="username" autofocus>
      <input type="password" name="password" placeholder="Clave de acceso" autocomplete="current-password">
      ${error ? '<p class="err">Usuario o clave incorrectos. Intenta de nuevo.</p>' : ""}
      <button type="submit">Ingresar</button>
    </form>
    <a href="/index.html#acceso-portafolio">¿No tienes acceso? Solicítalo aquí</a>
  </div>
</body>
</html>`;
}

export default async (request, context) => {
  const url = new URL(request.url);
  const config = getAuthConfig();

  // Hashes válidos para la configuración actual (para validar cookies existentes).
  const validHashes = new Set(await Promise.all(config.validIdentifiers.map(sha256Hex)));

  const cookie = getCookie(request, COOKIE_NAME);
  if (cookie && validHashes.has(cookie)) {
    // OJO: sin esto, la CDN de Netlify puede guardar en caché la página real
    // (autenticada) y servírsela luego a otra persona sin pedirle la clave,
    // porque el caché no distingue por cookie. "private, no-store" prohíbe
    // que se guarde una copia compartida en cualquier punto de la red.
    const response = await context.next();
    const headers = new Headers(response.headers);
    headers.set("Cache-Control", "private, no-store, no-cache, must-revalidate");
    headers.set("Vary", "Cookie");
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }

  if (request.method === "POST") {
    const form = await request.formData();
    const submittedUser = (form.get("username") || "").toString().trim();
    const submittedPass = (form.get("password") || "").toString();

    if (config.matches(submittedUser, submittedPass)) {
      const cookieValue = await sha256Hex(config.identifierFor(submittedUser, submittedPass));
      const headers = new Headers();
      headers.set("Location", url.pathname);
      headers.set("Cache-Control", "private, no-store, no-cache, must-revalidate");
      headers.set(
        "Set-Cookie",
        `${COOKIE_NAME}=${cookieValue}; Path=/; HttpOnly; Secure; SameSite=Lax`
      );
      return new Response(null, { status: 303, headers });
    }

    return new Response(loginPage({ error: true }), {
      status: 401,
      headers: { "content-type": "text/html; charset=utf-8", "X-Robots-Tag": "noindex, nofollow", "Cache-Control": "private, no-store, no-cache, must-revalidate" },
    });
  }

  return new Response(loginPage({ error: false }), {
    status: 401,
    headers: { "content-type": "text/html; charset=utf-8", "X-Robots-Tag": "noindex, nofollow", "Cache-Control": "private, no-store, no-cache, must-revalidate" },
  });
};
