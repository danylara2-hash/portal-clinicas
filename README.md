# Portal de clínicas · Dirige tu Clínica

Cuadro de mando **TIMÓN** en el móvil para cada clínica cliente. La primera es la Clínica Dental Inés Iranzo.

## Cómo funciona

```
Power BI Desktop (TIMÓN, en el portátil de Daniel)
   │  1. Daniel pulsa Actualizar, como cada lunes
   │  2. exportar/Exportar-TIMON.ps1 pregunta al modelo el valor de cada medida (DAX)
   ▼
JSON de totales (sin pacientes)  ──POST /api/subir──►  Worker de Cloudflare  ──►  KV (foto:<clinica>)
                                                              │
                     Doctora entra con su correo (Cloudflare Access) ──GET /api/datos──► web móvil (public/)
```

- **Power BI es el maestro.** Ni el script ni el Worker calculan medidas: el script pide a Power BI cada medida por su nombre y el portal solo la enseña. Así las cifras son idénticas a las de Power BI.
- **RGPD.** Solo salen del portátil sumas, recuentos y porcentajes. El Worker rechaza cualquier foto con campos de pacientes (`PacienteId`, DNI, teléfono, email…).
- **Sin login verificado no hay datos reales.** Mientras Cloudflare Access no esté configurado, el portal solo enseña `public/ejemplo.json`.

## Pantallas (una por hoja de Power BI)

| Móvil | Hoja de Power BI | Selector |
|---|---|---|
| 0 · Semana | 0. Repaso semanal | Semana (la última completa) |
| 1 · Año | 1. Resumen TIMÓN | Año |
| T | 7. Tesorería y caja | Año |
| I | 2. Producción e ingresos | Año |
| M | 3. Margen y profesionales | Año |
| Ó | 4. Ocupación y agenda | Año |
| N | 5. Negociación | Año |

La hoja 6 (Cuenta de resultados) no está en el móvil.

## Carpetas

- `src/index.ts`: el Worker (login, `/api/datos`, `/api/yo`, `/api/subir`).
- `public/`: la web del móvil (HTML, CSS y JS sin dependencias) y `ejemplo.json`.
- `exportar/`: script de PowerShell que exporta desde Power BI Desktop. `config.json` y `salida/` no se suben nunca.
- `docs/contrato-datos.md`: formato del JSON y de qué medida sale cada campo.
- `docs/puesta-en-marcha.md`: pasos en Cloudflare (KV, secreto, Access) y alta de una clínica nueva.

## Desarrollo

```bash
npm install
npm run dev      # http://localhost:8787 con datos de ejemplo
npm run check    # comprobación de tipos
```

## Reglas

- Repositorio privado. Nunca subir datos de pacientes, backups de Nubimed, nóminas, facturas ni claves.
- Las claves van en secretos de Cloudflare (`wrangler secret put`) o en `exportar/config.json` del portátil, nunca en el código.
- Si una medida cambia en Power BI, se cambia primero en TIMÓN; el portal la recoge en la siguiente exportación.
