// Aplica el tema guardado antes de pintar la página (evita el parpadeo). Por defecto: claro.
try {
  var t = localStorage.getItem("timon-tema");
  if (t === "dark" || t === "light") document.documentElement.dataset.mode = t;
} catch (e) {}
