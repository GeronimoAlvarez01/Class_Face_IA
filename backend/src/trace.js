/**
 * Modo demo ("Laboratorio IA"): guarda en MEMORIA los últimos recorridos de foto -> red neuronal -> decisión,
 * para que un visor (otra pantalla) los dibuje en vivo. Nada de esto toca la base de datos ni el disco, y todo
 * se pierde al reiniciar el servidor. Solo se llena con DEMO_TRACE=1.
 *
 * Cada recorrido incluye la foto y el nombre del estudiante: es dato personal. Por eso va detrás de ADMIN_TOKEN
 * como el resto de /api, y por eso está apagado por defecto.
 */
class TraceStore {
  constructor(max = 20) {
    this.max = Math.max(1, max);
    this.items = [];
    this.seq = 0;
  }

  /** entry: { kind, faces, decision, context, trace } -> item con id consecutivo y marca de tiempo. */
  add(entry) {
    const item = { id: ++this.seq, at: new Date().toISOString(), ...entry };
    this.items.push(item);
    if (this.items.length > this.max) this.items.splice(0, this.items.length - this.max);
    return item;
  }

  /**
   * Recorridos más nuevos que `afterId`, del más viejo al más nuevo (así el visor los anima en orden).
   * Si hay más de `limit`, se quedan los más recientes. `lastId` siempre es el último id existente: el visor lo
   * manda en la siguiente consulta y no vuelve a recibir lo ya visto. `onlyFaces` omite los cuadros sin rostro
   * (el escáner automático manda muchos y taparían a los útiles).
   */
  since(afterId = 0, { limit = 5, onlyFaces = false } = {}) {
    let items = this.items.filter((i) => i.id > afterId && (!onlyFaces || i.faces >= 1));
    if (items.length > limit) items = items.slice(items.length - limit);
    return { lastId: this.seq, items };
  }
}

module.exports = { TraceStore };
