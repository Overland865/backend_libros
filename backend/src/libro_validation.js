const CAMPOS_IMAGEN = new Set([
  'imagen',
  'image',
  'foto',
  'photo',
  'imagen_base64',
  'image_base64',
  'base64_image',
  'image_data',
  'datos_imagen',
  'imagenes',
  'images',
  'base64',
]);

function detectarCamposImagen(valor, ruta = '$') {
  if (Array.isArray(valor)) {
    return valor.flatMap((elemento, indice) =>
      detectarCamposImagen(elemento, `${ruta}[${indice}]`)
    );
  }
  if (valor === null || typeof valor !== 'object') return [];

  return Object.entries(valor).flatMap(([clave, elemento]) => {
    const siguienteRuta = `${ruta}.${clave}`;
    const coincidencias = CAMPOS_IMAGEN.has(clave.toLowerCase())
      ? [siguienteRuta]
      : [];
    return [...coincidencias, ...detectarCamposImagen(elemento, siguienteRuta)];
  });
}

module.exports = { detectarCamposImagen };
