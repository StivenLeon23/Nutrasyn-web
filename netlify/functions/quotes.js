// API de Cotizaciones B2B — crear, listar y editar cotizaciones guardadas.
// Solo colaboradores (ver netlify/functions/lib/session.js). Persistencia
// en Netlify Blobs: cada cotización es un documento propio y además se
// mantiene un índice liviano para listarlas sin tener que leerlas todas.
//
// Una cotización se puede guardar como borrador con datos incompletos (el
// único requisito es traer nombre de cliente o al menos una fórmula, para
// no guardar un registro totalmente vacío) — el frontend decide si algo
// es "borrador" mirando si tiene cliente y formulaCount > 0.
//
// GET  /api/quotes         -> { quotes: [resumen...] }            (listado)
// GET  /api/quotes/:id     -> { quote: {...} }                    (detalle)
// POST /api/quotes         -> crea una cotización nueva, { quote }
// PUT  /api/quotes/:id     -> actualiza una cotización existente, { quote }

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
  return `COT-${year}-${String(existingCount + 1).padStart(4, "0")}`;
}

function toNullableNumber(value) {
  return value === "" || value == null ? null : Number(value);
}

function normalizeCliente(cliente) {
  return {
    nombre: String(cliente?.nombre || "").trim(),
    nit: String(cliente?.nit || "").trim(),
    telefono: String(cliente?.telefono || "").trim(),
  };
}

function quoteSummary(quote) {
  return {
    id: quote.id,
    folio: quote.folio,
    cliente: quote.cliente,
    precioVenta: quote.precioVenta,
    cantidadProducto: quote.cantidadProducto,
    formulaCount: Array.isArray(quote.formulas) ? quote.formulas.length : 0,
    createdAt: quote.createdAt,
    updatedAt: quote.updatedAt,
    updatedBy: quote.updatedBy,
  };
}

export default async (req) => {
  const session = await authenticate(req);
  if (!requireCollaborator(session)) {
    return jsonResponse(403, { error: "Acceso restringido a colaboradores." });
  }

  const store = getStore({ name: "quotes", consistency: "strong" });
  const url = new URL(req.url);
  const segments = url.pathname.split("/").filter(Boolean); // ["api","quotes"] o ["api","quotes","<id>"]
  const id = segments.length >= 3 ? decodeURIComponent(segments[2]) : null;

  if (req.method === "GET" && !id) {
    const index = (await store.get("index", { type: "json" })) || [];
    return jsonResponse(200, { quotes: index });
  }

  if (req.method === "GET" && id) {
    const quote = await store.get(`quote-${id}`, { type: "json" });
    if (!quote) return jsonResponse(404, { error: "Cotización no encontrada." });
    return jsonResponse(200, { quote });
  }

  if (req.method === "POST" && !id) {
    let body;
    try {
      body = await req.json();
    } catch {
      return jsonResponse(400, { error: "Cuerpo de la solicitud inválido." });
    }

    const cliente = normalizeCliente(body.cliente);
    const formulas = Array.isArray(body.formulas) ? body.formulas : [];
    // Se permite guardar como borrador incompleto: solo se exige que haya
    // *algo* (cliente o una fórmula), para no crear registros vacíos.
    if (!cliente.nombre && !formulas.length) {
      return jsonResponse(400, { error: "Agrega al menos el nombre del cliente o una fórmula antes de guardar." });
    }

    const index = (await store.get("index", { type: "json" })) || [];
    const newId = randomUUID();
    const now = new Date().toISOString();
    const quote = {
      id: newId,
      folio: genFolio(index.length),
      cliente,
      formulas,
      insumos: Array.isArray(body.insumos) ? body.insumos : [],
      precioVenta: toNullableNumber(body.precioVenta),
      cantidadProducto: toNullableNumber(body.cantidadProducto),
      observaciones: String(body.observaciones || "").trim(),
      createdBy: session.user,
      updatedBy: session.user,
      createdAt: now,
      updatedAt: now,
    };

    await store.setJSON(`quote-${newId}`, quote);
    await readModifyWrite(store, "index", [], (list) => [quoteSummary(quote), ...list]);

    return jsonResponse(201, { quote });
  }

  if (req.method === "PUT" && id) {
    let body;
    try {
      body = await req.json();
    } catch {
      return jsonResponse(400, { error: "Cuerpo de la solicitud inválido." });
    }

    const existing = await store.get(`quote-${id}`, { type: "json" });
    if (!existing) return jsonResponse(404, { error: "Cotización no encontrada." });

    const now = new Date().toISOString();
    const updated = {
      ...existing,
      cliente: body.cliente ? normalizeCliente(body.cliente) : existing.cliente,
      formulas: Array.isArray(body.formulas) ? body.formulas : existing.formulas,
      insumos: Array.isArray(body.insumos) ? body.insumos : existing.insumos,
      precioVenta: body.precioVenta === undefined ? existing.precioVenta : toNullableNumber(body.precioVenta),
      cantidadProducto: body.cantidadProducto === undefined ? existing.cantidadProducto : toNullableNumber(body.cantidadProducto),
      observaciones: body.observaciones !== undefined ? String(body.observaciones).trim() : existing.observaciones,
      updatedBy: session.user,
      updatedAt: now,
    };

    await store.setJSON(`quote-${id}`, updated);
    await readModifyWrite(store, "index", [], (list) => {
      const exists = list.some((q) => q.id === id);
      const summary = quoteSummary(updated);
      return exists ? list.map((q) => (q.id === id ? summary : q)) : [summary, ...list];
    });

    return jsonResponse(200, { quote: updated });
  }

  return jsonResponse(405, { error: "Método no soportado." });
};

export const config = { path: ["/api/quotes", "/api/quotes/:id"] };
