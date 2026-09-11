// Catálogo reutilizable de opciones de "forma de pago" y "tiempo de
// entrega" para el módulo de Cotizaciones — son las únicas condiciones
// comerciales que realmente varían de una cotización a otra, por eso se
// eligen de una lista desplegable (una sola por categoría). El resto de
// condiciones estándar (IVA, validez, cambios de especificación, etc.) NO
// vive en este catálogo: se escriben una sola vez como texto fijo en el
// PDF (ver FIXED_CONDITIONS en cotizaciones.html) porque deberían aparecer
// igual en cualquier cotización.
//
// El catálogo se siembra la primera vez que se pide (ver DEFAULT_CONDITIONS)
// con opciones comunes de pago y entrega — son plantillas de partida, un
// colaborador puede agregar más o borrar las que no apliquen desde la
// interfaz. Si en algún momento se borran todas, no se vuelven a sembrar
// (se respeta que se dejó vacío a propósito).
//
// Solo colaboradores (ver netlify/functions/lib/session.js).
//
// GET    /api/conditions                -> { items: [{code, texto, categoria, createdBy, createdAt}] }
// POST   /api/conditions {texto, categoria: "pago"|"entrega"} -> crea una opción, { item, items }
// DELETE /api/conditions?code=COND-0001 -> elimina una opción del catálogo, { items }

import { getStore } from "@netlify/blobs";
import { verifySessionToken, requireCollaborator, bearerToken } from "./lib/session.js";
import { readModifyWrite, nextSimpleCode, jsonResponse } from "./lib/blobs-util.js";

async function authenticate(req) {
  const secret = process.env.PORTAL_TOKEN_SECRET || "";
  return verifySessionToken(secret, bearerToken(req));
}

const VALID_CATEGORIES = ["pago", "entrega"];

// Plantillas comunes del mercado B2B de manufactura de alimentos/bebidas.
// Deliberadamente sin cifras ni cuentas bancarias reales del negocio.
const DEFAULT_CONDITIONS = [
  { categoria: "pago", texto: "50% anticipo - 50% contra entrega" },
  { categoria: "pago", texto: "De contado" },
  { categoria: "pago", texto: "60% anticipo - 40% contra entrega" },
  { categoria: "pago", texto: "30% anticipo - saldo contra entrega" },
  { categoria: "pago", texto: "Contra entrega (100%)" },
  { categoria: "pago", texto: "Crédito a 30 días" },
  { categoria: "pago", texto: "Crédito a 60 días" },
  { categoria: "pago", texto: "Crédito a 90 días" },
  { categoria: "entrega", texto: "15 días hábiles después de aprobado el arte y confirmado el anticipo." },
  { categoria: "entrega", texto: "Tiempo de entrega: a convenir según disponibilidad de materias primas e insumos, contado a partir de la aprobación de la orden de compra y confirmación del anticipo." },
  { categoria: "entrega", texto: "8 días hábiles después de aprobado el arte y confirmado el anticipo." },
  { categoria: "entrega", texto: "20 días hábiles después de aprobado el arte y confirmado el anticipo." },
  { categoria: "entrega", texto: "30 días hábiles después de aprobado el arte y confirmado el anticipo, para pedidos de gran volumen." },
];

export default async (req) => {
  const session = await authenticate(req);
  if (!requireCollaborator(session)) {
    return jsonResponse(403, { error: "Acceso restringido a colaboradores." });
  }

  const store = getStore({ name: "conditions-index", consistency: "strong" });

  if (req.method === "GET") {
    // null = la clave nunca se ha escrito (primera vez) -> se siembra.
    // [] = ya se escribió antes y alguien borró todo a propósito -> se respeta.
    let items = await store.get("items", { type: "json" });
    if (items === null) {
      const now = new Date().toISOString();
      items = DEFAULT_CONDITIONS.map((c, i) => ({
        code: `COND-${String(i + 1).padStart(4, "0")}`,
        texto: c.texto,
        categoria: c.categoria,
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
    const texto = (body.texto || "").toString().trim();
    const categoria = (body.categoria || "").toString().trim().toLowerCase();
    if (!texto) return jsonResponse(400, { error: "El texto de la condición es obligatorio." });
    if (!VALID_CATEGORIES.includes(categoria)) {
      return jsonResponse(400, { error: 'La categoría debe ser "pago" o "entrega".' });
    }

    let created = null;
    const items = await readModifyWrite(store, "items", [], (list) => {
      const code = nextSimpleCode(list, "COND");
      const now = new Date().toISOString();
      created = { code, texto, categoria, createdBy: session.user, createdAt: now };
      return [...list, created];
    });

    return jsonResponse(201, { item: created, items });
  }

  if (req.method === "DELETE") {
    const code = new URL(req.url).searchParams.get("code");
    if (!code) return jsonResponse(400, { error: "El código de la condición es obligatorio." });

    let found = false;
    const items = await readModifyWrite(store, "items", [], (list) => {
      const next = list.filter((item) => item.code !== code);
      found = next.length !== list.length;
      return next;
    });

    if (!found) return jsonResponse(404, { error: "Condición no encontrada." });
    return jsonResponse(200, { items });
  }

  return jsonResponse(405, { error: "Método no soportado." });
};

export const config = { path: "/api/conditions" };
