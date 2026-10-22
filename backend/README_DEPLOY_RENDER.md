# 🚀 Guía de despliegue en Render (Backend Biblioteca Eclesiástica)

Este backend está preparado para desplegarse como un **Web Service** en [Render](https://render.com).

---

## Paso 1: Configurar MongoDB Atlas

Como Render asigna direcciones IP dinámicas a los servicios gratuitos, debes permitir conexiones entrantes en MongoDB Atlas:

1. Ve a [MongoDB Atlas](https://cloud.mongodb.com/).
2. En el menú lateral, abre **Network Access** dentro de *Security*.
3. Haz clic en **Add IP Address**.
4. Permite `0.0.0.0/0` o configura las direcciones permitidas para tu servicio.
5. Confirma los cambios.

> La base de datos sigue protegida mediante el usuario y la contraseña incluidos en `MONGO_URI`.

---

## Paso 2: Subir el proyecto a GitHub

Si aún no has inicializado el repositorio Git:

```bash
git init
git add .
git commit -m "feat: preparar backend para Render"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/TU_REPOSITORIO.git
git push -u origin main
```

Los archivos `.env` y `node_modules` deben permanecer excluidos mediante `.gitignore`.

---

## Paso 3: Desplegar en Render

### Opción A: Despliegue con Blueprint

1. En [Render Dashboard](https://dashboard.render.com/), haz clic en **New +** → **Blueprint**.
2. Conecta tu repositorio de GitHub.
3. Render detectará [`render.yaml`](./render.yaml).
4. Proporciona los valores privados que solicite, incluidos `MONGO_URI`, `GEMINI_API_KEY`, `APP_USERNAME` y `APP_PASSWORD`.
5. Haz clic en **Apply**.

### Opción B: Despliegue manual

1. En Render Dashboard, haz clic en **New +** → **Web Service** y conecta tu repositorio.
2. Configura los campos:
   - **Name:** `biblioteca-eclesiastica-api` (o el nombre que elijas)
   - **Language / Runtime:** `Node`
   - **Root Directory:** `backend` si subiste la carpeta raíz con `backend/` dentro; en caso contrario, déjalo en blanco.
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** el plan que prefieras
3. En **Advanced**, configura **Health Check Path** como `/healthz`.
4. En **Environment Variables**, agrega:

| Variable | Valor | Descripción |
| :--- | :--- | :--- |
| `NODE_ENV` | `production` | Modo de producción |
| `PORT` | Render lo asigna automáticamente | Puerto del servicio |
| `DB_NAME` | `biblioteca_digital` | Nombre de la base de datos |
| `COLLECTION_NAME` | `libros` | Colección existente que contiene los libros |
| `MONGO_URI` | Cadena privada de MongoDB Atlas | Conexión a la base de datos |
| `APP_USERNAME` | Usuario compartido elegido por ti | Protege las rutas de la API |
| `APP_PASSWORD` | Contraseña compartida elegida por ti | Protege las rutas de la API; márcala como secreta |
| `GEMINI_API_KEY` | Clave privada de Google AI Studio | Acceso a Gemini para transcripción |
| `GEMINI_MODEL` | `gemini-2.5-flash` | Modelo de IA para transcripción |

5. Haz clic en **Create Web Service**.

---

## Paso 4: Verificar el despliegue

Cuando Render termine el build, tendrá una URL pública como `https://biblioteca-eclesiastica-api.onrender.com`.

Si el servicio ya existía, configura `APP_USERNAME` y `APP_PASSWORD` y verifica `DB_NAME`, `COLLECTION_NAME` y `GEMINI_API_KEY`. Retira las antiguas variables `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `SESSION_SECRET`, `AUTH_TOKEN_TTL_SECONDS` y `API_KEY`.

La app solicita el usuario y la contraseña compartidos cada vez que se abre. Los mantiene solo en memoria mientras está abierta y los envía con Basic Auth en cada petición protegida. No hay registro de cuentas, tokens ni sesiones. Si rotas las credenciales en Render, cada persona deberá ingresar las nuevas al volver a abrir la app. `GEMINI_API_KEY` y `MONGO_URI` permanecen únicamente en el servidor.

La colección `libros` puede usar campos como `isbn`, `anio_publicacion` y `categorias`. La API los adapta al formato que consume la app (`isbn_o_codigo`, `periodo` y `tipo_libro`) sin modificar los documentos originales.

Prueba las rutas siguientes:

1. `https://tu-api.onrender.com/healthz` debe responder con `{"status":"ok", ...}`.
2. `https://tu-api.onrender.com/api/salud` debe indicar que Atlas está conectado.
3. `GET /api/auth/check` con Basic Auth usando `APP_USERNAME` y `APP_PASSWORD` debe responder `200` y confirmar las credenciales sin emitir un token.
4. `GET /api/libros?limit=1` con las mismas credenciales debe responder `200` y devolver el primer libro.

Usa HTTPS para las peticiones fuera del entorno local.

---

## Paso 5: Conectar la app móvil

En el archivo `.env` de `escaner_libros`, configura únicamente la URL de Render:

```env
API_BASE_URL=https://biblioteca-eclesiastica-api.onrender.com
```

Abre la app e ingresa `APP_USERNAME` y `APP_PASSWORD`. Se volverán a solicitar la próxima vez que se abra.

> **Plan gratuito de Render:** tras 15 minutos sin peticiones, el servicio puede entrar en reposo. La primera petición posterior puede tardar aproximadamente 30–50 segundos en despertar.
