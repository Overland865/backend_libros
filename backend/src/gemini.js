const PROMPT_PALEOGRAFICO = `Actúa como un paleógrafo y archivista experto en transcripción de documentos y libros eclesiásticos históricos (siglos XVI al XX).
Tu tarea es transcribir con la mayor fidelidad y exactitud posible todo el texto visible en esta imagen.

Reglas obligatorias:
1. Transcribe nombres propios, apellidos, fechas, lugares, parentescos y fórmulas religiosas exactamente como aparecen.
2. Respeta las abreviaturas y ortografía histórica de la época.
3. Conserva fielmente tildes, diéresis, signos de puntuación y caracteres del español, en especial ñ y Ñ; no los sustituyas por n o N.
4. Conserva la división natural de párrafos y líneas.
5. Si hay partes ilegibles o manchadas, indícalas como [ilegible].
6. No modernices la ortografía histórica ni corrijas nombres por contexto.
7. Devuelve ÚNICAMENTE el texto limpio transcrito. NO agregues introducciones, explicaciones, saludos ni bloques de código.`;

const MODELOS_DEFAULT = [
  'gemini-2.5-flash',
  'gemini-flash-latest',
  'gemini-1.5-flash',
  'gemini-flash-lite-latest'
];

/**
 * Transcribe una imagen en base64 usando la API de Gemini desde el backend.
 * Esto protege la clave GEMINI_API_KEY para que nunca viaje dentro del APK móvil.
 */
async function transcribirConGemini({ imagenBase64, mimeType = 'image/jpeg' }) {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) {
    const error = new Error('GEMINI_API_KEY no está configurada en las variables de entorno del servidor.');
    error.status = 503;
    throw error;
  }

  if (!imagenBase64) {
    const error = new Error('Se requiere imagen en formato base64.');
    error.status = 400;
    throw error;
  }

  const modeloPrincipal = (process.env.GEMINI_MODEL || '').trim() || MODELOS_DEFAULT[0];
  const modelos = Array.from(new Set([modeloPrincipal, ...MODELOS_DEFAULT]));

  const payload = {
    contents: [
      {
        parts: [
          { text: PROMPT_PALEOGRAFICO },
          {
            inline_data: {
              mime_type: mimeType,
              data: imagenBase64.replace(/^data:image\/[a-zA-Z]+;base64,/, '')
            }
          }
        ]
      }
    ],
    generationConfig: {
      temperature: 0.1,
      topP: 0.95
    }
  };

  let ultimoError = null;

  for (const modelo of modelos) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${apiKey}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(120000)
      });

      if (res.ok) {
        const data = await res.json();
        const candidate = data.candidates?.[0];
        const textPart = candidate?.content?.parts?.[0]?.text;
        if (textPart && textPart.trim()) {
          return {
            texto: textPart.trim(),
            modelo
          };
        }
        throw new Error('Gemini respondió sin candidatos de texto válidos.');
      }

      const resBody = await res.text();
      let msg = resBody;
      try {
        const parsed = JSON.parse(resBody);
        msg = parsed.error?.message || resBody;
      } catch (_) {}

      if (res.status === 404) {
        console.warn(`⚠️ Modelo de Gemini "${modelo}" no encontrado (404). Probando alternativa...`);
        ultimoError = new Error(`Modelo "${modelo}" no disponible: ${msg}`);
        continue;
      }

      const err = new Error(`Gemini respondió con error ${res.status}: ${msg}`);
      err.status = res.status >= 400 && res.status < 500 ? res.status : 502;
      throw err;
    } catch (e) {
      if (e.name === 'TimeoutError') {
        const err = new Error('Tiempo de espera agotado al transcribir con Gemini.');
        err.status = 504;
        throw err;
      }
      if (e.status && e.status !== 404) {
        throw e;
      }
      ultimoError = e;
    }
  }

  const finalError = new Error(`Ningún modelo de Gemini pudo completar la transcripción. Último detalle: ${ultimoError?.message}`);
  finalError.status = 502;
  throw finalError;
}

module.exports = {
  transcribirConGemini,
  PROMPT_PALEOGRAFICO
};
