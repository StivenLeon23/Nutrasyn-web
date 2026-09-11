// Netlify Edge Function: protege /portafolio.html, /cotizaciones.html (y sus
// alias sin extensión) a nivel de servidor.
//
// Diseño SIN estado (sin cookies, sin sesión): cada GET a estas páginas
// devuelve siempre el formulario de usuario + clave, sin excepción — aunque
// sea la misma persona que ya entró antes, aunque tenga la pestaña abierta,
// aunque recargue. El contenido real (con las fórmulas) solo se entrega
// como respuesta directa al POST con las credenciales correctas, en esa
// misma respuesta, y nunca se guarda para reutilizarse después.
//
// Esto también elimina cualquier riesgo de que la CDN de Netlify guarde en
// caché una copia autenticada y se la sirva a otra persona: como no hay
// cookie ni redirect, cada visita GET siempre recibe el mismo formulario
// (fácil y seguro de cachear tal cual), y las respuestas POST no se
// cachean nunca por defecto en ninguna CDN.
//
// TOKEN DE SESIÓN PARA LAS APIS (cotizaciones / insumos) — NO es una cookie:
// al validar el login, esta función firma un token corto {usuario, rol,
// expiración} y lo embebe en el propio HTML de respuesta como
// `window.__PORTAL_SESSION__`. Vive solo en memoria de esa pestaña. El
// frontend lo reenvía como header "Authorization: Bearer <token>" en cada
// llamada a /api/quotes y /api/packaging, y esos endpoints (Netlify
// Functions) lo verifican con el mismo secreto. Así ni clientes ni
// colaboradores necesitan volver a autenticarse para usar la API mientras
// dura la página, sin tener que introducir cookies/sesiones de servidor.
//
// Configuración en Netlify (Site configuration -> Environment variables):
//
//   PORTAL_USERS  (recomendado) — una cuenta por colaborador, formato:
//     usuario1:clave1:colaborador,usuario2:clave2:cliente,usuario3:clave3
//     El tercer campo (rol) es opcional: "colaborador" o "cliente".
//     Si se omite, el usuario queda como "cliente" (privilegio mínimo por
//     defecto). Solo el rol "colaborador" puede usar el módulo de
//     Cotizaciones. (sin comas ni dos puntos dentro de usuarios/claves)
//
//   PORTAL_PASSWORD (alternativa simple) — si no defines PORTAL_USERS,
//     se acepta cualquier nombre de usuario (no vacío) junto con esta
//     clave única compartida. Como no distingue personas, todas las
//     cuentas en este modo quedan como "cliente" (sin acceso a
//     Cotizaciones); para dar acceso de colaborador hace falta PORTAL_USERS.
//
//   PORTAL_TOKEN_SECRET (requerida para Cotizaciones) — cadena aleatoria
//     larga usada para firmar los tokens de sesión de las APIs. Sin ella,
//     el portal sigue funcionando igual que antes, pero el módulo de
//     Cotizaciones no puede autenticar llamadas a la API.
//
// Para dar de alta/baja, rotar la clave o cambiar el rol de un
// colaborador: editar PORTAL_USERS (o PORTAL_PASSWORD) y volver a
// desplegar. No hay que tocar código.

import { createSessionToken } from "./lib/session.js";

const NO_STORE = "private, no-store, no-cache, must-revalidate";

// Resuelve el modo de autenticación activo a partir de las variables de entorno.
function getAuthConfig() {
  const usersRaw = Deno.env.get("PORTAL_USERS") || "";
  const accounts = usersRaw
    .split(",")
    .map(entry => entry.trim())
    .filter(Boolean)
    .map(entry => {
      const parts = entry.split(":").map(p => p.trim());
      if (parts.length < 2 || parts.length > 3) return null;
      const [user, pass, roleRaw] = parts;
      if (!user || !pass) return null;
      // Privilegio mínimo por defecto: cualquier valor que no sea
      // exactamente "colaborador" queda como "cliente".
      const role = roleRaw === "colaborador" ? "colaborador" : "cliente";
      return { user, pass, role };
    })
    .filter(Boolean);

  if (accounts.length > 0) {
    return {
      matches: (u, p) => accounts.some(a => a.user === u && a.pass === p),
      roleFor: (u, p) => {
        const account = accounts.find(a => a.user === u && a.pass === p);
        return account ? account.role : "cliente";
      },
    };
  }

  // Alternativa simple: una sola clave compartida, cualquier usuario no vacío.
  const singlePassword = Deno.env.get("PORTAL_PASSWORD") || "";
  return {
    // Sin PORTAL_USERS ni PORTAL_PASSWORD configuradas -> nadie entra (fail-closed).
    matches: (u, p) => Boolean(singlePassword) && Boolean(u) && p === singlePassword,
    // El modo de clave compartida no distingue personas: nunca da rol de colaborador.
    roleFor: () => "cliente",
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
  .back-link { position: fixed; top: 20px; left: 20px; margin: 0; display: flex; align-items: center; gap: 6px; font-size: 13px; }
</style>
</head>
<body>
  <a href="/index.html" class="back-link">&#8592; Volver al inicio</a>
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
  <script>
    // Si el navegador intenta mostrar esta página desde su caché de
    // navegación (al volver atrás/adelante) en vez de pedirla de nuevo,
    // forzamos una recarga real para que siempre pase por el servidor.
    window.addEventListener('pageshow', function (e) {
      if (e.persisted) window.location.reload();
    });
  </script>
</body>
</html>`;
}

export default async (request, context) => {
  const url = new URL(request.url);
  const config = getAuthConfig();

  if (request.method === "POST") {
    const form = await request.formData();
    const submittedUser = (form.get("username") || "").toString().trim();
    const submittedPass = (form.get("password") || "").toString();

    if (config.matches(submittedUser, submittedPass)) {
      // Clave correcta: pedimos el contenido real al origen con un GET propio
      // (el POST original no se puede reenviar tal cual a un archivo estático)
      // y lo devolvemos DIRECTAMENTE en esta respuesta. Sin cookie, sin
      // redirect: no queda ningún rastro de sesión para la próxima visita.
      const originRequest = new Request(url, { method: "GET", headers: request.headers });
      const realResponse = await context.next(originRequest);
      const headers = new Headers(realResponse.headers);
      headers.set("Cache-Control", NO_STORE);

      const role = config.roleFor(submittedUser, submittedPass);
      const tokenSecret = Deno.env.get("PORTAL_TOKEN_SECRET") || "";
      // Si no se configuró PORTAL_TOKEN_SECRET, el portal sigue funcionando
      // igual que siempre; solo queda sin "token" (null), así el frontend
      // puede detectarlo y avisar que falta configurar esa variable en vez
      // de fallar en silencio al llamar a la API de Cotizaciones.
      const token = tokenSecret ? await createSessionToken(tokenSecret, submittedUser, role) : null;

      const contentType = headers.get("content-type") || "";
      if (contentType.includes("text/html")) {
        const html = await realResponse.text();
        // Se escapa "<" (-> \u003c) por si el usuario configurado en
        // PORTAL_USERS llegara a incluir "</script>": evita que rompa la
        // etiqueta <script> al insertarse en el HTML.
        const sessionScript =
          `<script>window.__PORTAL_SESSION__=${JSON.stringify({ user: submittedUser, role, token }).replace(/</g, "\\u003c")};</script>`;
        const injected = html.includes("</head>")
          ? html.replace("</head>", sessionScript + "</head>")
          : html + sessionScript;
        // El body cambió de tamaño: si dejamos el Content-Length original
        // (copiado de realResponse.headers), el navegador podría truncar
        // la respuesta. Lo quitamos y dejamos que el runtime lo recalcule.
        headers.delete("Content-Length");
        return new Response(injected, { status: realResponse.status, headers });
      }

      return new Response(realResponse.body, { status: realResponse.status, headers });
    }

    return new Response(loginPage({ error: true }), {
      status: 401,
      headers: { "content-type": "text/html; charset=utf-8", "X-Robots-Tag": "noindex, nofollow", "Cache-Control": NO_STORE },
    });
  }

  // Cualquier visita GET (nueva pestaña, recarga, lo que sea) siempre ve el login.
  return new Response(loginPage({ error: false }), {
    status: 401,
    headers: { "content-type": "text/html; charset=utf-8", "X-Robots-Tag": "noindex, nofollow", "Cache-Control": NO_STORE },
  });
};
