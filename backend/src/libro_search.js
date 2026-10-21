function escaparRegex(texto) {
  return String(texto).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function construirFiltroBusqueda(busqueda, campo = 'todos') {
  const texto = String(busqueda ?? '').trim();
  if (!texto) return {};

  const rx = new RegExp(escaparRegex(texto), 'i');
  const campos = {
    titulo: [{ titulo: rx }],
    iglesia: [{ iglesia: rx }],
    autor: [{ autor: rx }],
    tipo_libro: [{ tipo_libro: rx }],
    isbn_o_codigo: [{ isbn_o_codigo: rx }, { isbn: rx }],
    anio: /^\d{1,4}$/.test(texto)
      ? [
          { 'periodo.anio_inicio': Number(texto) },
          { 'periodo.anio_fin': Number(texto) },
          { anio_publicacion: Number(texto) },
        ]
      : [],
  };

  return {
    $or: campos[campo] ?? [
      { titulo: rx },
      { autor: rx },
      { iglesia: rx },
      { isbn_o_codigo: rx },
      { isbn: rx },
      { subtitulo: rx },
      { editorial: rx },
      { categorias: rx },
      { sinopsis: rx },
      { tipo_libro: rx },
      { palabras_clave: rx },
    ],
  };
}

module.exports = { construirFiltroBusqueda, escaparRegex };
