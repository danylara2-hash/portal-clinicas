// Área de clientes: portada y documentación.
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const esDocs = document.body.dataset.pagina === "documentos";

  // Tema claro / oscuro (el mismo que el cuadro de mando)
  function setMode(m) {
    document.documentElement.dataset.mode = m;
    document.querySelectorAll(".mode button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.m === m)));
    try { localStorage.setItem("timon-tema", m); } catch (e) {}
  }
  document.querySelector(".mode").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) setMode(b.dataset.m); });
  setMode(document.documentElement.dataset.mode === "dark" ? "dark" : "light");

  function aviso(t) { const a = $("aviso"); a.hidden = !t; a.textContent = t || ""; }
  const bytes = (n) => (n > 1e6 ? (n / 1e6).toFixed(1).replace(".", ",") + " MB" : Math.max(1, Math.round(n / 1e3)) + " KB");
  const dia = (iso) => new Date(iso).toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" });

  let yo = null, clinica = null;

  function ponerClinica(c) {
    clinica = c;
    try { localStorage.setItem("area-clinica", c); } catch (e) {}
    const q = c ? `?clinica=${encodeURIComponent(c)}` : "";
    if ($("irPanel")) $("irPanel").href = "/panel" + q;
    if ($("irDocs")) $("irDocs").href = "/documentos" + q;
    if (esDocs) { history.replaceState(null, "", location.pathname + q); cargarDocs(); }
  }

  /* ---------- documentación ---------- */
  async function cargarDocs() {
    const lista = $("lista");
    lista.innerHTML = `<div class="card">Cargando…</div>`;
    try {
      const r = await fetch("/api/docs" + (clinica ? `?clinica=${encodeURIComponent(clinica)}` : ""), { credentials: "same-origin" });
      const j = await r.json();
      if (!r.ok) { lista.innerHTML = `<div class="card">${esc(j.error || "No se ha podido cargar la documentación.")}</div>`; return; }
      if (j.docs.length === 0) { lista.innerHTML = `<div class="card vacio">Todavía no hay documentos.</div>`; return; }
      const grupos = {};
      for (const d of j.docs) (grupos[d.categoria] ||= []).push(d);
      lista.innerHTML = Object.keys(grupos).sort((a, b) => a.localeCompare(b, "es")).map((cat) => `
        <section class="grupo">
          <h2 class="sec">${esc(cat)}</h2>
          ${grupos[cat].map((d) => {
            const url = `/api/docs/${encodeURIComponent(d.ambito)}/${encodeURIComponent(d.id)}`;
            const para = j.admin ? (d.ambito === "comun" ? " · Todas las clínicas" : " · " + d.ambito) : (d.ambito === "comun" ? " · Para todas las clínicas" : "");
            return `<div class="doc">
              <span class="ext ${esc(d.tipo)}">${esc(d.tipo)}</span>
              <div><a class="t" href="${url}" target="_blank" rel="noopener">${esc(d.titulo)}</a>
                <div class="m">${dia(d.subido)} · ${bytes(d.bytes)}${esc(para)}</div></div>
              <div class="acc"><a href="${url}" download>Descargar</a>${j.admin ? `<button type="button" class="borrar" data-url="${url}" data-t="${esc(d.titulo)}">Borrar</button>` : ""}</div>
            </div>`;
          }).join("")}
        </section>`).join("");
    } catch (e) {
      console.error(e);
      lista.innerHTML = `<div class="card">No se ha podido cargar la documentación. Comprueba la conexión.</div>`;
    }
  }

  if (esDocs) {
    $("lista").addEventListener("click", async (e) => {
      const b = e.target.closest("button.borrar");
      if (!b) return;
      if (!confirm(`¿Borrar «${b.dataset.t}»? No se puede deshacer.`)) return;
      b.disabled = true;
      const r = await fetch(b.dataset.url, { method: "DELETE", credentials: "same-origin" });
      if (!r.ok) { const j = await r.json().catch(() => ({})); aviso(j.error || "No se ha podido borrar."); b.disabled = false; return; }
      cargarDocs();
    });

    $("subir").addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = e.target, est = $("estadoSubir"), btn = f.querySelector("button[type=submit]");
      const archivo = f.archivo.files[0];
      if (!archivo) return;
      if (archivo.size > 20e6) { est.className = "estado err"; est.textContent = "El archivo pasa de 20 MB."; return; }
      btn.disabled = true; est.className = "estado"; est.textContent = "Subiendo…";
      try {
        const r = await fetch("/api/docs", { method: "POST", body: new FormData(f), credentials: "same-origin" });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "No se ha podido subir.");
        est.textContent = `Subido: ${j.titulo}`;
        f.archivo.value = ""; f.titulo.value = "";
        cargarDocs();
      } catch (err) {
        est.className = "estado err"; est.textContent = err.message;
      } finally { btn.disabled = false; }
    });
  }

  /* ---------- inicio ---------- */
  (async function inicio() {
    try {
      yo = await (await fetch("/api/yo", { credentials: "same-origin" })).json();
    } catch (e) { aviso("No se ha podido conectar. Comprueba la conexión y vuelve a entrar."); return; }

    if (yo.modo !== "real") {
      $("saludo").textContent = "Vista de prueba";
      aviso("No has entrado con tu correo: solo se ven datos de ejemplo.");
      if (esDocs) $("lista").innerHTML = `<div class="card vacio">Entra con tu correo para ver la documentación.</div>`;
      return;
    }
    const nombre = yo.nombre || yo.email;
    $("saludo").textContent = `Hola, ${nombre}`;

    const clinicas = yo.clinicas || [];
    const admin = yo.admin === true;
    const pedida = new URLSearchParams(location.search).get("clinica");
    let guardada = null; try { guardada = localStorage.getItem("area-clinica"); } catch (e) {}
    const inicial = [pedida, guardada].find((c) => c && clinicas.includes(c)) || clinicas[0] || null;

    if (clinicas.length > 1) {
      const sel = $("selClinica");
      sel.innerHTML = clinicas.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
      sel.value = inicial;
      sel.hidden = false;
      sel.addEventListener("change", () => ponerClinica(sel.value));
    }

    if (esDocs && admin) {
      const para = $("subirPara");
      para.innerHTML = clinicas.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("") + `<option value="comun">Todas las clínicas</option>`;
      $("bloqueSubir").hidden = false;
      if (inicial) para.value = inicial;
    }
    if (!clinicas.length && !admin) aviso("Tu usuario no tiene ninguna clínica asignada. Habla con Daniel.");
    ponerClinica(inicial);
  })();
})();
