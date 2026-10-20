// API de Órdenes de Compra a proveedores — crear, listar y editar.
// Mismo patrón que netlify/functions/quotes.js: Solo colaboradores (ver
// netlify/functions/lib/session.js). Persistencia en Netlify Blobs — cada
// orden es un documento propio y además se mantiene un índice liviano
// para listarlas sin tener que leerlas todas.
//
// Cada ítem es un insumo o ingrediente tomado de los catálogos ya
// existentes (/api/packaging, /api/ingredients) — se guarda como snapshot
// propio de ESTA orden (código/nombre al momento de agregarlo, más la
// cantidad, el precio unitario, el % de IVA y una nota libre opcional
// —ej. "color azul"— que se negocien con el proveedor), nunca modifica
// el catálogo:
//   { tipo: "insumo"|"ingrediente", code, nombre, cantidad, precioUnitario, ivaPercent, nota? }
// ivaPercent es por ítem (no uno solo para toda la orden) porque se
// pueden mezclar insumos con distinta tarifa de IVA en la misma compra;
// 19 (la tarifa general en Colombia) es el valor por defecto si no se
// indica otro. El subtotal es la suma de (cantidad × precioUnitario) de
// los ítems que tengan ambos valores, el IVA es la suma del IVA de cada
// uno según su propio ivaPercent, y el total es subtotal + iva — ver
// computeTotals().
//
// El folio (OC-2026-0001...) es un consecutivo propio de este módulo,
// independiente del de Cotizaciones — arranca en 1, no continúa ninguna
// numeración externa previa.
//
// GET  /api/purchase-orders        -> { orders: [resumen...] }   (listado)
// GET  /api/purchase-orders/:id    -> { order: {...} }           (detalle)
// POST /api/purchase-orders        -> crea una orden nueva, { order }
// PUT  /api/purchase-orders/:id    -> actualiza una orden existente, { order }

import { randomUUID } from "node:crypto";
import { getStore } from "@netlify/blobs";
import { verifySessionToken, requireCollaborator, bearerToken } from "./lib/session.js";
import { readModifyWrite, jsonResponse } from "./lib/blobs-util.js";

async function authenticate(req) {
  const secret = process.env.PORTAL_TOKEN_SECRET || "";
  return verifySessionToken(secret, bearerToken(req));
}

function genFolio(existingCount) {
  const year = new Date().getFullYear();
  return `OC-${year}-${String(existingCount + 1).padStart(4, "0")}`;
}

function normalizeProveedor(p) {
  return {
    nombre: String(p?.nombre || "").trim(),
    nit: String(p?.nit || "").trim(),
    contacto: String(p?.contacto || "").trim(),
    telefono: String(p?.telefono || "").trim(),
    email: String(p?.email || "").trim(),
  };
}

function normalizeItems(items) {
  return (Array.isArray(items) ? items : [])
    .map((i) => {
      const cantidad = i?.cantidad != null && i.cantidad !== "" && Number.isFinite(Number(i.cantidad)) ? Number(i.cantidad) : null;
      const precioUnitario = i?.precioUnitario != null && i.precioUnitario !== "" && Number.isFinite(Number(i.precioUnitario)) ? Number(i.precioUnitario) : null;
      // 19% (tarifa general en Colombia) por defecto si no viene nada —
      // se puede bajar a 0 o a cualquier otro valor por ítem (ej. productos
      // exentos mezclados con otros gravados en la misma orden).
      const ivaPercent = i?.ivaPercent != null && i.ivaPercent !== "" && Number.isFinite(Number(i.ivaPercent)) ? Number(i.ivaPercent) : 19;
      // Nota libre por ítem (ej. "color azul"), propia de esta orden — igual
      // que la nota de insumos en Cotizaciones, nunca toca el catálogo.
      const nota = String(i?.nota || "").trim();
      return {
        tipo: i?.tipo === "ingrediente" ? "ingrediente" : "insumo",
        code: String(i?.code || "").trim(),
        nombre: String(i?.nombre || "").trim(),
        cantidad,
        precioUnitario,
        ivaPercent,
        ...(nota ? { nota } : {}),
      };
    })
    .filter((i) => i.code || i.nombre);
}

// Subtotal = suma de cantidad × precioUnitario (antes de IVA) de los
// ítems que tengan ambos valores. IVA = suma del IVA de cada uno de esos
// ítems según su propio ivaPercent. Total = subtotal + iva. Si ningún
// ítem tiene precio todavía, los tres quedan en null (no 0) para
// distinguir "sin definir" de "total es cero".
function computeTotals(items) {
  let subtotal = 0;
  let iva = 0;
  let hasAny = false;
  for (const i of items || []) {
    if (i.cantidad != null && i.precioUnitario != null) {
      const lineSubtotal = i.cantidad * i.precioUnitario;
      subtotal += lineSubtotal;
      iva += lineSubtotal * ((i.ivaPercent || 0) / 100);
      hasAny = true;
    }
  }
  if (!hasAny) return { subtotal: null, iva: null, total: null };
  return { subtotal, iva, total: subtotal + iva };
}

function orderSummary(order) {
  // El listado muestra el total CON IVA (lo que de verdad se le pagaría
  // al proveedor), no el subtotal.
  return {
    id: order.id,
    folio: order.folio,
    proveedor: order.proveedor,
    totalEstimado: computeTotals(order.items).total,
    itemCount: Array.isArray(order.items) ? order.items.length : 0,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    updatedBy: order.updatedBy,
  };
}

export default async (req) => {
  const session = await authenticate(req);
  if (!requireCollaborator(session)) {
    return jsonResponse(403, { error: "Acceso restringido a colaboradores." });
  }

  const store = getStore({ name: "purchase-orders", consistency: "strong" });
  const url = new URL(req.url);
  const segments = url.pathname.split("/").filter(Boolean); // ["api","purchase-orders"] o [...,"<id>"]
  const id = segments.length >= 3 ? decodeURIComponent(segments[2]) : null;

  if (req.method === "GET" && !id) {
    const index = (await store.get("index", { type: "json" })) || [];
    return jsonResponse(200, { orders: index });
  }

  if (req.method === "GET" && id) {
    const order = await store.get(`order-${id}`, { type: "json" });
    if (!order) return jsonResponse(404, { error: "Orden no encontrada." });
    return jsonResponse(200, { order });
  }

  if (req.method === "POST" && !id) {
    let body;
    try {
      body = await req.json();
    } catch {
      return jsonResponse(400, { error: "Cuerpo de la solicitud inválido." });
    }

    const proveedor = normalizeProveedor(body.proveedor);
    const items = normalizeItems(body.items);
    // Se permite guardar como borrador incompleto: solo se exige que haya
    // *algo* (proveedor o un ítem), para no crear registros vacíos.
    if (!proveedor.nombre && !items.length) {
      return jsonResponse(400, { error: "Agrega al menos el nombre del proveedor o un ítem antes de guardar." });
    }

    const newId = randomUUID();
    const now = new Date().toISOString();

    // El folio se asigna DENTRO del read-modify-write del índice (no antes,
    // con una lectura aparte) para minimizar la ventana en la que dos
    // guardados casi simultáneos de distintos colaboradores podrían
    // chocar en el mismo número — mismo criterio que quotes.js.
    let assignedFolio;
    await readModifyWrite(store, "index", [], (list) => {
      assignedFolio = genFolio(list.length);
      const summary = {
        id: newId,
        folio: assignedFolio,
        proveedor,
        totalEstimado: computeTotals(items).total,
        itemCount: items.length,
        createdAt: now,
        updatedAt: now,
        updatedBy: session.user,
      };
      return [summary, ...list];
    });

    const order = {
      id: newId,
      folio: assignedFolio,
      proveedor,
      items,
      observaciones: String(body.observaciones || "").trim(),
      elaboradoPor: String(body.elaboradoPor || "").trim(),
      createdBy: session.user,
      updatedBy: session.user,
      createdAt: now,
      updatedAt: now,
    };
    await store.setJSON(`order-${newId}`, order);

    return jsonResponse(201, { order });
  }

  if (req.method === "PUT" && id) {
    let body;
    try {
      body = await req.json();
    } catch {
      return jsonResponse(400, { error: "Cuerpo de la solicitud inválido." });
    }

    const existing = await store.get(`order-${id}`, { type: "json" });
    if (!existing) return jsonResponse(404, { error: "Orden no encontrada." });

    const now = new Date().toISOString();
    const updated = {
      ...existing,
      proveedor: body.proveedor ? normalizeProveedor(body.proveedor) : existing.proveedor,
      items: Array.isArray(body.items) ? normalizeItems(body.items) : existing.items,
      observaciones: body.observaciones !== undefined ? String(body.observaciones).trim() : existing.observaciones,
      elaboradoPor: body.elaboradoPor !== undefined ? String(body.elaboradoPor).trim() : existing.elaboradoPor,
      updatedBy: session.user,
      updatedAt: now,
    };

    await store.setJSON(`order-${id}`, updated);
    await readModifyWrite(store, "index", [], (list) => {
      const exists = list.some((o) => o.id === id);
      const summary = orderSummary(updated);
      return exists ? list.map((o) => (o.id === id ? summary : o)) : [summary, ...list];
    });

    return jsonResponse(200, { order: updated });
  }

  return jsonResponse(405, { error: "Método no soportado." });
};

export const config = { path: ["/api/purchase-orders", "/api/purchase-orders/:id"] };
