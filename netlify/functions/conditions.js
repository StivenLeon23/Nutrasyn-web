// Catálogo reutilizable de condiciones comerciales (forma de pago, validez
// de la cotización, tiempos de entrega, disclaimers, etc.) — funciona igual
// que el catálogo de insumos: un colaborador escribe el texto una vez, se
// guarda con un código único, y se puede volver a agregar en cualquier
// cotización futura en vez de retiparlo.
//
// El catálogo se siembra la primera vez que se pide (ver DEFAULT_CONDITIONS)
// con condiciones genéricas comunes de pago, entrega y validez — son
// plantillas de partida, NO datos reales del negocio (no incluyen cuentas
// bancarias ni cifras específicas de NutraSyn): un colaborador debe
// revisarlas, editarlas (borrar y volver a crear) o completarlas con los
// datos reales desde la interfaz. Si en algún momento se borran todas, no
// se vuelven a sembrar automáticamente — se respeta que el catálogo se
// dejó vacío a propósito.
//
// Solo colaboradores (ver netlify/functions/lib/session.js).
//
// GET    /api/conditions                -> { items: [{code, texto, createdBy, createdAt}] }
// POST   /api/conditions                -> crea una condición nueva, { item, items }
// DELETE /api/conditions?code=COND-0001 -> elimina una condición del catálogo, { items }

import { getStore } from "@netlify/blobs";
import { verifySessionToken, requireCollaborator, bearerToken } from "./lib/session.js";
import { readModifyWrite, nextSimpleCode, jsonResponse } from "./lib/blobs-util.js";

async function authenticate(req) {
  const secret = process.env.PORTAL_TOKEN_SECRET || "";
  return verifySessionToken(secret, bearerToken(req));
}

// Plantillas genéricas comunes en cotizaciones B2B de manufactura de
// alimentos/bebidas. Deliberadamente sin cifras ni datos bancarios reales.
const DEFAULT_CONDITIONS = [
  "Forma de pago: 50% de anticipo para iniciar producción y 50% contra aviso de entrega.",
  "Forma de pago: Contado, contra entrega.",
  "Validez de esta cotización: 15 días calendario a partir de la fecha de emisión.",
  "Los precios cotizados no incluyen IVA, salvo que se indique lo contrario.",
  "Tiempo de entrega: a convenir según disponibilidad de materias primas e insumos, contado a partir de la aprobación de la orden de compra y confirmación del anticipo.",
  "El cliente debe suministrar las especificaciones finales de etiquetado, empaque y arte aprobado antes de iniciar producción.",
  "Cualquier cambio en las especificaciones, cantidades o insumos de esta cotización genera una nueva propuesta comercial.",
  "La orden de compra se puede dar por cerrada con una diferencia de hasta el 10% (por encima o por debajo) de la cantidad solicitada, por variaciones normales del proceso de producción.",
  "Los insumos y empaques cotizados están sujetos a disponibilidad del proveedor al momento de confirmar la orden de compra.",
  "Esta cotización no constituye una reserva de inventario ni de capacidad de producción hasta su aprobación formal (orden de compra y/o confirmación por correo electrónico).",
  "Gracias por la confianza depositada en NutraSyn Lab. Quedamos atentos a sus comentarios.",
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
      items = DEFAULT_CONDITIONS.map((texto, i) => ({
        code: `COND-${String(i + 1).padStart(4, "0")}`,
        texto,
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
