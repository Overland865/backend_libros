function aListaDeTexto(valor) {
  if (typeof valor === 'string') {
    const texto = valor.trim();
    return texto ? [texto] : [];
  }
  if (!Array.isArray(valor)) return [];
  return valor.flatMap(aListaDeTexto);
}

function obtenerAnio(valor) {
  if (Number.isInteger(valor)) return valor;
  if (typeof valor === 'string' && /^\d{1,4}$/.test(valor.trim())) {
    return Number(valor.trim());
  }
  return null;
}

function adaptarLibro(documento) {
  const libro = {
    ...documento,
    _id: documento._id == null ? '' : String(documento._id),
  };
  const categorias = aListaDeTexto(documento.categorias);

  if (!libro.isbn_o_codigo) {
    libro.isbn_o_codigo = documento.isbn || libro._id;
  }
  if (libro.iglesia == null) libro.iglesia = '';
  if (!libro.tipo_libro) {
    libro.tipo_libro = categorias.length ? categorias.join(', ') : 'General';
  }
  if (!Array.isArray(libro.palabras_clave) || libro.palabras_clave.length === 0) {
    libro.palabras_clave = [
      ...new Set([...aListaDeTexto(libro.palabras_clave), ...categorias]),
    ];
  }

  const periodo = libro.periodo && typeof libro.periodo === 'object'
    ? { ...libro.periodo }
    : {};
  const anioPublicacion = obtenerAnio(documento.anio_publicacion);
  if (anioPublicacion != null) {
    if (obtenerAnio(periodo.anio_inicio) == null) {
      periodo.anio_inicio = anioPublicacion;
    }
    if (obtenerAnio(periodo.anio_fin) == null) {
      periodo.anio_fin = anioPublicacion;
    }
  }
  if (Object.keys(periodo).length > 0) libro.periodo = periodo;

  if (!libro.fecha_procesamiento) {
    libro.fecha_procesamiento =
      documento.fecha_actualizacion || documento.fecha_creacion || null;
  }

  return libro;
}

module.exports = { adaptarLibro };
