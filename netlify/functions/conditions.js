// Catálogo reutilizable de condiciones comerciales (forma de pago, validez
// de la cotización, tiempos de entrega, disclaimers, etc.) — funciona igual
// que el catálogo de insumos: un colaborador escribe el texto una vez, se
// guarda con un código único, y se puede volver a agregar en cualquier
// cotización futura en vez de retiparlo.
//
// El catálogo empieza vacío a propósito: las condiciones comerciales reales
// (formas de pago, cuentas bancarias, plazos) son específicas del negocio y
// las debe cargar un colaborador desde la interfaz.
//
// Solo colaboradores (ver netlify/functions/lib/session.js).
//
// GET  /api/conditions   -> { items: [{code, texto, createdBy, createdAt}] }
// POST /api/conditions   -> crea una condición nueva, { item, items }

import { getStore } from "@netlify/blobs";
import { verifySessionToken, requireCollaborator, bearerToken } from "./lib/session.js";
import { readModifyWrite, nextSimpleCode, jsonResponse } from "./lib/blobs-util.js";

async function authenticate(req) {
  const secret = process.env.PORTAL_TOKEN_SECRET || "";
  return verifySessionToken(secret, bearerToken(req));
}

export default async (req) => {
  const session = await authenticate(req);
  if (!requireCollaborator(session)) {
    return jsonResponse(403, { error: "Acceso restringido a colaboradores." });
  }

  const store = getStore({ name: "conditions-index", consistency: "strong" });

  if (req.method === "GET") {
    const items = (await store.get("items", { type: "json" })) || [];
    return jsonResponse(200, { items });
  }

  if (req.method === "POST") {
    let body;
    try {
      body = await req.json();
    } catch {
      return jsonResponse(400, { error: "Cuerpo de la solicitud inválido." });
    }
    const texto = (body.texto || "").toString().trim();
    if (!texto) return jsonResponse(400, { error: "El texto de la condición es obligatorio." });

    let created = null;
    const items = await readModifyWrite(store, "items", [], (list) => {
      const code = nextSimpleCode(list, "COND");
      const now = new Date().toISOString();
      created = { code, texto, createdBy: session.user, createdAt: now };
      return [...list, created];
    });

    return jsonResponse(201, { item: created, items });
  }

  return jsonResponse(405, { error: "Método no soportado." });
};

export const config = { path: "/api/conditions" };
