// Catálogo reutilizable de "servicios de la maquila" para el módulo de
// Cotizaciones — ej. Fabricación, Envasado, Litográficos, Transporte,
// Análisis de laboratorio iniciales... Cada fórmula de una cotización
// marca cuáles de estos servicios quedan incluidos o no (ver
// FIXED_CONDITIONS/f.servicios en cotizaciones.html), porque eso cambia de
// un producto a otro dentro de la misma cotización (ej. un producto sí
// lleva análisis iniciales a cargo del laboratorio y otro no).
//
// El catálogo se siembra la primera vez que se pide (ver DEFAULT_SERVICES)
// con los servicios típicos de una maquila — son una plantilla de partida,
// un colaborador puede agregar más o borrar los que no apliquen desde la
// interfaz. Si en algún momento se borran todos, no se vuelven a sembrar
// (se respeta que se dejó vacío a propósito) — mismo criterio que
// conditions.js.
//
// Solo colaboradores (ver netlify/functions/lib/session.js).
//
// GET    /api/services                      -> { items: [{code, nombre, createdBy, createdAt}] }
// POST   /api/services {nombre}             -> crea un servicio, { item, items }
// PUT    /api/services?code=SERV-0001 {nombre} -> renombra un servicio (ej. corregir un error de tipeo), { item, items }
// DELETE /api/services?code=SERV-0001       -> elimina un servicio del catálogo, { items }

import { getStore } from "@netlify/blobs";
import { verifySessionToken, requireCollaborator, bearerToken } from "./lib/session.js";
import { readModifyWrite, nextSimpleCode, jsonResponse } from "./lib/blobs-util.js";

async function authenticate(req) {
  const secret = process.env.PORTAL_TOKEN_SECRET || "";
  return verifySessionToken(secret, bearerToken(req));
}

const DEFAULT_SERVICES = [
  "Fabricación",
  "Envasado",
  "Ingredientes",
  "Insumos y empaques",
  "Litográficos / etiquetas",
  "Transporte",
  "Análisis de laboratorio iniciales",
  "Control de calidad",
];

export default async (req) => {
  const session = await authenticate(req);
  if (!requireCollaborator(session)) {
    return jsonResponse(403, { error: "Acceso restringido a colaboradores." });
  }

  const store = getStore({ name: "services-index", consistency: "strong" });

  if (req.method === "GET") {
    // null = la clave nunca se ha escrito (primera vez) -> se siembra.
    // [] = ya se escribió antes y alguien borró todo a propósito -> se respeta.
    let items = await store.get("items", { type: "json" });
    if (items === null) {
      const now = new Date().toISOString();
      items = DEFAULT_SERVICES.map((nombre, i) => ({
        code: `SERV-${String(i + 1).padStart(4, "0")}`,
        nombre,
        createdBy: "sistema",
        createdAt: now,
      }));
      await store.setJSON("items", items);
    }
    return jsonResponse(200, { items });
  }

  if (req.method === "POST") {
    let body;
    try {
      body = await req.json();
    } catch {
      return jsonResponse(400, { error: "Cuerpo de la solicitud inválido." });
    }
    const nombre = (body.nombre || "").toString().trim();
    if (!nombre) return jsonResponse(400, { error: "El nombre del servicio es obligatorio." });

    let created = null;
    const items = await readModifyWrite(store, "items", [], (list) => {
      const code = nextSimpleCode(list, "SERV");
      const now = new Date().toISOString();
      created = { code, nombre, createdBy: session.user, createdAt: now };
      return [...list, created];
    });

    return jsonResponse(201, { item: created, items });
  }

  if (req.method === "PUT") {
    const code = new URL(req.url).searchParams.get("code");
    if (!code) return jsonResponse(400, { error: "El código del servicio es obligatorio." });
    let body;
    try {
      body = await req.json();
    } catch {
      return jsonResponse(400, { error: "Cuerpo de la solicitud inválido." });
    }
    const nombre = (body.nombre || "").toString().trim();
    if (!nombre) return jsonResponse(400, { error: "El nombre del servicio es obligatorio." });

    let updated = null;
    const items = await readModifyWrite(store, "items", [], (list) =>
      list.map((item) => {
        if (item.code !== code) return item;
        updated = { ...item, nombre };
        return updated;
      }),
    );

    if (!updated) return jsonResponse(404, { error: "Servicio no encontrado." });
    return jsonResponse(200, { item: updated, items });
  }

  if (req.method === "DELETE") {
    const code = new URL(req.url).searchParams.get("code");
    if (!code) return jsonResponse(400, { error: "El código del servicio es obligatorio." });

    let found = false;
    const items = await readModifyWrite(store, "items", [], (list) => {
      const next = list.filter((item) => item.code !== code);
      found = next.length !== list.length;
      return next;
    });

    if (!found) return jsonResponse(404, { error: "Servicio no encontrado." });
    return jsonResponse(200, { items });
  }

  return jsonResponse(405, { error: "Método no soportado." });
};

export const config = { path: "/api/services" };
