/**
 * Portal de clínicas · Dirige tu Clínica
 *
 * Worker de Cloudflare que sirve el cuadro de mando TIMÓN en el móvil.
 *
 * Reglas:
 *  - Power BI (TIMÓN) es el maestro. Este Worker NO calcula ninguna medida:
 *    solo guarda y devuelve los totales que exporta Power BI (ver exportar/).
 *  - Solo totales agregados. Nunca datos de pacientes.
 *  - Sin login verificado de Cloudflare Access, solo se ven datos de ejemplo.
 */

export interface Env {
  ASSETS: Fetcher;
  DATOS: KVNamespace;
  /** Equipo de Cloudflare Zero Trust, p. ej. "dirigetuclinica.cloudflareaccess.com". */
  ACCESS_TEAM_DOMAIN?: string;
  /** "Application Audience (AUD) Tag" de la aplicación de Access. */
  ACCESS_AUD?: string;
  /** Secreto: token que usa el script de exportación para subir datos. */
  SUBIR_TOKEN?: string;
  /** Solo para pruebas en local (.dev.vars): correo que se da por verificado en localhost. */
  DEV_EMAIL?: string;
}

/** Lo que se guarda en KV para cada persona: a qué clínica(s) tiene acceso. */
interface Usuario {
  clinicas: string[]; // ids de clínica, o ["*"] para Daniel (ve todas)
  nombre?: string;
}

const MAX_SUBIDA = 2_000_000; // 2 MB: una foto de totales ocupa mucho menos

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === "/api/subir" && req.method === "POST") return subir(req, env);
    if (url.pathname === "/api/datos" && req.method === "GET") return datos(req, env, url);
    if (url.pathname === "/api/yo" && req.method === "GET") return yo(req, env);
    if (url.pathname === "/api/docs" || url.pathname.startsWith("/api/docs/")) return documentos(req, env, url);
    if (url.pathname.startsWith("/api/")) return json({ error: "No existe" }, 404);

    // Resto: la web estática (public/)
    const res = await env.ASSETS.fetch(req);
    return conCabeceras(res);
  },
} satisfies ExportedHandler<Env>;

/* ------------------------------------------------------------------ */
/*  /api/datos: la foto de totales de la clínica de quien ha entrado   */
/* ------------------------------------------------------------------ */
async function datos(req: Request, env: Env, url: URL): Promise<Response> {
  const email = await emailVerificado(req, env);
  if (!email) {
    // Sin login verificado: nunca datos reales.
    const ejemplo = await env.ASSETS.fetch(new Request(new URL("/ejemplo.json", url)));
    return conCabeceras(new Response(ejemplo.body, { headers: { "content-type": "application/json" } }));
  }
  const usuario = await leerUsuario(env, email);
  if (!usuario || usuario.clinicas.length === 0) {
    return json({ error: "Tu usuario no tiene ninguna clínica asignada. Escribe a Daniel." }, 403);
  }
  const pedida = url.searchParams.get("clinica");
  const clinica = pedida ?? (usuario.clinicas[0] === "*" ? null : usuario.clinicas[0]);
  if (!clinica) return json({ error: "Elige una clínica." }, 400);
  if (!puedeVer(usuario, clinica)) return json({ error: "No tienes acceso a esta clínica." }, 403);

  const foto = await env.DATOS.get(`foto:${clinica}`);
  if (!foto) return json({ error: "Todavía no hay datos de esta clínica." }, 404);
  return new Response(foto, {
    headers: { "content-type": "application/json", "cache-control": "private, no-store" },
  });
}

/** /api/yo: quién ha entrado y qué clínicas puede ver (para el selector de Daniel). */
async function yo(req: Request, env: Env): Promise<Response> {
  const email = await emailVerificado(req, env);
  if (!email) return json({ modo: "ejemplo" });
  const usuario = await leerUsuario(env, email);
  let clinicas = usuario?.clinicas ?? [];
  const admin = clinicas.includes("*");
  if (admin) {
    // Daniel: todas las clínicas que tienen datos o alguna persona dada de alta.
    const todas = new Set<string>();
    for (const k of (await env.DATOS.list({ prefix: "foto:" })).keys) todas.add(k.name.slice(5));
    for (const k of (await env.DATOS.list({ prefix: "usuario:" })).keys) {
      const u = (await env.DATOS.get(k.name, "json")) as Usuario | null;
      for (const c of u?.clinicas ?? []) if (c !== "*") todas.add(c);
    }
    clinicas = [...todas].sort();
  }
  return json({ modo: "real", email, nombre: usuario?.nombre ?? null, admin, clinicas });
}

/* ------------------------------------------------------------------ */
/*  /api/docs: documentación de cada clínica (y común a todas)          */
/*    GET    /api/docs?clinica=x        lista (la de la clínica + comunes) */
/*    GET    /api/docs/<ambito>/<id>    descarga                          */
/*    POST   /api/docs                  sube (solo Daniel)                */
/*    DELETE /api/docs/<ambito>/<id>    borra (solo Daniel)               */
/*  En KV: doc:<ambito>:<id> = archivo; metadatos en el propio listado.  */
/*  <ambito> = id de clínica, o "comun" (lo ven todas las clínicas).     */
/* ------------------------------------------------------------------ */
const MAX_DOC = 20_000_000; // 20 MB (el límite de KV por valor es 25 MB)
const COMUN = "comun";
const TIPOS: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  doc: "application/msword",
  xls: "application/vnd.ms-excel",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  txt: "text/plain; charset=utf-8",
};
interface MetaDoc {
  titulo: string;
  nombre: string; // nombre del archivo
  tipo: string; // extensión
  categoria: string;
  bytes: number;
  subido: string; // ISO
}

async function documentos(req: Request, env: Env, url: URL): Promise<Response> {
  const email = await emailVerificado(req, env);
  if (!email) return json({ error: "Entra con tu correo para ver la documentación." }, 401);
  const usuario = await leerUsuario(env, email);
  if (!usuario || usuario.clinicas.length === 0) return json({ error: "Tu usuario no tiene ninguna clínica asignada." }, 403);
  const admin = usuario.clinicas.includes("*");
  const partes = url.pathname.split("/").slice(3); // ["", "api", "docs", ...]

  // Cambios (subir/borrar): solo Daniel y solo desde la propia web (no desde otra página).
  if (req.method === "POST" || req.method === "DELETE") {
    if (!admin) return json({ error: "Solo Daniel puede subir o borrar documentos." }, 403);
    const origen = req.headers.get("origin");
    if (!origen || origen !== url.origin) return json({ error: "Origen no permitido." }, 403);
  }

  if (req.method === "GET" && partes.length === 0) {
    const pedida = url.searchParams.get("clinica");
    const clinica = pedida ?? (admin ? null : usuario.clinicas[0]);
    if (clinica && clinica !== COMUN && !puedeVer(usuario, clinica)) return json({ error: "No tienes acceso a esta clínica." }, 403);
    const ambitos = clinica && clinica !== COMUN ? [clinica, COMUN] : [COMUN];
    const docs: any[] = [];
    for (const a of ambitos) {
      let cursor: string | undefined;
      do {
        const l: KVNamespaceListResult<MetaDoc> = await env.DATOS.list<MetaDoc>({ prefix: `doc:${a}:`, cursor });
        for (const k of l.keys) if (k.metadata) docs.push({ ambito: a, id: k.name.split(":")[2], ...k.metadata });
        cursor = l.list_complete ? undefined : l.cursor;
      } while (cursor);
    }
    docs.sort((x, y) => (y.subido > x.subido ? 1 : -1));
    return json({ admin, clinica, docs });
  }

  if (req.method === "POST" && partes.length === 0) {
    const largo = Number(req.headers.get("content-length") ?? "0");
    if (largo > MAX_DOC + 100_000) return json({ error: "Archivo demasiado grande (máximo 20 MB)." }, 413);
    let form: FormData;
    try { form = await req.formData(); } catch { return json({ error: "Formulario no válido." }, 400); }
    const ambito = String(form.get("clinica") ?? "");
    if (!/^[a-z0-9-]{3,40}$/.test(ambito)) return json({ error: "Clínica no válida." }, 400);
    const archivo = form.get("archivo");
    if (!archivo || typeof archivo === "string") return json({ error: "Falta el archivo." }, 400);
    const f = archivo as unknown as File;
    if (f.size > MAX_DOC) return json({ error: "Archivo demasiado grande (máximo 20 MB)." }, 413);
    const nombre = limpiar(f.name || "documento", 120);
    const ext = (nombre.split(".").pop() || "").toLowerCase();
    if (!TIPOS[ext]) return json({ error: `Tipo de archivo no permitido (.${ext}). Usa PDF, Word, Excel, PowerPoint, imagen o texto.` }, 400);
    const meta: MetaDoc = {
      titulo: limpiar(String(form.get("titulo") || nombre.replace(/\.[^.]+$/, "")), 120),
      nombre,
      tipo: ext,
      categoria: limpiar(String(form.get("categoria") || "General"), 40),
      bytes: f.size,
      subido: new Date().toISOString(),
    };
    const id = crypto.randomUUID();
    await env.DATOS.put(`doc:${ambito}:${id}`, await f.arrayBuffer(), { metadata: meta });
    return json({ ok: true, ambito, id, ...meta });
  }

  if (partes.length === 2) {
    const [ambito, id] = partes.map(decodeURIComponent);
    if (!/^[a-z0-9-]{3,40}$/.test(ambito) || !/^[0-9a-f-]{36}$/.test(id)) return json({ error: "No existe" }, 404);
    if (ambito !== COMUN && !puedeVer(usuario, ambito)) return json({ error: "No tienes acceso a este documento." }, 403);
    const clave = `doc:${ambito}:${id}`;
    if (req.method === "DELETE") {
      await env.DATOS.delete(clave);
      return json({ ok: true });
    }
    if (req.method === "GET") {
      const r = await env.DATOS.getWithMetadata<MetaDoc>(clave, "arrayBuffer");
      if (!r.value || !r.metadata) return json({ error: "No existe" }, 404);
      const m = r.metadata;
      const enLinea = m.tipo === "png" || m.tipo === "jpg" || m.tipo === "jpeg";
      const disp = `${enLinea ? "inline" : "attachment"}; filename="${m.nombre.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "")}"; filename*=UTF-8''${encodeURIComponent(m.nombre)}`;
      return new Response(r.value, {
        headers: {
          "content-type": TIPOS[m.tipo] ?? "application/octet-stream",
          "content-disposition": disp,
          "cache-control": "private, no-store",
          "x-content-type-options": "nosniff",
          "content-security-policy": "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
          "referrer-policy": "no-referrer",
        },
      });
    }
  }
  return json({ error: "No existe" }, 404);
}

function limpiar(s: string, max: number): string {
  return s.replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, max) || "documento";
}

/* ------------------------------------------------------------------ */
/*  /api/subir: el script de exportación deja aquí la foto de totales  */
/* ------------------------------------------------------------------ */
async function subir(req: Request, env: Env): Promise<Response> {
  if (!env.SUBIR_TOKEN) return json({ error: "Falta configurar SUBIR_TOKEN." }, 503);
  const auth = req.headers.get("authorization") ?? "";
  if (!igualSeguro(auth.trim(), `Bearer ${env.SUBIR_TOKEN.trim()}`)) return json({ error: "Token no válido." }, 401);

  const largo = Number(req.headers.get("content-length") ?? "0");
  if (largo > MAX_SUBIDA) return json({ error: "Archivo demasiado grande." }, 413);
  const texto = await req.text();
  if (texto.length > MAX_SUBIDA) return json({ error: "Archivo demasiado grande." }, 413);

  let foto: any;
  try {
    foto = JSON.parse(texto);
  } catch {
    return json({ error: "El contenido no es JSON válido." }, 400);
  }
  const problema = validarFoto(foto);
  if (problema) return json({ error: problema }, 400);

  const clinica: string = foto.clinica.id;
  // Guardamos la foto actual y una copia con fecha (se borra sola a los 90 días).
  await env.DATOS.put(`foto:${clinica}`, texto);
  await env.DATOS.put(`historico:${clinica}:${foto.generado}`, texto, { expirationTtl: 60 * 60 * 24 * 90 });
  return json({ ok: true, clinica, semanas: foto.semanas.length, anios: foto.anios.length });
}

/** Comprobaciones mínimas del contrato (docs/contrato-datos.md) y de privacidad. */
export function validarFoto(f: any): string | null {
  if (!f || f.version !== 1) return "Falta version: 1.";
  if (!f.clinica?.id || !/^[a-z0-9-]{3,40}$/.test(f.clinica.id)) return "clinica.id no válido (minúsculas, números y guiones).";
  if (typeof f.generado !== "string") return "Falta la fecha 'generado'.";
  if (!Array.isArray(f.semanas) || !Array.isArray(f.anios)) return "Faltan 'semanas' o 'anios'.";
  // Red de seguridad RGPD: ninguna clave que huela a dato de paciente.
  const prohibidas = /paciente_?id|pacienteid|dni|nif|telefono|tel[eé]fono|email|correo|nombre_paciente|historia/i;
  const encontrada = buscarClave(f, prohibidas);
  if (encontrada) return `La foto contiene un campo no permitido (${encontrada}). Solo se suben totales.`;
  return null;
}

function buscarClave(o: any, re: RegExp, prof = 0): string | null {
  if (prof > 12 || o === null || typeof o !== "object") return null;
  for (const [k, v] of Object.entries(o)) {
    if (re.test(k)) return k;
    const r = buscarClave(v, re, prof + 1);
    if (r) return r;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/*  Login: Cloudflare Access (código de un solo uso al correo)         */
/* ------------------------------------------------------------------ */
async function emailVerificado(req: Request, env: Env): Promise<string | null> {
  if (env.DEV_EMAIL && new URL(req.url).hostname === "localhost") return env.DEV_EMAIL.toLowerCase();
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) return null;
  const token = req.headers.get("cf-access-jwt-assertion");
  if (!token) return null;
  try {
    const payload = await verificarJwt(token, env.ACCESS_TEAM_DOMAIN, env.ACCESS_AUD);
    return typeof payload.email === "string" ? payload.email.toLowerCase() : null;
  } catch {
    return null;
  }
}

let certsCache: { keys: JsonWebKey[]; hasta: number } | null = null;

async function verificarJwt(token: string, equipo: string, aud: string): Promise<any> {
  const [h64, p64, s64] = token.split(".");
  if (!h64 || !p64 || !s64) throw new Error("JWT mal formado");
  const header = JSON.parse(b64urlTexto(h64));
  const payload = JSON.parse(b64urlTexto(p64));

  const ahora = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < ahora) throw new Error("caducado");
  if (payload.nbf && payload.nbf > ahora + 60) throw new Error("aún no válido");
  const auds: string[] = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!auds.includes(aud)) throw new Error("aud distinto");
  if (payload.iss !== `https://${equipo}`) throw new Error("emisor distinto");

  if (!certsCache || certsCache.hasta < Date.now()) {
    const r = await fetch(`https://${equipo}/cdn-cgi/access/certs`);
    const j: any = await r.json();
    certsCache = { keys: j.keys, hasta: Date.now() + 60 * 60 * 1000 };
  }
  const jwk = certsCache.keys.find((k: any) => k.kid === header.kid);
  if (!jwk) throw new Error("clave desconocida");
  const clave = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    clave,
    b64urlBytes(s64),
    new TextEncoder().encode(`${h64}.${p64}`),
  );
  if (!ok) throw new Error("firma no válida");
  return payload;
}

async function leerUsuario(env: Env, email: string): Promise<Usuario | null> {
  return (await env.DATOS.get(`usuario:${email}`, "json")) as Usuario | null;
}

function puedeVer(u: Usuario, clinica: string): boolean {
  return u.clinicas.includes("*") || u.clinicas.includes(clinica);
}

/* ------------------------------------------------------------------ */
/*  Utilidades                                                          */
/* ------------------------------------------------------------------ */
function json(o: unknown, status = 200): Response {
  return conCabeceras(
    new Response(JSON.stringify(o), {
      status,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    }),
  );
}

function conCabeceras(res: Response): Response {
  const r = new Response(res.body, res);
  r.headers.set("x-content-type-options", "nosniff");
  r.headers.set("referrer-policy", "no-referrer");
  r.headers.set("x-frame-options", "DENY");
  r.headers.set(
    "content-security-policy",
    "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
  );
  return r;
}

function igualSeguro(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

function b64urlBytes(s: string): Uint8Array {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}
function b64urlTexto(s: string): string {
  return new TextDecoder().decode(b64urlBytes(s));
}
