# Contrato de datos (versión 1)

El script `exportar/Exportar-TIMON.ps1` genera un JSON con esta forma y lo sube a `/api/subir`.
Cada campo es **una medida de Power BI** (`_Medidas.tmdl`), evaluada por el propio modelo. El portal no recalcula nada.

Las listas `semanas` y `anios` van de la más reciente a la más antigua.

## Cabecera

| Campo | Contenido |
|---|---|
| `version` | `1` |
| `clinica.id` / `clinica.nombre` | De `exportar/config.json` |
| `generado` | Fecha y hora de la exportación |
| `fechaDatos.texto` | `[Fecha de los datos]` |

## `semanas[]` · hoja 0, Repaso semanal

Filtro: `TREATAS({inicio}, Sel_Semana[Inicio semana])`. La primera es la última semana completa (`[Inicio semana análisis]`).

| Campo | Medida |
|---|---|
| `inicio` | `Sel_Semana[Inicio semana]` |
| `texto` | `[Texto semana]` |
| `tarjetas.produccion` | `[Producción · semana]` |
| `tarjetas.ingresado` | `[Ingresado · semana]` |
| `tarjetas.pctOcupacion` | `[% Ocupación · semana]` |
| `tarjetas.pctFallos` | `[% Fallos de cita · semana]` |
| `tarjetas.pacientesNuevos` | `[Pacientes nuevos · semana]` |
| `indicadores[]` | `Dim_Indicador_Semanal` (Orden, Mando, Indicador) con `[Esta semana]`, `[Semana anterior]`, `[Var. vs semana anterior]`, `[Media 4 semanas]`, `[Var. vs media 4 semanas]`, `[Tendencia]`, `[Color tendencia]`. Son **textos ya formateados por Power BI**. |
| `ultimas12[]` | Por `Calendario[Inicio semana]`: `[Producción (12 semanas)]`, `[Ingresado (12 semanas)]` |
| `ocupacionPrevista` | `[% Ocupación prevista próxima semana]` |
| `presupuestosPendientes90` | `[Presupuestos pendientes últimos 90 días]` |
| `horasProximaSemana[]` | Por `Dim_Profesional[Profesional]`: `[Horas citadas próxima semana]` |

## `anios[]` · hojas 1, 2, 3, 4, 5 y 7

Filtro: `TREATAS({año}, Calendario[Año])`.

| Bloque | Campos → medidas |
|---|---|
| `resumen` (hoja 1) | produccion `[Producción]`, varProduccion `[Var. producción %]`, ingresado `[Ingresado]`, pctFinanciado `[% Financiado]`, pctMargen `[% Margen clínica]`, pctOcupacion `[% Ocupación]`, pctAceptacionImporte `[% Aceptación (importe)]`, pacientesNuevos `[Pacientes nuevos]` |
| `mensual[]` | Por `Calendario[Año-Mes]`: `[Producción]`, `[Producción año anterior]`, `[Ingresado]` |
| `porProfesional[]` | Por `Dim_Profesional[Profesional]`: `[Producción]`, `[Consumo (laboratorio y material)]`, `[Liquidación colaboradoras]`, `[Margen clínica]`, `[% Margen clínica]`, `[Horas atendidas]`, `[Producción por hora]`, `[Horas libres en horario]`, `[% Ocupación agenda]` |
| `tesoreria` (hoja 7) | `[Ingresado]`, `[Financiado]`, `[% Financiado]`, `[Descuadre de caja]`, `[Cierres con descuadre]`; porFormaPago por `Dim_FormaPago[FormaPago]` `[Ingresado]`; porFinanciera por `Fact_Ingresos[Financiera]` `[Financiado]` |
| `ingresos` (hoja 2) | `[Producción]`, `[Tratamientos realizados]`, `[Ticket medio por tratamiento]`, `[Cartera planificada]`; porArea por `Dim_Tratamiento[Area]` `[Producción]` |
| `margen` (hoja 3) | `[Consumo (laboratorio y material)]`, `[% Consumo s/ producción]`, `[Liquidación colaboradoras]`, `[Margen clínica]`, `[% Margen clínica]`, `[Producción por hora]` |
| `ocupacion` (hoja 4) | `[% Ocupación]`, `[% Ocupación agenda]`, `[Huecos próximos 7 días (h)]`, `[% Fallos de cita]`, `[Pacientes atendidos]`, `[% Agenda llena próximos 7 días]`, `[Horas libres en horario]`; mensual por `Calendario[Año-Mes]`: `[% Ocupación]`, `[Citas atendidas]`, `[Citas canceladas]`, `[Citas no acude]`, `[Pacientes nuevos]`, `[Primeras visitas]` |
| `negociacion` (hoja 5) | `[Presupuestos presentados]`, `[Importe presentado]`, `[% Aceptación (importe)]`, `[% Aceptación (número)]`, `[Importe pendiente]`, `[Importe perdido]`; porTramo por `Fact_Presupuestos[Tramo]`; porProfesional `[Presupuestos presentados]`, `[% Aceptación (importe)]` |

## Lo que nunca va en el JSON

Identificadores o datos de pacientes (id, nombre, DNI, teléfono, email, historia). El Worker rechaza la subida si encuentra un campo con esos nombres.
