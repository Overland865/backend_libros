# 🚀 Guía de Despliegue en Render (Backend Biblioteca Eclesiástica)

Este backend está 100% preparado y optimizado para desplegarse como un **Web Service gratuito** en [Render](https://render.com).

---

## ⚠️ Paso 1: Configurar MongoDB Atlas (¡Imprescindible!)

Como Render asigna direcciones IP dinámicas a los servicios gratuitos, debes permitir conexiones entrantes en MongoDB Atlas:

1. Ve a [MongoDB Atlas](https://cloud.mongodb.com/).
2. En el menú lateral izquierdo, haz clic en **Network Access** (dentro de *Security*).
3. Haz clic en **+ Add IP Address**.
4. Selecciona **Allow Access from Anywhere** (`0.0.0.0/0`) o escribe `0.0.0.0/0`.
5. Confirma con **Confirm**.

> 💡 **Nota:** La base de datos sigue protegida mediante tu usuario y contraseña de conexión segura (`MONGO_URI`).

---

## 📦 Paso 2: Subir el proyecto a GitHub

Si aún no has inicializado el repositorio Git:

```bash
# Dentro de la carpeta del backend
git init
git add .
git commit -m "feat: preparar backend para Render"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/TU_REPOSITORIO.git
git push -u origin main
```

*(Los archivos `.env` y `node_modules` están protegidos en `.gitignore` y no se subirán).*

---

## 🌐 Paso 3: Desplegar en Render

### Opción A: Despliegue con Blueprint (`render.yaml`) — Automático
1. En [Render Dashboard](https://dashboard.render.com/), haz clic en **New +** → **Blueprint**.
2. Conecta tu repositorio de GitHub.
3. Render detectará el archivo [render.yaml](file:///c:/Proyectos/backend/render.yaml).
4. Llena los valores de entorno que te solicite (`MONGO_URI`, `GEMINI_API_KEY`, etc.).
5. Haz clic en **Apply**.

---

### Opción B: Despliegue Manual (Web Service)
1. En [Render Dashboard](https://dashboard.render.com/), haz clic en **New +** → **Web Service**.
2. Conecta tu repositorio de GitHub.
3. Configura los campos:
   - **Name:** `biblioteca-eclesiastica-api` (o el nombre que elijas)
   - **Language / Runtime:** `Node`
   - **Root Directory:**
     - Si subiste la carpeta raíz con `backend/` dentro: coloca `backend`
     - Si subiste directamente el contenido de backend: déjalo en blanco
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** `Free`

4. Despliega la sección **Advanced** y configura:
   - **Health Check Path:** `/healthz`
     *(Permite a Render verificar que el servicio está vivo sin reiniciar por demoras de Atlas).*

5. En la sección **Environment Variables**, agrega:

| Variable | Valor | Descripción |
| :--- | :--- | :--- |
| `NODE_ENV` | `production` | Modo producción |
| `PORT` | `10000` *(Render lo asigna solo)* | Puerto del servicio |
| `DB_NAME` | `biblioteca_digital` | Nombre de la base de datos |
| `COLLECTION_NAME` | `libros` | Colección existente que contiene los libros |
| `MONGO_URI` | `mongodb+srv://...` | Cadena de conexión de MongoDB Atlas |
| `API_KEY` | Clave aleatoria segura | Token de acceso a la API; el Blueprint la genera automáticamente |
| `GEMINI_API_KEY` | `AIzaSy...` | Clave de Google AI Studio |
| `GEMINI_MODEL` | `gemini-2.5-flash` | Modelo de IA para transcripción |

6. Haz clic en **Create Web Service**.

---

## 🔍 Paso 4: Verificar el Despliegue

Una vez que Render termine el build, te dará una URL pública tipo `https://biblioteca-eclesiastica-api.onrender.com`.

Si el servicio ya existía, verifica en **Environment → Environment Variables** que `DB_NAME` sea `biblioteca_digital`, `COLLECTION_NAME` sea `libros` y que `API_KEY` esté configurada. Cambiar el `.env` local no actualiza las variables guardadas en Render. La misma clave API debe estar guardada en **Configuración del Servidor** de la app.

La `API_KEY` protege las solicitudes entre la app y este backend; **no** es la contraseña de MongoDB. El backend se conecta a Atlas con `MONGO_URI`, que debe permanecer solo en las variables de entorno del servidor. En el Blueprint, Render genera `API_KEY` automáticamente (`generateValue: true`). Si configuras el servicio manualmente, genera una clave aleatoria de al menos 32 bytes (por ejemplo, con `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`) y guárdala como variable secreta. No la publiques en el repositorio.

La colección `libros` usa campos de catálogo como `isbn`, `anio_publicacion` y `categorias`. La API los adapta al formato que consume la app (`isbn_o_codigo`, `periodo` y `tipo_libro`) sin modificar los documentos originales. Como esos registros no incluyen una iglesia, la app la mostrará como no especificada.

Prueba en tu navegador:
1. `https://tu-api.onrender.com/healthz`  
   → Debe responder: `{"status":"ok","uptime":...}`
2. `https://tu-api.onrender.com/api/salud`  
   → Debe responder con `mongo: "conectado"`, `base_datos: "biblioteca_digital"` y `coleccion: "libros"`.
3. `GET https://tu-api.onrender.com/api/libros?limit=1` enviando `X-API-Key: <API_KEY>` o `Authorization: Bearer <API_KEY>` con la clave configurada en Render
   → Debe responder `200` y devolver el primer libro.

---

## 📱 Paso 5: Conectar la App Móvil Flutter

1. Abre el archivo de la app: [escaner_libros/.env](file:///c:/Proyectos/Libros-movil/escaner_libros/.env).
2. Actualiza los valores con tu nueva URL de Render y tu clave API:
   ```env
   API_BASE_URL=https://biblioteca-eclesiastica-api.onrender.com
   API_KEY=tu-clave-secreta-configurada-en-render
   ```
3. O desde la app móvil, ve a **Configuración del Servidor** e ingresa la URL y la clave API.

> ℹ️ **Comportamiento del Plan Gratuito de Render:**  
> Tras 15 minutos sin peticiones, el contenedor entra en modo de reposo ("spin down"). Al enviar la primera petición, tarda aproximadamente 30-50 segundos en despertar. La app móvil ya tiene configurado un timeout extendido para esperar este encendido sin mostrar error.
