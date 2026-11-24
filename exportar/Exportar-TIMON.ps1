<#
.SYNOPSIS
  Exporta los totales del Power BI TIMÓN abierto en este ordenador y los sube al portal de clínicas.

.DESCRIPTION
  Power BI es el maestro: este script NO calcula nada. Pregunta al propio modelo de Power BI Desktop
  (el que tienes abierto y actualizado) el valor de cada medida, con consultas DAX, y guarda el resultado
  en un JSON de totales. Ningún dato de pacientes sale del ordenador: solo sumas, recuentos y porcentajes.

  Uso normal (cada lunes, después de pulsar Actualizar en Power BI):
      1. Abre TIMON_<clinica>.pbip en Power BI Desktop y pulsa Actualizar.
      2. Clic derecho en este archivo > "Ejecutar con PowerShell"   (o: .\Exportar-TIMON.ps1)

  Configuración: copia config.ejemplo.json como config.json (en esta misma carpeta) y rellénalo.
  config.json no se sube nunca a GitHub (.gitignore).

.PARAMETER SoloArchivo
  Genera el JSON en exportar\salida\ pero no lo sube al portal (para revisarlo antes).
#>
[CmdletBinding()]
param(
  [switch]$SoloArchivo,
  [string]$Config = ""
)

# Carpeta del script (en PowerShell 5.1 $PSScriptRoot puede venir vacío en algunos lanzadores)
$Carpeta = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
if (-not $Config) { $Config = Join-Path $Carpeta "config.json" }

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Paso($t) { Write-Host "· $t" -ForegroundColor Cyan }
function Fallo($t) { Write-Host "✗ $t" -ForegroundColor Red; Read-Host "Pulsa Intro para cerrar"; exit 1 }

# ---------------------------------------------------------------------------
# 1. Configuración
# ---------------------------------------------------------------------------
if (-not (Test-Path $Config)) { Fallo "No encuentro $Config. Copia config.ejemplo.json como config.json y rellénalo." }
$cfg = Get-Content $Config -Raw -Encoding UTF8 | ConvertFrom-Json
if (-not $cfg.clinicaId -or $cfg.clinicaId -notmatch '^[a-z0-9-]{3,40}$') { Fallo "clinicaId no válido en config.json (minúsculas, números y guiones)." }
$numSemanas = if ($cfg.semanas) { [int]$cfg.semanas } else { 12 }
$numAnios   = if ($cfg.anios)   { [int]$cfg.anios }   else { 3 }

# ---------------------------------------------------------------------------
# 2. Encontrar el Power BI Desktop abierto (su motor local escucha en un puerto)
# ---------------------------------------------------------------------------
Paso "Buscando Power BI Desktop abierto…"
$carpetas = @(
  (Join-Path $env:LOCALAPPDATA "Microsoft\Power BI Desktop\AnalysisServicesWorkspaces"),
  (Join-Path $env:USERPROFILE  "Microsoft\Power BI Desktop Store App\AnalysisServicesWorkspaces")
) | Where-Object { Test-Path $_ }
$puertos = foreach ($c in $carpetas) {
  Get-ChildItem $c -Directory | ForEach-Object {
    $f = Join-Path $_.FullName "Data\msmdsrv.port.txt"
    if (Test-Path $f) { [pscustomobject]@{ Puerto = [int]((Get-Content $f -Encoding Unicode -Raw).Trim()); Fecha = (Get-Item $f).LastWriteTime } }
  }
}
$puertos = @($puertos | Sort-Object Fecha -Descending)
if ($puertos.Count -eq 0) { Fallo "No hay ningún Power BI Desktop abierto. Abre el .pbip de la clínica, pulsa Actualizar y vuelve a ejecutar." }

# ---------------------------------------------------------------------------
# 3. Cargar el cliente ADOMD que trae Power BI Desktop
# ---------------------------------------------------------------------------
# Primero, la carpeta del propio Power BI que está abierto (sirve también para la versión de Microsoft Store)
$desdeProceso = @(Get-Process PBIDesktop, msmdsrv -ErrorAction SilentlyContinue | ForEach-Object {
  try { $d = Split-Path -Parent $_.Path; Join-Path $d "Microsoft.PowerBI.AdomdClient.dll"; Join-Path $d "Microsoft.AnalysisServices.AdomdClient.dll" } catch {}
})
$dlls = $desdeProceso + @(
  (Join-Path $env:ProgramFiles "Microsoft Power BI Desktop\bin\Microsoft.PowerBI.AdomdClient.dll"),
  (Join-Path ${env:ProgramFiles(x86)} "Microsoft Power BI Desktop\bin\Microsoft.PowerBI.AdomdClient.dll")
) + @(Get-ChildItem "$env:ProgramFiles\WindowsApps\Microsoft.MicrosoftPowerBIDesktop_*\bin\Microsoft.PowerBI.AdomdClient.dll" -ErrorAction SilentlyContinue | ForEach-Object FullName) `
  + @(Get-ChildItem "$env:windir\Microsoft.NET\assembly\GAC_MSIL\Microsoft.AnalysisServices.AdomdClient\*\Microsoft.AnalysisServices.AdomdClient.dll" -ErrorAction SilentlyContinue | ForEach-Object FullName)
$candidatas = @($dlls | Where-Object { $_ -and (Test-Path $_) } | Select-Object -Unique)
if ($candidatas.Count -eq 0) {
  $rutas = (Get-Process PBIDesktop, msmdsrv -ErrorAction SilentlyContinue | ForEach-Object { $_.Path }) -join "; "
  Fallo "No encuentro Microsoft.PowerBI.AdomdClient.dll. Power BI está en: $rutas"
}
# LoadFrom (no Add-Type): carga la DLL y sus dependencias desde su propia carpeta
$cargada = $false; $errores = @()
foreach ($dll in $candidatas) {
  try {
    $asm = [System.Reflection.Assembly]::LoadFrom($dll)
    if ($asm.GetType("Microsoft.AnalysisServices.AdomdClient.AdomdConnection", $true)) { $cargada = $true; break }
  } catch {
    $e = $_.Exception; while ($e.InnerException) { $e = $e.InnerException }
    $det = if ($e -is [System.Reflection.ReflectionTypeLoadException]) { ($e.LoaderExceptions | Select-Object -First 3 | ForEach-Object Message) -join " | " } else { $e.Message }
    $errores += "$dll -> $det"
  }
}
if (-not $cargada) { Fallo ("No puedo cargar el cliente de Power BI:`n" + ($errores -join "`n")) }

# Elegimos el modelo cuyo nombre de tabla de medidas sea el de TIMÓN
$cn = $null; $motivos = @()
foreach ($p in $puertos) {
  $c = $null
  try {
    $c = New-Object Microsoft.AnalysisServices.AdomdClient.AdomdConnection("Data Source=localhost:$($p.Puerto)")
    $c.Open()
    # ADOMD no admite ExecuteScalar: se lee con ExecuteReader
    $cmd = $c.CreateCommand(); $cmd.CommandText = "EVALUATE ROW(""x"", COUNTROWS(Dim_Indicador_Semanal))"
    $r = $cmd.ExecuteReader(); [void]$r.Read(); $r.Close()
    $cn = $c; break
  } catch {
    $e = $_.Exception; while ($e.InnerException) { $e = $e.InnerException }
    $motivos += "puerto $($p.Puerto): $($e.Message)"
    if ($c) { $c.Dispose() }
  }
}
if (-not $cn) { Fallo ("No consigo leer el TIMÓN abierto en Power BI:`n" + ($motivos -join "`n")) }
Paso "Conectado al modelo TIMÓN (puerto local)."

function Q([string]$dax) {
  $cmd = $cn.CreateCommand(); $cmd.CommandText = $dax
  $r = $cmd.ExecuteReader()
  $filas = New-Object System.Collections.Generic.List[object]
  while ($r.Read()) {
    $o = [ordered]@{}
    for ($i = 0; $i -lt $r.FieldCount; $i++) {
      $n = $r.GetName($i) -replace '^.*\[(.*)\]$', '$1'
      $v = $r.GetValue($i); if ($v -is [System.DBNull]) { $v = $null }
      if ($v -is [datetime]) { $v = $v.ToString("yyyy-MM-dd") }
      $o[$n] = $v
    }
    $filas.Add([pscustomobject]$o)
  }
  $r.Close(); return ,$filas.ToArray()
}
function Q1([string]$dax) { $f = Q $dax; if ($f.Count) { $f[0] } else { $null } }
function D([datetime]$d) { "DATE($($d.Year),$($d.Month),$($d.Day))" }

# ---------------------------------------------------------------------------
# 4. Hoja 0 · Repaso semanal (una entrada por semana, de la más reciente a la más antigua)
# ---------------------------------------------------------------------------
Paso "Leyendo el Repaso semanal…"
# Igual que Power BI sin semana elegida: la más reciente es la última semana COMPLETA antes de la actualización.
$listaSem = Q "EVALUATE VAR Ini = CALCULATE([Inicio semana análisis], REMOVEFILTERS(Sel_Semana)) RETURN TOPN($numSemanas, FILTER(Sel_Semana, Sel_Semana[Inicio semana] <= Ini), Sel_Semana[Orden], ASC) ORDER BY Sel_Semana[Orden] ASC"
$semanas = foreach ($s in $listaSem) {
  $ini = [datetime]$s.'Inicio semana'
  $f = "TREATAS({$(D $ini)}, Sel_Semana[Inicio semana])"
  $t = Q1 @"
EVALUATE CALCULATETABLE(ROW(
  "texto", [Texto semana],
  "produccion", [Producción · semana], "ingresado", [Ingresado · semana],
  "pctOcupacion", [% Ocupación · semana], "pctFallos", [% Fallos de cita · semana], "pacientesNuevos", [Pacientes nuevos · semana],
  "ocupacionPrevista", [% Ocupación prevista próxima semana], "presupuestosPendientes90", [Presupuestos pendientes últimos 90 días]), $f)
"@
  $ind = Q @"
EVALUATE CALCULATETABLE(ADDCOLUMNS(Dim_Indicador_Semanal,
  "esta", [Esta semana], "anterior", [Semana anterior], "varAnterior", [Var. vs semana anterior],
  "media", [Media 4 semanas], "varMedia", [Var. vs media 4 semanas], "tendencia", [Tendencia], "color", [Color tendencia]), $f)
ORDER BY Dim_Indicador_Semanal[Orden]
"@
  $u12 = Q "EVALUATE CALCULATETABLE(FILTER(SUMMARIZECOLUMNS(Calendario[Inicio semana], ""produccion"", [Producción (12 semanas)], ""ingresado"", [Ingresado (12 semanas)]), NOT ISBLANK([produccion]) || NOT ISBLANK([ingresado])), $f) ORDER BY Calendario[Inicio semana]"
  $hp = Q "EVALUATE CALCULATETABLE(SUMMARIZECOLUMNS(Dim_Profesional[Profesional], ""horas"", [Horas citadas próxima semana]), $f) ORDER BY [horas] DESC"
  [ordered]@{
    inicio = $ini.ToString("yyyy-MM-dd")
    texto = $t.texto
    tarjetas = [ordered]@{ produccion = $t.produccion; ingresado = $t.ingresado; pctOcupacion = $t.pctOcupacion; pctFallos = $t.pctFallos; pacientesNuevos = $t.pacientesNuevos }
    indicadores = @($ind | ForEach-Object { [ordered]@{ orden = [int]$_.Orden; mando = $_.Mando; indicador = $_.Indicador; esta = $_.esta; anterior = $_.anterior; varAnterior = $_.varAnterior; media = $_.media; varMedia = $_.varMedia; tendencia = $_.tendencia; color = $_.color } })
    ultimas12 = @($u12 | ForEach-Object { [ordered]@{ inicio = $_.'Inicio semana'; produccion = $_.produccion; ingresado = $_.ingresado } })
    ocupacionPrevista = $t.ocupacionPrevista
    presupuestosPendientes90 = $t.presupuestosPendientes90
    horasProximaSemana = @($hp | ForEach-Object { [ordered]@{ profesional = $_.Profesional; horas = $_.horas } })
  }
}

# ---------------------------------------------------------------------------
# 5. Hojas 1, 2, 3, 4, 5 y 7 · por año
# ---------------------------------------------------------------------------
Paso "Leyendo el resumen anual y los mandos…"
$listaAnios = Q "EVALUATE TOPN($numAnios, FILTER(VALUES(Calendario[Año]), [Producción] > 0), Calendario[Año], DESC) ORDER BY Calendario[Año] DESC"
$anios = foreach ($a in $listaAnios) {
  $y = [int]$a.'Año'
  $f = "TREATAS({$y}, Calendario[Año])"
  $r = Q1 @"
EVALUATE CALCULATETABLE(ROW(
  "produccion", [Producción], "varProduccion", [Var. producción %], "ingresado", [Ingresado], "pctFinanciado", [% Financiado],
  "pctMargen", [% Margen clínica], "pctOcupacion", [% Ocupación], "pctAceptacionImporte", [% Aceptación (importe)], "pacientesNuevos", [Pacientes nuevos],
  "financiado", [Financiado], "descuadre", [Descuadre de caja], "cierresDescuadre", [Cierres con descuadre],
  "tratamientos", [Tratamientos realizados], "ticketMedio", [Ticket medio por tratamiento], "cartera", [Cartera planificada],
  "consumo", [Consumo (laboratorio y material)], "pctConsumo", [% Consumo s/ producción], "liquidacion", [Liquidación colaboradoras],
  "margen", [Margen clínica], "produccionHora", [Producción por hora],
  "pctOcupacionAgenda", [% Ocupación agenda], "huecos7", [Huecos próximos 7 días (h)], "pctFallos", [% Fallos de cita],
  "pacientesAtendidos", [Pacientes atendidos], "pctAgendaLlena7", [% Agenda llena próximos 7 días], "horasLibres", [Horas libres en horario],
  "presentados", [Presupuestos presentados], "importePresentado", [Importe presentado], "pctImporte", [% Aceptación (importe)],
  "pctNumero", [% Aceptación (número)], "pendiente", [Importe pendiente], "perdido", [Importe perdido]), $f)
"@
  $mes = Q "EVALUATE CALCULATETABLE(SUMMARIZECOLUMNS(Calendario[Año-Mes], ""produccion"", [Producción], ""produccionAA"", [Producción año anterior], ""ingresado"", [Ingresado], ""pctOcupacion"", [% Ocupación], ""atendidas"", [Citas atendidas], ""canceladas"", [Citas canceladas], ""noAcude"", [Citas no acude], ""pacientesNuevos"", [Pacientes nuevos], ""primerasVisitas"", [Primeras visitas]), $f) ORDER BY Calendario[Año-Mes]"
  $pro = Q "EVALUATE CALCULATETABLE(SUMMARIZECOLUMNS(Dim_Profesional[Profesional], ""produccion"", [Producción], ""consumo"", [Consumo (laboratorio y material)], ""liquidacion"", [Liquidación colaboradoras], ""margen"", [Margen clínica], ""pctMargen"", [% Margen clínica], ""horasAtendidas"", [Horas atendidas], ""produccionHora"", [Producción por hora], ""horasLibres"", [Horas libres en horario], ""pctOcupacionAgenda"", [% Ocupación agenda]), $f) ORDER BY [produccion] DESC"
  $fp  = Q "EVALUATE CALCULATETABLE(SUMMARIZECOLUMNS(Dim_FormaPago[FormaPago], ""importe"", [Ingresado]), $f) ORDER BY [importe] DESC"
  $fin = Q "EVALUATE CALCULATETABLE(FILTER(SUMMARIZECOLUMNS(Fact_Ingresos[Financiera], ""importe"", [Financiado]), [importe] <> 0 && Fact_Ingresos[Financiera] <> ""Sin financiar""), $f) ORDER BY [importe] DESC"
  $area = Q "EVALUATE CALCULATETABLE(SUMMARIZECOLUMNS(Dim_Tratamiento[Area], ""importe"", [Producción]), $f) ORDER BY [importe] DESC"
  $tramo = Q "EVALUATE CALCULATETABLE(SUMMARIZECOLUMNS(Fact_Presupuestos[Tramo], ""pctImporte"", [% Aceptación (importe)]), $f) ORDER BY Fact_Presupuestos[Tramo]"
  $prp = Q "EVALUATE CALCULATETABLE(SUMMARIZECOLUMNS(Dim_Profesional[Profesional], ""presentados"", [Presupuestos presentados], ""pctImporte"", [% Aceptación (importe)]), $f) ORDER BY [presentados] DESC"

  [ordered]@{
    anio = $y
    resumen = [ordered]@{ produccion = $r.produccion; varProduccion = $r.varProduccion; ingresado = $r.ingresado; pctFinanciado = $r.pctFinanciado; pctMargen = $r.pctMargen; pctOcupacion = $r.pctOcupacion; pctAceptacionImporte = $r.pctAceptacionImporte; pacientesNuevos = $r.pacientesNuevos }
    mensual = @($mes | ForEach-Object { [ordered]@{ mes = $_.'Año-Mes'; produccion = $_.produccion; produccionAA = $_.produccionAA; ingresado = $_.ingresado } })
    porProfesional = @($pro | ForEach-Object { [ordered]@{ profesional = $_.Profesional; produccion = $_.produccion; consumo = $_.consumo; liquidacion = $_.liquidacion; margen = $_.margen; pctMargen = $_.pctMargen; horasAtendidas = $_.horasAtendidas; produccionHora = $_.produccionHora; horasLibres = $_.horasLibres; pctOcupacionAgenda = $_.pctOcupacionAgenda } })
    tesoreria = [ordered]@{ ingresado = $r.ingresado; financiado = $r.financiado; pctFinanciado = $r.pctFinanciado; descuadre = $r.descuadre; cierresDescuadre = $r.cierresDescuadre
      porFormaPago = @($fp | ForEach-Object { [ordered]@{ nombre = $_.FormaPago; importe = $_.importe } })
      porFinanciera = @($fin | ForEach-Object { [ordered]@{ nombre = $_.Financiera; importe = $_.importe } }) }
    ingresos = [ordered]@{ produccion = $r.produccion; tratamientos = $r.tratamientos; ticketMedio = $r.ticketMedio; cartera = $r.cartera
      porArea = @($area | ForEach-Object { [ordered]@{ nombre = $(if ($_.Area) { $_.Area } else { "(En blanco)" }); importe = $_.importe } }) }
    margen = [ordered]@{ consumo = $r.consumo; pctConsumo = $r.pctConsumo; liquidacion = $r.liquidacion; margen = $r.margen; pctMargen = $r.pctMargen; produccionHora = $r.produccionHora }
    ocupacion = [ordered]@{ pctOcupacion = $r.pctOcupacion; pctOcupacionAgenda = $r.pctOcupacionAgenda; huecos7 = $r.huecos7; pctFallos = $r.pctFallos; pacientesAtendidos = $r.pacientesAtendidos; pctAgendaLlena7 = $r.pctAgendaLlena7; horasLibres = $r.horasLibres
      mensual = @($mes | ForEach-Object { [ordered]@{ mes = $_.'Año-Mes'; pctOcupacion = $_.pctOcupacion; atendidas = $_.atendidas; canceladas = $_.canceladas; noAcude = $_.noAcude; pacientesNuevos = $_.pacientesNuevos; primerasVisitas = $_.primerasVisitas } }) }
    negociacion = [ordered]@{ presentados = $r.presentados; importePresentado = $r.importePresentado; pctImporte = $r.pctImporte; pctNumero = $r.pctNumero; pendiente = $r.pendiente; perdido = $r.perdido
      porTramo = @($tramo | ForEach-Object { [ordered]@{ tramo = $_.Tramo; pctImporte = $_.pctImporte } })
      porProfesional = @($prp | ForEach-Object { [ordered]@{ profesional = $_.Profesional; presentados = $_.presentados; pctImporte = $_.pctImporte } }) }
  }
}

$fechaDatos = Q1 "EVALUATE ROW(""texto"", [Fecha de los datos])"
$cn.Close()

# ---------------------------------------------------------------------------
# 6. Guardar y subir
# ---------------------------------------------------------------------------
$foto = [ordered]@{
  version = 1
  clinica = [ordered]@{ id = $cfg.clinicaId; nombre = $cfg.clinicaNombre }
  generado = (Get-Date).ToString("yyyy-MM-ddTHH:mm:ss")
  fuente = "Power BI · TIMÓN (exportado con Exportar-TIMON.ps1)"
  fechaDatos = [ordered]@{ texto = $fechaDatos.texto }
  semanas = @($semanas)
  anios = @($anios)
}
$json = $foto | ConvertTo-Json -Depth 12 -Compress
$salida = Join-Path $Carpeta "salida"
New-Item -ItemType Directory -Force -Path $salida | Out-Null
$archivo = Join-Path $salida ("foto-{0}-{1}.json" -f $cfg.clinicaId, (Get-Date -Format "yyyyMMdd-HHmm"))
[System.IO.File]::WriteAllText($archivo, $json, (New-Object System.Text.UTF8Encoding($false)))
Paso ("Guardado: {0} ({1:N0} KB, {2} semanas, {3} años)" -f $archivo, ($json.Length / 1KB), $foto.semanas.Count, $foto.anios.Count)

if ($SoloArchivo) { Write-Host "✓ Listo (no se ha subido: -SoloArchivo)." -ForegroundColor Green; exit 0 }
if (-not $cfg.url -or -not $cfg.token) { Fallo "Faltan url o token en config.json para subir al portal." }

Paso "Subiendo al portal…"
$headers = @{ Authorization = "Bearer $(([string]$cfg.token).Trim())" }
if ($cfg.accessClientId) { $headers["CF-Access-Client-Id"] = ([string]$cfg.accessClientId).Trim(); $headers["CF-Access-Client-Secret"] = ([string]$cfg.accessClientSecret).Trim() }
try {
  $res = Invoke-RestMethod -Method Post -Uri ($cfg.url.TrimEnd('/') + "/api/subir") -Headers $headers `
    -ContentType "application/json; charset=utf-8" -Body ([System.Text.Encoding]::UTF8.GetBytes($json))
  Write-Host ("✓ Subido: {0} · {1} semanas · {2} años" -f $res.clinica, $res.semanas, $res.anios) -ForegroundColor Green
} catch {
  $cuerpo = $_.ErrorDetails.Message
  if (-not $cuerpo -and $_.Exception.Response) {
    try { $cuerpo = (New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())).ReadToEnd() } catch {}
  }
  if ($cuerpo -and $cuerpo.Length -gt 300) { $cuerpo = $cuerpo.Substring(0, 300) }
  $t = ([string]$cfg.token).Trim()
  $nota = "La frase de config.json tiene $($t.Length) caracteres"
  if ($t -match '[^\x21-\x7E]') { $nota += " y lleva tildes, ñ o espacios (mejor quitarlos)" }
  $id = ([string]$cfg.accessClientId).Trim(); $sec = ([string]$cfg.accessClientSecret).Trim()
  $nota += ". Client ID: $($id.Length) caracteres (deben ser 39 y acabar en .access); Client Secret: $($sec.Length) caracteres"
  if ($cuerpo -match 'Cloudflare Access') { $nota = "Lo ha frenado Cloudflare Access: la llave (Client ID / Client Secret) no vale. " + $nota }
  Fallo "No se ha podido subir: $($_.Exception.Message)`nRespuesta: $cuerpo`n$nota."
}
