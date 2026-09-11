// Utilidades compartidas para las APIs de Cotizaciones sobre Netlify Blobs.

// Categorías conocidas con prefijo "bonito" fijo. No es una lista cerrada:
// el frontend deja escribir cualquier categoría nueva (ej. "Etiqueta",
// "Manga Termoencogible"...) y prefixForType() le deriva un prefijo de 3
// letras automáticamente para que también tenga código único reutilizable.
export const PREFIX_BY_TYPE = {
  envase: "ENV",
  tapa: "TAP",
  copa: "COP",
  caja: "CAJ",
  divisor: "DIV",
  insumo: "INS",
  otro: "OTR",
};

export function prefixForType(type) {
  const key = String(type || "").trim().toLowerCase();
  if (PREFIX_BY_TYPE[key]) return PREFIX_BY_TYPE[key];

  // Categoría nueva/no prevista: derivar un prefijo de 3 letras a partir
  // del nombre (sin tildes ni símbolos), ej. "etiqueta" -> "ETI".
  const clean = key
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // quita tildes
    .replace(/[^a-z]/g, "")
    .toUpperCase();
  return clean ? (clean + "XXX").slice(0, 3) : "OTR";
}

// Genera el siguiente código único disponible para un tipo de insumo/empaque,
// ej. "ENV-0001", "TAP-0002"... reutilizable en próximas cotizaciones.
export function nextPackagingCode(items, type) {
  const prefix = prefixForType(type);
  const used = new Set(
    items
      .filter((i) => typeof i.code === "string" && i.code.startsWith(prefix + "-"))
      .map((i) => parseInt(i.code.split("-")[1], 10))
      .filter((n) => !Number.isNaN(n)),
  );
  let n = 1;
  while (used.has(n)) n++;
  return `${prefix}-${String(n).padStart(4, "0")}`;
}

// Siguiente código secuencial simple con un prefijo fijo, ej. "COND-0001".
// A diferencia de los insumos, las condiciones comerciales no tienen
// categorías, así que basta un solo contador.
export function nextSimpleCode(items, prefix) {
  const used = new Set(
    items
      .filter((i) => typeof i.code === "string" && i.code.startsWith(prefix + "-"))
      .map((i) => parseInt(i.code.split("-")[1], 10))
      .filter((n) => !Number.isNaN(n)),
  );
  let n = 1;
  while (used.has(n)) n++;
  return `${prefix}-${String(n).padStart(4, "0")}`;
}

// Lectura-modificación-escritura simple sobre una clave JSON del store.
// No usa bloqueo optimista (etag): para el volumen de un equipo pequeño de
// colaboradores editando ocasionalmente el catálogo, el riesgo de dos
// escrituras simultáneas es bajo y no vale la pena la complejidad extra.
export async function readModifyWrite(store, key, defaultValue, mutateFn) {
  const current = (await store.get(key, { type: "json" })) ?? defaultValue;
  const next = mutateFn(current);
  await store.setJSON(key, next);
  return next;
}

export function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}
