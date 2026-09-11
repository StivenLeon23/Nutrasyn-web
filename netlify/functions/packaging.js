// API del catálogo reutilizable de insumos/empaques (envases, tapas, copas,
// cajas, divisores, etc.) para el módulo de Cotizaciones. Cada insumo se
// guarda una sola vez con un código único y se reutiliza en cotizaciones
// futuras en vez de tener que volver a describirlo cada vez.
//
// Solo colaboradores (ver netlify/functions/lib/session.js). Persistencia
// en Netlify Blobs — no hace falta configurar ninguna base de datos externa,
// Netlify inyecta el contexto necesario automáticamente al desplegar.
//
// GET    /api/packaging               -> { items: [...] }
// POST   /api/packaging               -> crea un insumo nuevo, asigna código único, { item, items }
// PUT    /api/packaging               -> actualiza nombre/notas de un insumo existente por "code"
// DELETE /api/packaging?code=ENV-0001 -> elimina un insumo del catálogo, { items }
//   (no afecta cotizaciones ya guardadas: cada una guarda su propia copia
//   del código/tipo/nombre del insumo en el momento en que se agregó)

import { getStore } from "@netlify/blobs";
import { verifySessionToken, requireCollaborator, bearerToken } from "./lib/session.js";
import { readModifyWrite, nextPackagingCode, jsonResponse } from "./lib/blobs-util.js";

async function authenticate(req) {
  const secret = process.env.PORTAL_TOKEN_SECRET || "";
  return verifySessionToken(secret, bearerToken(req));
}

export default async (req) => {
  const session = await authenticate(req);
  if (!requireCollaborator(session)) {
    return jsonResponse(403, { error: "Acceso restringido a colaboradores." });
  }

  const store = getStore({ name: "packaging-index", consistency: "strong" });

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
    const name = (body.name || "").toString().trim();
    const type = (body.type || "otro").toString().trim().toLowerCase();
    if (!name) return jsonResponse(400, { error: "El nombre del insumo es obligatorio." });

    let created = null;
    const items = await readModifyWrite(store, "items", [], (list) => {
      const code = nextPackagingCode(list, type);
      const now = new Date().toISOString();
      created = {
        code,
        type,
        name,
        notas: (body.notas || "").toString().trim(),
        createdBy: session.user,
        createdAt: now,
      };
      return [...list, created];
    });

    return jsonResponse(201, { item: created, items });
  }

  if (req.method === "PUT") {
    let body;
    try {
      body = await req.json();
    } catch {
      return jsonResponse(400, { error: "Cuerpo de la solicitud inválido." });
    }
    const code = (body.code || "").toString().trim();
    if (!code) return jsonResponse(400, { error: "El código del insumo es obligatorio." });

    let found = false;
    const items = await readModifyWrite(store, "items", [], (list) =>
      list.map((item) => {
        if (item.code !== code) return item;
        found = true;
        return {
          ...item,
          name: body.name !== undefined ? String(body.name).trim() : item.name,
          notas: body.notas !== undefined ? String(body.notas).trim() : item.notas,
        };
      }),
    );

    if (!found) return jsonResponse(404, { error: "Insumo no encontrado." });
    return jsonResponse(200, { items });
  }

  if (req.method === "DELETE") {
    const code = new URL(req.url).searchParams.get("code");
    if (!code) return jsonResponse(400, { error: "El código del insumo es obligatorio." });

    let found = false;
    const items = await readModifyWrite(store, "items", [], (list) => {
      const next = list.filter((item) => item.code !== code);
      found = next.length !== list.length;
      return next;
    });

    if (!found) return jsonResponse(404, { error: "Insumo no encontrado." });
    return jsonResponse(200, { items });
  }

  return jsonResponse(405, { error: "Método no soportado." });
};

export const config = { path: "/api/packaging" };
