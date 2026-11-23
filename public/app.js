// Portal TIMÓN · pinta la foto de totales exportada desde Power BI.
// No calcula ninguna medida: los valores y los textos (variaciones, tendencias) vienen de Power BI.
(function () {
  "use strict";

  /* ---------- formato (mismas máscaras que las formatString de Power BI) ---------- */
  const grp = (v, dec = 0) => {
    const s = Math.abs(v).toFixed(dec).split(".");
    s[0] = s[0].replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    return (v < 0 ? "-" : "") + s.join(",");
  };
  const vacio = (v) => v === null || v === undefined || Number.isNaN(v);
  const F = {
    eur: (v) => (vacio(v) ? "(En blanco)" : grp(Math.round(v)) + " €"),
    eur2: (v) => (vacio(v) ? "(En blanco)" : grp(v, 2) + " €"),
    pct: (v) => (vacio(v) ? "(En blanco)" : grp(v * 100, 1) + " %"),
    pctSig: (v) => (vacio(v) ? "(En blanco)" : (v >= 0 ? "+" : "") + grp(v * 100, 1) + " %"),
    num: (v) => (vacio(v) ? "(En blanco)" : grp(Math.round(v))),
    h: (v) => (vacio(v) ? "(En blanco)" : grp(v, 1) + " h"),
  };
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const fecha = (iso) => { const [y, m, d] = iso.split("-"); return `${d}/${m}/${y}`; };
  const MES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

  /* ---------- piezas ---------- */
  const card = (t, v, sub, extra, cls) =>
    `<div class="card${cls ? " " + cls : ""}"><h4><span>${esc(t)}</span>${extra || ""}</h4><div class="big">${v}</div>${sub ? `<div class="sub">${sub}</div>` : ""}</div>`;
  const ref = (txt, alerta) => `<span class="ref${alerta ? " alert" : ""}">${esc(txt)}</span>`;
  const leg = (items) => `<div class="legend">${items.map(([c, t]) => `<span><i style="background:${c}"></i>${esc(t)}</span>`).join("")}</div>`;
  function barras(lista, campo, fmt, color) {
    const max = Math.max(...lista.map((r) => Math.abs(r[campo] || 0)), 1);
    return lista
      .map((r) => `<div class="hbar"><span title="${esc(r.nombre ?? r.profesional ?? r.tramo)}">${esc(r.nombre ?? r.profesional ?? r.tramo)}</span><div class="track"><div class="fill" style="width:${(Math.abs(r[campo] || 0) / max) * 100}%;${color ? "background:" + color : ""}"></div></div><span class="num" style="text-align:right">${fmt(r[campo])}</span></div>`)
      .join("");
  }
  function columnas(series, etiquetas, colores, unidad) {
    const W = 330, H = 120, L = 28, n = etiquetas.length, k = series.length;
    const max = Math.max(1, ...series.flat().filter((v) => !vacio(v))) * 1.12;
    const paso = (W - L) / n, bw = Math.min(9, (paso - 4) / k);
    let s = `<svg viewBox="0 0 ${W} ${H + 14}" width="100%" role="img" aria-label="Gráfico de columnas">`;
    [0.5, 1].forEach((f) => { const y = H - (H - 8) * f; s += `<line x1="${L}" x2="${W}" y1="${y}" y2="${y}" stroke="var(--line)"/><text x="0" y="${y + 3}">${grp(Math.round((max * f) / 1000))}${unidad}</text>`; });
    s += `<line x1="${L}" x2="${W}" y1="${H}" y2="${H}" stroke="var(--line)"/>`;
    for (let i = 0; i < n; i++) {
      const x0 = L + i * paso + (paso - bw * k) / 2;
      series.forEach((ser, j) => { const v = ser[i] || 0; const h = ((H - 8) * v) / max; s += `<rect x="${x0 + j * bw}" y="${H - h}" width="${bw - 1}" height="${h}" rx="1.5" fill="${colores[j]}"><title>${esc(etiquetas[i])}: ${F.eur(v)}</title></rect>`; });
      if (n <= 6 || i % 2 === 0) s += `<text x="${L + i * paso + paso / 2}" y="${H + 11}" text-anchor="middle">${esc(etiquetas[i])}</text>`;
    }
    return s + "</svg>";
  }
  function lineas(series, etiquetas, colores) {
    const W = 330, H = 120, L = 28, n = etiquetas.length;
    const max = Math.max(1, ...series.flat().filter((v) => !vacio(v))) * 1.12;
    const x = (i) => L + (i * (W - L - 6)) / Math.max(1, n - 1), y = (v) => H - ((H - 8) * v) / max;
    let s = `<svg viewBox="0 0 ${W} ${H + 14}" width="100%" role="img" aria-label="Gráfico de líneas">`;
    [0.5, 1].forEach((f) => { const yy = H - (H - 8) * f; s += `<line x1="${L}" x2="${W}" y1="${yy}" y2="${yy}" stroke="var(--line)"/><text x="0" y="${yy + 3}">${grp(Math.round((max * f) / 1000))}k</text>`; });
    s += `<line x1="${L}" x2="${W}" y1="${H}" y2="${H}" stroke="var(--line)"/>`;
    series.forEach((ser, j) => {
      const pts = ser.map((v, i) => (vacio(v) ? null : `${x(i)},${y(v)}`)).filter(Boolean);
      s += `<polyline fill="none" stroke="${colores[j]}" stroke-width="2" points="${pts.join(" ")}"/>`;
      let li = -1; ser.forEach((v, i) => { if (!vacio(v)) li = i; });
      if (li >= 0) s += `<circle cx="${x(li)}" cy="${y(ser[li])}" r="3" fill="${colores[j]}"/>`;
    });
    etiquetas.forEach((l, i) => { if (i % 2 === 0) s += `<text x="${x(i)}" y="${H + 11}" text-anchor="middle">${esc(l)}</text>`; });
    return s + "</svg>";
  }
  const tendencia = (fila) => fila ? `<span class="trend" style="color:${esc(fila.color)}">${esc(fila.tendencia)}</span>` : "";

  /* ---------- pantallas: una por hoja de Power BI ---------- */
  const PANT = {
    sem: { t: "Repaso semanal TIMÓN", per: "semana", f: (s) => {
      const ind = (o) => s.indicadores.find((r) => r.orden === o);
      const tj = s.tarjetas;
      let h = `<div class="kpis">`
        + card("Producción · semana", F.eur(tj.produccion), "", tendencia(ind(4)))
        + card("Ingresado · semana", F.eur(tj.ingresado), "", tendencia(ind(1)))
        + card("% Ocupación · semana", F.pct(tj.pctOcupacion), "", tendencia(ind(11)))
        + card("% Fallos de cita · semana", F.pct(tj.pctFallos), "", tendencia(ind(15)))
        + card("Pacientes nuevos · semana", F.num(tj.pacientesNuevos), "", tendencia(ind(16)), "wide")
        + `</div><div class="sec">Indicadores TIMÓN de la semana</div>`;
      let mando = null;
      for (const r of s.indicadores) {
        if (r.mando !== mando) { if (mando !== null) h += `</div>`; h += `<div class="rows"><div class="row head"><span class="n">${esc(r.mando)}</span><span></span></div>`; mando = r.mando; }
        h += `<div class="row"><span class="n">${esc(r.indicador)}</span><span class="v">${esc(r.esta)}</span>
          <span class="c">Sem. ant. ${esc(r.anterior)} (${esc(r.varAnterior)}) · Media 4 sem. ${esc(r.media)} (${esc(r.varMedia)})</span>${tendencia(r).replace('class="trend"', 'class="trend tr"')}</div>`;
      }
      if (mando !== null) h += `</div>`;
      const u = s.ultimas12 || [];
      h += `<div class="card"><h4>Últimas 12 semanas</h4>${columnas([u.map((r) => r.produccion), u.map((r) => r.ingresado)], u.map((r) => { const [, m, d] = r.inicio.split("-"); return `${+d}/${+m}`; }), ["var(--s1)", "var(--s2)"], "k")}${leg([["var(--s1)", "Producción"], ["var(--s2)", "Ingresado"]])}</div>`;
      h += `<div class="kpis">` + card("% Ocupación prevista próxima semana", F.pct(s.ocupacionPrevista), s.ocupacionPrevista < 0.8 ? ref("Por debajo del 80 %: huecos que llenar", true) : ref("Objetivo 80 % o más"))
        + card("Presupuestos pendientes últimos 90 días", F.eur(s.presupuestosPendientes90), "Lista de llamadas de seguimiento") + `</div>`;
      if (s.horasProximaSemana?.length) h += `<div class="card"><h4>Próxima semana · horas citadas</h4>${barras(s.horasProximaSemana, "horas", F.h)}</div>`;
      return h;
    } },
    ano: { t: "Resumen TIMÓN", per: "anio", f: (a) => {
      const r = a.resumen;
      let h = `<div class="kpis">` + card("Producción", F.eur(r.produccion)) + card("Var. producción %", F.pctSig(r.varProduccion), "Frente al mismo periodo del año anterior")
        + card("Ingresado", F.eur(r.ingresado)) + card("% Financiado", F.pct(r.pctFinanciado))
        + card("% Margen clínica", F.pct(r.pctMargen), ref("Meses sin backup salen inflados")) + card("% Ocupación", F.pct(r.pctOcupacion), ref("Objetivo 80–85 %", r.pctOcupacion < 0.7))
        + card("% Aceptación (importe)", F.pct(r.pctAceptacionImporte), ref("Objetivo > 65 %", r.pctAceptacionImporte < 0.5)) + card("Pacientes nuevos", F.num(r.pacientesNuevos)) + `</div>`;
      const m = a.mensual || [];
      h += `<div class="card"><h4>Producción mensual frente al mismo mes del año anterior</h4>${lineas([m.map((x) => x.produccion), m.map((x) => x.produccionAA)], m.map((x) => MES[+x.mes.slice(5) - 1]), ["var(--s1)", "var(--s2)"])}${leg([["var(--s1)", "Producción"], ["var(--s2)", "Producción año anterior"]])}</div>`;
      h += `<div class="card"><h4>Producción por profesional</h4>${barras(a.porProfesional, "produccion", F.eur)}</div>`;
      return h;
    } },
    t: { t: "Tesorería y caja", per: "anio", f: (a) => {
      const t = a.tesoreria;
      return `<div class="kpis">` + card("Ingresado", F.eur(t.ingresado), "Pagos, anticipos y financiación − devoluciones") + card("Financiado", F.eur(t.financiado), `${F.pct(t.pctFinanciado)} de lo ingresado`)
        + card("Descuadre de caja", F.eur2(t.descuadre), ref("Objetivo 0 €", Math.abs(t.descuadre || 0) >= 0.01)) + card("Cierres con descuadre", F.num(t.cierresDescuadre), "Días con más de 1 € de diferencia") + `</div>`
        + `<div class="card"><h4>Ingresado por forma de pago</h4>${barras(t.porFormaPago, "importe", F.eur, "var(--s1)")}</div>`
        + (t.porFinanciera?.length ? `<div class="card"><h4>Financiación de pacientes</h4>${barras(t.porFinanciera, "importe", F.eur, "var(--s2)")}</div>` : "");
    } },
    i: { t: "Producción e ingresos", per: "anio", f: (a) => {
      const x = a.ingresos, m = a.mensual || [];
      return `<div class="kpis">` + card("Producción", F.eur(x.produccion)) + card("Tratamientos realizados", F.num(x.tratamientos)) + card("Ticket medio por tratamiento", F.eur(x.ticketMedio)) + card("Cartera planificada", F.eur(x.cartera), "Trabajo comprometido sin hacer") + `</div>`
        + `<div class="card"><h4>Producción e ingresado por mes</h4>${columnas([m.map((r) => r.produccion), m.map((r) => r.ingresado)], m.map((r) => MES[+r.mes.slice(5) - 1].slice(0, 1)), ["var(--s1)", "var(--s2)"], "k")}${leg([["var(--s1)", "Producción"], ["var(--s2)", "Ingresado"]])}</div>`
        + `<div class="card"><h4>Producción por área</h4>${barras(x.porArea, "importe", F.eur)}</div>`;
    } },
    m: { t: "Margen y profesionales", per: "anio", f: (a) => {
      const x = a.margen;
      let h = `<div class="kpis">` + card("Consumo (laboratorio y material)", F.eur(x.consumo), `${F.pct(x.pctConsumo)} de producción`) + card("Liquidación colaboradoras", F.eur(x.liquidacion), "35 % × (tratamiento − consumo)")
        + card("Margen clínica", F.eur(x.margen)) + card("% Margen clínica", F.pct(x.pctMargen)) + card("Producción por hora", F.eur(x.produccionHora), "", "", "wide") + `</div>`
        + `<div class="warn">Las últimas semanas aún no tienen el consumo de la copia semanal: el % de margen sale inflado. Para hablar de margen, mira meses ya cubiertos por el backup.</div>`;
      h += `<div class="card"><h4>Por profesional</h4><div class="scroll"><table class="tbl"><thead><tr><th>Profesional</th><th>Producción</th><th>Consumo</th><th>Liquidación</th><th>% Margen</th><th>€/hora</th></tr></thead><tbody>`
        + a.porProfesional.map((p) => `<tr><td>${esc(p.profesional)}</td><td>${F.eur(p.produccion)}</td><td>${F.eur(p.consumo)}</td><td>${F.eur(p.liquidacion)}</td><td>${F.pct(p.pctMargen)}</td><td>${F.eur(p.produccionHora)}</td></tr>`).join("")
        + `</tbody></table></div></div>`;
      return h;
    } },
    o: { t: "Ocupación y agenda", per: "anio", f: (a) => {
      const x = a.ocupacion;
      const tot = (x.mensual || []).reduce((s, r) => ({ at: s.at + r.atendidas, ca: s.ca + r.canceladas, na: s.na + r.noAcude }), { at: 0, ca: 0, na: 0 });
      const T = tot.at + tot.ca + tot.na || 1;
      let h = `<div class="kpis">` + card("% Ocupación", F.pct(x.pctOcupacion), ref("Objetivo 80–85 %", x.pctOcupacion < 0.7)) + card("% Ocupación agenda", F.pct(x.pctOcupacionAgenda), "Sobre el horario de cada profesional")
        + card("Huecos próximos 7 días (h)", F.h(x.huecos7), "Horas de horario sin citar") + card("% Fallos de cita", F.pct(x.pctFallos), ref("Objetivo < 10 %", x.pctFallos > 0.15))
        + card("Pacientes atendidos", F.num(x.pacientesAtendidos)) + card("% Agenda llena próximos 7 días", F.pct(x.pctAgendaLlena7)) + `</div>`;
      h += `<div class="card"><h4>Citas por estado</h4><div class="stack"><div style="width:${(tot.at / T) * 100}%;background:var(--s1)"></div><div style="width:${(tot.ca / T) * 100}%;background:var(--s2)"></div><div style="width:${(tot.na / T) * 100}%;background:var(--s3)"></div></div>`
        + leg([["var(--s1)", `Atendida ${F.pct(tot.at / T)}`], ["var(--s2)", `Cancelada ${F.pct(tot.ca / T)}`], ["var(--s3)", `No acude ${F.pct(tot.na / T)}`]]) + `</div>`;
      h += `<div class="card"><h4>Horas libres en horario por profesional</h4>${barras(a.porProfesional.filter((p) => p.horasLibres), "horasLibres", F.h)}</div>`;
      return h;
    } },
    n: { t: "Negociación", per: "anio", f: (a) => {
      const x = a.negociacion;
      let h = `<div class="kpis">` + card("Presupuestos presentados", F.num(x.presentados), F.eur(x.importePresentado)) + card("% Aceptación (importe)", F.pct(x.pctImporte), ref("Objetivo > 65 %", x.pctImporte < 0.5))
        + card("% Aceptación (número)", F.pct(x.pctNumero), "Si es mucho mayor que el de importe, se pierden los grandes") + card("Importe pendiente", F.eur(x.pendiente), "Hay que llamar")
        + card("Importe perdido", F.eur(x.perdido), "Rechazados, descartados o desistidos", "", "wide") + `</div>`;
      h += `<div class="card"><h4>Aceptación por tamaño (importe)</h4>${barras(x.porTramo, "pctImporte", F.pct)}</div>`;
      if (x.porProfesional?.length) h += `<div class="card"><h4>% Aceptación (importe) por profesional</h4>${barras(x.porProfesional, "pctImporte", F.pct, "var(--s4)")}</div>`;
      return h;
    } },
  };

  /* ---------- estado y navegación ---------- */
  let foto = null, scr = "sem", wi = 0, yi = 0;
  const $ = (id) => document.getElementById(id);
  const body = $("body");

  function render() {
    if (!foto) return;
    const p = PANT[scr];
    const semanas = foto.semanas, anios = foto.anios;
    const actual = p.per === "semana" ? semanas[wi] : anios[yi];
    $("scrTitle").textContent = p.t;
    $("perLabel").textContent = p.per === "semana"
      ? (actual ? `Semana del ${fecha(actual.inicio).slice(0, 5)} al ${(() => { const d = new Date(actual.inicio + "T12:00:00"); d.setDate(d.getDate() + 6); return d.toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" }); })()}` : "Sin semanas")
      : (actual ? `Año ${actual.anio}` : "Sin años");
    const lista = p.per === "semana" ? semanas : anios, idx = p.per === "semana" ? wi : yi;
    $("prev").disabled = idx >= lista.length - 1; // la lista va de más reciente a más antigua
    $("next").disabled = idx <= 0;
    $("fresh").textContent = p.per === "semana" && actual ? actual.texto : foto.fechaDatos?.texto || "";
    document.querySelectorAll(".tabs button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.s === scr)));
    try { body.innerHTML = actual ? p.f(actual) : `<div class="card">No hay datos para este periodo.</div>`; }
    catch (e) { console.error(e); body.innerHTML = `<div class="card">Esta hoja no se ha podido mostrar. Avisa a Daniel.</div>`; }
    window.scrollTo(0, 0);
  }

  document.querySelector(".tabs").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { scr = b.dataset.s; render(); } });
  $("prev").addEventListener("click", () => { if (PANT[scr].per === "semana") wi++; else yi++; render(); });
  $("next").addEventListener("click", () => { if (PANT[scr].per === "semana") wi--; else yi--; render(); });

  // Tema claro / oscuro (por defecto claro; se recuerda en este móvil)
  function setMode(m) {
    document.documentElement.dataset.mode = m;
    document.querySelectorAll(".mode button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.m === m)));
    try { localStorage.setItem("timon-tema", m); } catch (e) {}
  }
  document.querySelector(".mode").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) setMode(b.dataset.m); });
  setMode(document.documentElement.dataset.mode === "dark" ? "dark" : "light");

  /* ---------- carga de datos ---------- */
  async function cargar(clinica) {
    const r = await fetch("/api/datos" + (clinica ? `?clinica=${encodeURIComponent(clinica)}` : ""), { credentials: "same-origin" });
    const j = await r.json();
    if (!r.ok) { body.innerHTML = `<div class="card">${esc(j.error || "No se han podido cargar los datos.")}</div>`; return; }
    foto = j; wi = 0; yi = 0;
    $("clinica").textContent = foto.clinica?.nombre || "Dirige tu Clínica";
    const av = $("aviso");
    if (foto.ejemplo) { av.hidden = false; av.textContent = "Datos de ejemplo: no son cifras de ninguna clínica."; } else av.hidden = true;
    render();
  }

  (async function inicio() {
    try {
      const yo = await (await fetch("/api/yo", { credentials: "same-origin" })).json();
      if (yo.modo === "real" && yo.clinicas && yo.clinicas.length > 1) {
        const sel = $("selClinica");
        sel.innerHTML = yo.clinicas.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
        sel.hidden = false;
        sel.addEventListener("change", () => cargar(sel.value));
        await cargar(yo.clinicas[0]);
      } else {
        await cargar(yo.clinicas && yo.clinicas[0]);
      }
    } catch (e) {
      console.error(e);
      body.innerHTML = `<div class="card">No se han podido cargar los datos. Comprueba la conexión y vuelve a entrar.</div>`;
    }
  })();
})();
