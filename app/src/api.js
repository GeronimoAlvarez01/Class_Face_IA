import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

// ---------- configuración persistente (URL del servidor y clave) ----------

const STORAGE_KEY = 'asistencia.settings.v1';
const config = { baseUrl: process.env.EXPO_PUBLIC_API_URL || (Platform.OS === 'web' ? 'http://localhost:3000' : ''), token: '' };

export const getApiConfig = () => ({ ...config });

export async function loadSettings() {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) Object.assign(config, JSON.parse(raw));
  } catch {
    /* sin ajustes guardados: se usan los valores por defecto */
  }
  return getApiConfig();
}

export async function saveSettings({ baseUrl, token }) {
  config.baseUrl = (baseUrl || '').trim().replace(/\/+$/, '');
  config.token = (token || '').trim();
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  return getApiConfig();
}

// ---------- cliente HTTP ----------

export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status; // 0 = no hubo conexión
    this.details = details;
  }
}

async function request(method, path, body, { timeoutMs = 30000, baseUrl, token } = {}) {
  const base = baseUrl ?? config.baseUrl;
  if (!base) throw new ApiError(0, 'Configure primero la dirección del servidor en Ajustes.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...((token ?? config.token) ? { 'x-api-key': token ?? config.token } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch {
    throw new ApiError(0, 'No se pudo conectar con el servidor.');
  } finally {
    clearTimeout(timer);
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* sin cuerpo JSON */
  }
  if (!res.ok) throw new ApiError(res.status, data?.error || `Error ${res.status}`, data?.details);
  return data;
}

export const api = {
  health: (override) => request('GET', '/api/health', undefined, { timeoutMs: 6000, ...override }),

  groups: {
    list: () => request('GET', '/api/groups').then((r) => r.groups),
    create: (g) => request('POST', '/api/groups', g),
    update: (id, g) => request('PUT', `/api/groups/${id}`, g),
    remove: (id) => request('DELETE', `/api/groups/${id}`),
    addStudent: (gid, sid) => request('POST', `/api/groups/${gid}/students/${sid}`, {}),
    removeStudent: (gid, sid) => request('DELETE', `/api/groups/${gid}/students/${sid}`),
  },

  students: {
    list: (groupId) => request('GET', `/api/students${groupId ? `?group_id=${groupId}` : ''}`).then((r) => r.students),
    get: (id) => request('GET', `/api/students/${id}`),
    create: (s) => request('POST', '/api/students', s, { timeoutMs: 60000 }), // la inscripción procesa la foto
    update: (id, s) => request('PUT', `/api/students/${id}`, s, { timeoutMs: 60000 }),
    remove: (id) => request('DELETE', `/api/students/${id}`),
  },

  schedule: {
    get: (gid) => request('GET', `/api/groups/${gid}/schedule`),
    save: (gid, params) => request('PUT', `/api/groups/${gid}/schedule`, params),
  },

  grid: {
    get: (gid) => request('GET', `/api/groups/${gid}/grid`),
    save: (gid, changes) => request('PUT', `/api/groups/${gid}/grid`, { changes }),
  },

  // `guide` = dónde está el óvalo punteado dentro de la foto; el servidor solo da por buena la cara que esté dentro
  recognize: (sessionId, imageBase64, guide) =>
    request('POST', `/api/sessions/${sessionId}/recognize`, { image_base64: imageBase64, guide }, { timeoutMs: 25000 }),

  // ¿Hay un rostro bien encuadrado? No guarda nada; lo usa el registro de estudiantes para tomar la foto sola.
  faceCheck: (imageBase64, guide) =>
    request('POST', '/api/face-check', { image_base64: imageBase64, guide }, { timeoutMs: 25000 }),
};

// La foto de un estudiante conserva la misma URL al reemplazarla; el sufijo ?v= evita ver la foto vieja en caché.
let photoVersion = 0;
export const bumpPhotos = () => { photoVersion += 1; };
export const photoUrl = (student) => `${config.baseUrl}${student.photo_url}?v=${photoVersion}`;
export const authHeaders = () => (config.token ? { 'x-api-key': config.token } : {});
