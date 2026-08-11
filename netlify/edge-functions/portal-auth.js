// Netlify Edge Function: protege /portafolio.html a nivel de servidor.
// Sin cookie de sesión válida, el visitante NUNCA recibe el HTML real de
// portafolio.html (ni las fórmulas embebidas en él) — solo este formulario.
//
// Requiere una variable de entorno en Netlify (Site configuration ->
// Environment variables): PORTAL_PASSWORD = la clave compartida con
// colaboradores. Para rotarla, solo hay que cambiar esa variable y
// redesplegar (no hay que tocar código).

const COOKIE_NAME = "portal_auth";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 días

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
  input { width: 100%; padding: 14px 16px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.1); background: rgba(255,255,255,0.05); color: #fff; font-size: 14px; text-align: center; letter-spacing: 0.1em; outline: none; margin-bottom: 12px; }
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
    <h1>Acceso Restringido</h1>
    <p>Este portafolio es de uso exclusivo para colaboradores y clientes autorizados de NutraSyn Lab.</p>
    <form method="POST">
      <input type="password" name="password" placeholder="Clave de acceso" autocomplete="off" autofocus>
      ${error ? '<p class="err">Clave incorrecta. Intenta de nuevo.</p>' : ""}
      <button type="submit">Ingresar</button>
    </form>
    <a href="/index.html#acceso-portafolio">¿No tienes clave? Solicita acceso aquí</a>
  </div>
</body>
</html>`;
}

export default async (request, context) => {
  const url = new URL(request.url);
  // Si PORTAL_PASSWORD no está configurada en Netlify, esto queda como cadena vacía:
  // ninguna clave enviada (ni vacía) podrá coincidir, así que la página se queda
  // bloqueada por defecto en vez de abierta (fail-closed).
  const correctPassword = Deno.env.get("PORTAL_PASSWORD") || "";
  const expectedCookie = await sha256Hex(correctPassword);
  const cookie = getCookie(request, COOKIE_NAME);

  if (cookie === expectedCookie) {
    return context.next();
  }

  if (request.method === "POST") {
    const form = await request.formData();
    const submitted = (form.get("password") || "").toString();

    if (submitted && submitted === correctPassword) {
      const headers = new Headers();
      headers.set("Location", url.pathname);
      headers.set(
        "Set-Cookie",
        `${COOKIE_NAME}=${expectedCookie}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${MAX_AGE_SECONDS}`
      );
      return new Response(null, { status: 303, headers });
    }

    return new Response(loginPage({ error: true }), {
      status: 401,
      headers: { "content-type": "text/html; charset=utf-8", "X-Robots-Tag": "noindex, nofollow" },
    });
  }

  return new Response(loginPage({ error: false }), {
    status: 401,
    headers: { "content-type": "text/html; charset=utf-8", "X-Robots-Tag": "noindex, nofollow" },
  });
};
