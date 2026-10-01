// Catálogo reutilizable de ingredientes (con los códigos reales de costeo
// del negocio, IN001–IN286) para el editor de ingredientes de cada fórmula
// en el módulo de Cotizaciones — misma mecánica que insumos/condiciones:
// se busca y reutiliza un ingrediente ya existente, o se crea uno nuevo que
// recibe el siguiente código consecutivo (IN287, IN288...) y queda
// disponible para reutilizarlo después.
//
// El "nombre" que se guarda aquí es el nombre interno/técnico completo (ver
// netlify/functions/lib/ingredient-seed.js) — puede incluir anotaciones
// como "en Polvo", "en Liquido (WOH)", "(IMP)", "(AMPES)", "(APMES)",
// "(NoInvimagil)". Esas anotaciones NO deben llegar al cliente: el
// frontend (cotizaciones.html, cleanIngredientDisplay()) las limpia al
// mostrarlas en pantalla y en el PDF. Aquí se guarda el registro completo
// tal cual, no una versión ya recortada.
//
// Solo colaboradores (ver netlify/functions/lib/session.js).
//
// GET    /api/ingredients                -> { items: [{code, nombre, createdBy, createdAt}] }
// POST   /api/ingredients {nombre}       -> crea un ingrediente nuevo, { item, items }
// DELETE /api/ingredients?code=IN001     -> elimina un ingrediente del catálogo, { items }

import { getStore } from "@netlify/blobs";
import { verifySessionToken, requireCollaborator, bearerToken } from "./lib/session.js";
import { readModifyWrite, jsonResponse } from "./lib/blobs-util.js";
import { DEFAULT_INGREDIENTS } from "./lib/ingredient-seed.js";

async function authenticate(req) {
  const secret = process.env.PORTAL_TOKEN_SECRET || "";
  return verifySessionToken(secret, bearerToken(req));
}

// Códigos con el mismo formato que ya usa el negocio: "IN" + 3 dígitos, sin
// guion (IN001, IN002... IN287...) — a diferencia de insumos/condiciones,
// que sí usan guion, porque esos no tenían una numeración previa que respetar.
function nextIngredientCode(items) {
  const used = new Set(
    items
      .map((i) => i.code)
      .filter((c) => /^IN\d+$/.test(c))
      .map((c) => parseInt(c.slice(2), 10)),
  );
  let n = 1;
  while (used.has(n)) n++;
  return `IN${String(n).padStart(3, "0")}`;
}

export default async (req) => {
  const session = await authenticate(req);
  if (!requireCollaborator(session)) {
    return jsonResponse(403, { error: "Acceso restringido a colaboradores." });
  }

  const store = getStore({ name: "ingredients-index", consistency: "strong" });

  if (req.method === "GET") {
    // null = la clave nunca se ha escrito (primera vez) -> se siembra con
    // el catálogo real de costeo. [] = ya se escribió antes y alguien
    // borró todo a propósito -> se respeta, no se vuelve a sembrar.
    let items = await store.get("items", { type: "json" });
    if (items === null) {
      const now = new Date().toISOString();
      items = DEFAULT_INGREDIENTS.map((i) => ({
        code: i.code,
        nombre: i.nombre,
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
    if (!nombre) return jsonResponse(400, { error: "El nombre del ingrediente es obligatorio." });

    let created = null;
    const items = await readModifyWrite(store, "items", [], (list) => {
      const code = nextIngredientCode(list);
      const now = new Date().toISOString();
      created = { code, nombre, createdBy: session.user, createdAt: now };
      return [...list, created];
    });

    return jsonResponse(201, { item: created, items });
  }

  if (req.method === "DELETE") {
    const code = new URL(req.url).searchParams.get("code");
    if (!code) return jsonResponse(400, { error: "El código del ingrediente es obligatorio." });

    let found = false;
    const items = await readModifyWrite(store, "items", [], (list) => {
      const next = list.filter((item) => item.code !== code);
      found = next.length !== list.length;
      return next;
    });

    if (!found) return jsonResponse(404, { error: "Ingrediente no encontrado." });
    return jsonResponse(200, { items });
  }

  return jsonResponse(405, { error: "Método no soportado." });
};

export const config = { path: "/api/ingredients" };
