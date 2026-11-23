# Puesta en marcha

## 1. Desplegar el Worker (una vez)

1. Cloudflare → **Workers y Pages → Crear → Importar un repositorio** → `portal-clinicas`.
   - Comando de build: *(vacío)* · Comando de despliegue: `npx wrangler deploy`.
2. Crear el almacén de datos: Cloudflare → **Almacenamiento y bases de datos → KV → Crear** con el nombre `portal-clinicas-datos`.
   Copiar su **ID** y pegarlo en `wrangler.jsonc` en lugar de `PENDIENTE_CREAR`.
3. Crear el secreto de subida: Worker `portal-clinicas` → **Configuración → Variables y secretos → Añadir → Secreto**
   - Nombre `SUBIR_TOKEN`, valor: una frase larga aleatoria. Guárdala también en `exportar/config.json` del portátil.

Con esto el portal ya funciona en `https://portal-clinicas.<subdominio>.workers.dev` **con datos de ejemplo**.

## 2. Login de las clínicas con Cloudflare Access (gratis hasta 50 usuarios)

1. Cloudflare → **Zero Trust** (la primera vez pide elegir un nombre de equipo, p. ej. `dirigetuclinica`, y el plan Free).
2. Worker `portal-clinicas` → **Configuración → Dominios y rutas → workers.dev → Activar Cloudflare Access**.
   Esto crea una aplicación de Access para el Worker.
3. En **Zero Trust → Access → Aplicaciones →** la del portal **→ Políticas**:
   - Política «Clínicas»: acción *Permitir*, regla *Correos* con el correo de cada doctora y el de Daniel. Método de acceso: **código de un solo uso por correo** (no hace falta contraseña).
   - Política «Exportador»: acción *Service Auth*, regla *Service Token* → crear un token de servicio `exportador-timon` y copiar su **Client ID** y **Client Secret** en `exportar/config.json` (`accessClientId`, `accessClientSecret`).
4. Copiar de la aplicación el **Application Audience (AUD) Tag** y el dominio del equipo (`<equipo>.cloudflareaccess.com`) en `wrangler.jsonc` (`ACCESS_AUD`, `ACCESS_TEAM_DOMAIN`).

A partir de aquí, quien entra con un correo autorizado ve los datos reales de su clínica.

## 3. Dar de alta una persona

En el KV `portal-clinicas-datos` → **Añadir entrada**:

| Clave | Valor |
|---|---|
| `usuario:doctora@ejemplo.es` | `{"clinicas":["ines-iranzo"],"nombre":"Dra. Inés Iranzo"}` |
| `usuario:daniel@dirigetuclinica.es` | `{"clinicas":["*"],"nombre":"Daniel"}` (ve todas y elige en un desplegable) |

El correo, siempre en minúsculas. Además, ese correo tiene que estar en la política «Clínicas» de Access.

## 4. Exportar los datos de una clínica (cada lunes)

1. Abrir el `.pbip` de la clínica en Power BI Desktop y pulsar **Actualizar**.
2. Ejecutar `exportar\Exportar-TIMON.ps1` (clic derecho → *Ejecutar con PowerShell*).
   - La primera vez: copiar `config.ejemplo.json` como `config.json` y rellenarlo.
   - `-SoloArchivo` genera el JSON en `exportar\salida\` sin subirlo, para revisarlo.

## 5. Clínica nueva

1. Su propio `.pbip` TIMÓN (misma plantilla, mismas medidas).
2. Un `config.json` con su `clinicaId` (p. ej. `clinica-garcia`).
3. Alta de su correo (pasos 2.3 y 3).
