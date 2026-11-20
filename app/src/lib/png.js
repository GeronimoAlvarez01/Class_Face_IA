// Codificador PNG mínimo (sin dependencias, sin comprimir): sirve para dibujar los mapas de calor del visor
// ("Laboratorio IA") como UNA imagen en vez de miles de Views. Funciona igual en web y en el teléfono.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(bytes) {
  let a = 1;
  let b = 0;
  for (let i = 0; i < bytes.length; i += 1) {
    a = (a + bytes[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

const u32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];

function chunk(type, data) {
  const typeBytes = [...type].map((ch) => ch.charCodeAt(0));
  const body = new Uint8Array(typeBytes.length + data.length);
  body.set(typeBytes, 0);
  body.set(data, typeBytes.length);
  return [...u32(data.length), ...body, ...u32(crc32(body))];
}

/** Deflate "almacenado" (sin compresión): cabecera zlib + bloques de hasta 65535 bytes + Adler-32. */
function zlibStored(raw) {
  const out = [0x78, 0x01];
  for (let pos = 0; pos < raw.length || pos === 0; pos += 65535) {
    const len = Math.min(65535, raw.length - pos);
    const last = pos + len >= raw.length ? 1 : 0;
    out.push(last, len & 255, len >>> 8, ~len & 255, (~len >>> 8) & 255);
    for (let i = 0; i < len; i += 1) out.push(raw[pos + i]);
    if (last) break;
  }
  out.push(...u32(adler32(raw)));
  return Uint8Array.from(out);
}

/** rgb: Uint8Array de width*height*3 (R,G,B por píxel). Devuelve los bytes del PNG. */
function encodePng(width, height, rgb) {
  const rowBytes = width * 3;
  const raw = new Uint8Array((rowBytes + 1) * height);   // cada fila empieza con su byte de filtro (0 = sin filtro)
  for (let y = 0; y < height; y += 1) {
    raw[y * (rowBytes + 1)] = 0;
    raw.set(rgb.subarray(y * rowBytes, (y + 1) * rowBytes), y * (rowBytes + 1) + 1);
  }
  const ihdr = Uint8Array.from([...u32(width), ...u32(height), 8, 2, 0, 0, 0]);   // 8 bits, RGB
  return Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ...chunk('IHDR', ihdr), ...chunk('IDAT', zlibStored(raw)), ...chunk('IEND', new Uint8Array(0)),
  ]);
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    s += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < bytes.length ? B64[(n >> 6) & 63] : '=') + (i + 2 < bytes.length ? B64[n & 63] : '=');
  }
  return s;
}

/**
 * Mapa de calor divergente de una lista de números: azul = negativo, naranja = positivo, gris claro = cerca de 0.
 * Cada valor es un cuadrado de `cell` px; el color satura en el percentil 98 de |valor| (un solo valor extremo
 * no apaga el resto). Devuelve { uri, width, height } listo para <Image source={{ uri }} />.
 */
function heatmapImage(values, cols, cell = 4) {
  const rows = Math.ceil(values.length / cols);
  const sorted = Array.from(values, Math.abs).sort((a, b) => a - b);
  const scale = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.98))] || 1;
  const width = cols * cell;
  const height = rows * cell;
  const rgb = new Uint8Array(width * height * 3).fill(244);   // celdas sin dato = gris muy claro
  for (let i = 0; i < values.length; i += 1) {
    const [r, g, b] = heatRgb(values[i], scale);
    const x0 = (i % cols) * cell;
    const y0 = Math.floor(i / cols) * cell;
    for (let dy = 0; dy < cell; dy += 1) {
      for (let dx = 0; dx < cell; dx += 1) {
        const p = ((y0 + dy) * width + x0 + dx) * 3;
        rgb[p] = r; rgb[p + 1] = g; rgb[p + 2] = b;
      }
    }
  }
  return { uri: `data:image/png;base64,${toBase64(encodePng(width, height, rgb))}`, width, height };
}

/** Color de un valor: t = valor/escala recortado a [-1, 1]; mezcla gris claro -> naranja (+) o azul (-). */
function heatRgb(v, scale) {
  const t = Math.max(-1, Math.min(1, v / scale));
  const base = [244, 244, 244];
  const end = t >= 0 ? [224, 110, 20] : [36, 86, 229];
  const k = Math.abs(t);
  return base.map((c, i) => Math.round(c + (end[i] - c) * k));
}

module.exports = { encodePng, heatmapImage, heatRgb, toBase64, crc32, adler32 };
