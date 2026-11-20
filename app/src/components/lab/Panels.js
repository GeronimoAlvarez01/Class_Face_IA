import React, { useMemo } from 'react';
import { Image, View } from 'react-native';
import { Icon, Text } from '../../ui';
import { radius, space, useTheme } from '../../theme';
import { heatmapImage } from '../../lib/png';
import { describeDecision, fmtMs, notEnrolled, residualGroups, similarityRows, sim } from '../../lib/trace';

// Cada panel recibe `state`: 'idle' (aún no llega la animación), 'active' (el paso actual) o 'done'.
// El contenido real solo se muestra desde 'active'; antes se ve un marcador atenuado.

export function Panel({ title, icon, state, style, children, hint }) {
  const { colors } = useTheme();
  const active = state === 'active';
  const idle = state === 'idle';
  return (
    <View
      style={[{
        backgroundColor: active ? colors.primarySoft : colors.surface, borderRadius: radius.lg,
        borderWidth: active ? 2 : 1, borderColor: active ? colors.primary : colors.border, padding: space.md,
        gap: space.sm, opacity: idle ? 0.45 : 1,
      }, style]}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <Icon name={icon} size={18} color={active ? 'primary' : 'textMuted'} />
        <Text variant="label" color={active ? 'primary' : 'text'} style={{ flex: 1 }}>{title}</Text>
      </View>
      {idle ? <Text variant="small" color="textMuted">{hint ?? 'Esperando…'}</Text> : children}
    </View>
  );
}

// ---------- 1 · foto de entrada + cajas de detección + recuadro guía ----------

export function PhotoPanel({ item, state, showDetection }) {
  const { colors } = useTheme();
  const tr = item.trace;
  const W = 240;
  const H = Math.round((W * tr.image.height) / tr.image.width);
  const guide = item.decision?.guide;
  const pctBox = (b) => ({ left: `${b[0] * 100}%`, top: `${b[1] * 100}%`, width: `${(b[2] - b[0]) * 100}%`, height: `${(b[3] - b[1]) * 100}%` });
  return (
    <Panel title="1 · Foto recibida" icon="image" state={state}>
      <View style={{ width: W, height: H, borderRadius: radius.md, overflow: 'hidden', backgroundColor: '#000' }}>
        <Image source={{ uri: tr.input.image }} style={{ width: W, height: H }} resizeMode="cover" accessibilityLabel="Foto enviada por la tablet" />
        {showDetection && guide ? (
          <View
            style={{
              position: 'absolute', left: `${(guide.cx - guide.rx) * 100}%`, top: `${(guide.cy - guide.ry) * 100}%`,
              width: `${guide.rx * 200}%`, height: `${guide.ry * 200}%`, borderRadius: 9999, borderWidth: 2, borderStyle: 'dashed',
              borderColor: guide.ok === false ? '#FF6B6B' : '#FFFFFF',
            }}
          />
        ) : null}
        {showDetection ? tr.detection.faces.map((f, i) => {
          const color = f.selected ? colors.successStrong : f.confident ? colors.warning : colors.textMuted;
          return (
            <View key={i} style={[{ position: 'absolute', borderWidth: 3, borderColor: color, borderRadius: 4 }, pctBox(f.box)]}>
              <View style={{ position: 'absolute', top: -1, left: -1, backgroundColor: color, paddingHorizontal: 5, borderRadius: 3 }}>
                <Text variant="caption" color="#FFFFFF" weight="700">{f.prob != null ? sim(f.prob) : '—'}</Text>
              </View>
            </View>
          );
        }) : null}
      </View>
      <Text variant="small" color="textMuted">{tr.image.width}×{tr.image.height} px{guide ? ' · óvalo punteado = recuadro guía' : ''}</Text>
    </Panel>
  );
}

// ---------- 2 · detección ----------

export function DetectionPanel({ item, state }) {
  const { colors } = useTheme();
  const d = item.trace.detection;
  return (
    <Panel title="2 · Detección (MTCNN)" icon="scan" state={state} hint="Busca rostros en la foto">
      {d.faces.length === 0 ? <Text>No se encontró ningún rostro.</Text> : d.faces.map((f, i) => (
        <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <Icon name={f.selected ? 'checkmark-circle' : f.confident ? 'alert-circle' : 'close-circle'} size={18}
            color={f.selected ? 'success' : f.confident ? 'warning' : 'textMuted'} />
          <Text variant="small" style={{ flex: 1 }}>
            Rostro {i + 1} · confianza {f.prob != null ? sim(f.prob) : '—'}
            {f.selected ? ' · elegido' : !f.confident ? ` · bajo ${sim(d.min_conf)}` : !f.significant ? ' · muy pequeño (fondo)' : ' · compite con otro'}
          </Text>
        </View>
      ))}
      <Text variant="caption" color="textMuted">Cuentan los rostros con confianza ≥ {sim(d.min_conf)} y de tamaño parecido al principal. Con 0 o varios, el proceso se detiene.</Text>
      <View style={{ height: 1, backgroundColor: colors.border }} />
      <Text variant="small">Rostros válidos: <Text variant="small" weight="700">{d.faces_counted}</Text> · detección {fmtMs(item.trace.timings_ms?.detect)}</Text>
    </Panel>
  );
}

// ---------- 3 · recorte ----------

export function CropPanel({ item, state }) {
  const tr = item.trace;
  return (
    <Panel title="3 · Recorte del rostro" icon="crop" state={state} hint="Recorta y estandariza el rostro">
      {tr.crop ? (
        <View style={{ flexDirection: 'row', gap: space.md, alignItems: 'center' }}>
          <Image source={{ uri: tr.crop.image }} style={{ width: 96, height: 96, borderRadius: radius.md }} accessibilityLabel="Rostro recortado de 160 por 160" />
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="small">160 × 160 px, 3 canales</Text>
            <Text variant="caption" color="textMuted">Cada píxel pasa a (x − 127,5) / 128: valores entre −1 y 1 que es lo que la red espera.</Text>
            <Text variant="caption" color="textMuted">Recorte {fmtMs(tr.timings_ms?.crop)}</Text>
          </View>
        </View>
      ) : <Text variant="small" color="textMuted">Sin rostro único no hay recorte: el proceso se detiene aquí.</Text>}
    </Panel>
  );
}

// ---------- 4 · red neuronal, etapa por etapa ----------

const GROUP_LABEL = { block35: 'Block35', block17: 'Block17', block8: 'Block8' };
const SHORT = {
  conv1: 'Conv. inicial', stem: 'Stem', block35: 'Block35 ×5', reduction_a: 'Reducción A', block17: 'Block17 ×10',
  reduction_b: 'Reducción B', block8: 'Block8 ×6', avgpool: 'Prom. global', dense: 'Densa 1792→512',
};
const MAP_PX = 104;

export function NetworkPanel({ item, steps, step }) {
  const { colors } = useTheme();
  const net = item.trace.network;
  const idxOf = (stageKey) => steps.findIndex((s) => s.id === `net:${stageKey}`);
  const firstIdx = steps.findIndex((s) => s.id.startsWith('net:'));
  const state = !net || firstIdx < 0 || step < firstIdx ? 'idle' : steps[step]?.id.startsWith('net:') ? 'active' : 'done';
  const groups = residualGroups(item);
  const stages = net?.stages ?? [];
  // Lupa: la última etapa ya recorrida que tenga mapas de activación (cada cuadro es un canal de esa capa)
  const zoom = [...stages].reverse().find((s) => s.maps && idxOf(s.key) >= 0 && idxOf(s.key) <= step);
  return (
    <Panel title="4 · Red neuronal FaceNet (27,9 M de parámetros, congelada)" icon="git-network" state={state}
      hint="La red convierte el rostro en 512 números">
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        {stages.map((s) => {
          const i = idxOf(s.key);
          const st = step < i ? 'idle' : step === i ? 'active' : 'done';
          const on = st === 'active';
          return (
            <View key={s.key}
              style={{ width: 120, borderRadius: radius.md, borderWidth: on ? 2 : 1, borderColor: on ? colors.primary : colors.border,
                backgroundColor: on ? colors.surface : colors.surfaceAlt, padding: space.sm, gap: 3, opacity: st === 'idle' ? 0.35 : 1 }}>
              <Text variant="caption" weight="700" numberOfLines={1}>{SHORT[s.key] ?? s.name}</Text>
              <Text variant="caption" color="textMuted" numberOfLines={1}>{s.shape.join('×')}</Text>
              <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.border, overflow: 'hidden' }}>
                <View style={{ height: 6, width: `${(st === 'idle' ? 0 : s.active_fraction) * 100}%`, backgroundColor: colors.primary }} />
              </View>
              <Text variant="caption" color="textMuted">{st === 'idle' ? ' ' : `${Math.round(s.active_fraction * 100)} % activas`}</Text>
            </View>
          );
        })}
      </View>

      <View style={{ borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, padding: space.sm, gap: 4 }}>
        <Text variant="caption" weight="700">
          {zoom ? `Lupa · ${zoom.name} · los 6 canales más activos de ${zoom.channels}` : 'Lupa · aquí se verán los mapas de activación de cada capa'}
        </Text>
        {zoom ? (
          <Image source={{ uri: zoom.maps }} style={{ width: MAP_PX * 6, height: MAP_PX }} resizeMode="stretch" accessibilityLabel={`Mapas de activación de ${zoom.name}`} />
        ) : <View style={{ width: MAP_PX * 6, height: MAP_PX, backgroundColor: colors.surfaceAlt, borderRadius: radius.sm }} />}
        <Text variant="caption" color="textMuted">Cada cuadro es un canal (un «detector»): más claro = se activa más en esa zona. Al principio ven bordes; más adentro, rasgos abstractos.</Text>
      </View>

      {groups.length ? (
        <View style={{ gap: 4 }}>
          <Text variant="caption" color="textMuted">Cuánto corrige cada uno de los 21 bloques residuales la representación (más alto = cambia más):</Text>
          <View style={{ flexDirection: 'row', gap: space.lg, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            {groups.map((g) => {
              const shown = step >= idxOf(g.group);
              return (
                <View key={g.group} style={{ gap: 2, opacity: shown ? 1 : 0.25 }}>
                  <View style={{ flexDirection: 'row', gap: 3, alignItems: 'flex-end', height: 36 }}>
                    {g.bars.map((b) => (
                      <View key={b.index} style={{ width: 10, height: Math.max(2, 36 * b.height), backgroundColor: colors.primary, borderRadius: 2 }} />
                    ))}
                  </View>
                  <Text variant="caption" color="textMuted">{GROUP_LABEL[g.group]} ×{g.bars.length}</Text>
                </View>
              );
            })}
          </View>
        </View>
      ) : null}
      <Text variant="caption" color="textMuted">Pesos congelados: no se entrena nada, solo un cálculo hacia adelante · {fmtMs(item.trace.timings_ms?.network)} en total.</Text>
    </Panel>
  );
}

// ---------- 5 · capa densa: 1792 -> 512 (mapas de calor) ----------

export function DensePanel({ item, steps, step }) {
  const net = item.trace.network;
  const emb = item.trace.embedding;
  const iAvg = steps.findIndex((s) => s.id === 'net:avgpool');
  const iDense = steps.findIndex((s) => s.id === 'net:dense');
  const cur = steps[step]?.stage;
  const state = !net || step < iAvg ? 'idle' : cur === 'avgpool' || cur === 'dense' ? 'active' : 'done';
  const input = useMemo(() => (net?.dense_in?.length ? heatmapImage(net.dense_in, 56, 3) : null), [item.id]);
  const output = useMemo(() => (emb?.values?.length ? heatmapImage(emb.values, 32, 5) : null), [item.id]);
  return (
    <Panel title="5 · De 1792 valores a un embedding de 512" icon="grid" state={state}
      hint="Cada rostro queda resumido en un vector de 512 números">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, flexWrap: 'wrap' }}>
        <View style={{ gap: 4 }}>
          <Text variant="caption" color="textMuted">Entrada: 1792 valores (promedio global)</Text>
          {input && step >= iAvg ? <Image source={{ uri: input.uri }} style={{ width: input.width, height: input.height }} accessibilityLabel="Mapa de calor de 1792 valores" /> : <View style={{ width: 168, height: 96 }} />}
        </View>
        <Icon name="arrow-forward" size={26} color="primary" />
        <View style={{ gap: 4 }}>
          <Text variant="caption" color="textMuted">Salida: embedding de 512 valores (longitud 1)</Text>
          {output && step >= iDense ? <Image source={{ uri: output.uri }} style={{ width: output.width, height: output.height }} accessibilityLabel="Mapa de calor del embedding de 512 valores" /> : <View style={{ width: 160, height: 80 }} />}
        </View>
      </View>
      <Text variant="caption" color="textMuted">Azul = valor negativo, naranja = positivo. Dos fotos de la misma persona producen patrones parecidos; el sistema los compara en el siguiente paso.</Text>
    </Panel>
  );
}

// ---------- 6 · comparación con los estudiantes del grupo ----------

export function ComparePanel({ item, steps, step }) {
  const { colors } = useTheme();
  const i = steps.findIndex((s) => s.id === 'compare' || s.id === 'store');
  const state = i < 0 || step < i ? 'idle' : step === i ? 'active' : 'done';
  const c = similarityRows(item);
  const storage = item.trace.storage;
  const title = c ? '6 · Comparación con el grupo' : storage ? '6 · Guardar el vector' : '6 · Comparación';
  return (
    <Panel title={title} icon="stats-chart" state={state} hint="Compara el embedding con los del grupo">
      {c ? (
        <>
          {c.rows.length === 0 ? <Text variant="small">No hay estudiantes inscritos para comparar.</Text> : c.rows.map((r) => (
            <View key={r.document} style={{ gap: 2 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.sm }}>
                <Text variant="small" weight={r.best ? '700' : '400'} numberOfLines={1} style={{ flex: 1 }}>{r.name}</Text>
                <Text variant="small" weight="700">{sim(r.similarity)}</Text>
              </View>
              <View style={{ height: 14, borderRadius: 7, backgroundColor: colors.surfaceAlt, overflow: 'visible' }}>
                <View style={{ height: 14, width: `${Math.max(0, Math.min(1, r.similarity)) * 100}%`, borderRadius: 7,
                  backgroundColor: r.passes ? colors.successStrong : colors.textMuted }} />
                <View style={{ position: 'absolute', left: `${c.tau * 100}%`, top: -3, width: 2, height: 20, backgroundColor: colors.danger }} />
              </View>
            </View>
          ))}
          <Text variant="caption" color="textMuted">
            <Text variant="caption" color="danger" weight="700">| τ = {sim(c.tau)}</Text> umbral mínimo. {c.hidden ? `+${c.hidden} más · ` : ''}
            {c.margin != null ? `Ventaja del primero sobre el segundo: ${sim(c.margin)} (mínimo ${sim(c.minMargin)}).` : ''}
            {notEnrolled(item) ? ` ${notEnrolled(item)} del grupo sin inscribir.` : ''}
          </Text>
        </>
      ) : storage ? (
        <Text variant="small">El vector de 512 valores se guarda en la galería del servicio con el documento <Text variant="small" weight="700">{storage.student_id}</Text>. {storage.replaced ? 'Reemplaza al anterior.' : 'Es la primera vez que se inscribe.'} La galería ya tiene {storage.gallery_size} estudiante(s).</Text>
      ) : <Text variant="small" color="textMuted">No hay comparación en este recorrido.</Text>}
    </Panel>
  );
}

// ---------- 7 · decisión ----------

export function DecisionPanel({ item, steps, step }) {
  const { colors } = useTheme();
  const i = steps.findIndex((s) => s.id === 'decision');
  const state = step < i ? 'idle' : 'active';
  const d = describeDecision(item);
  const tone = { success: colors.success, info: colors.info, danger: colors.danger, warning: colors.warning }[d.tone];
  const soft = { success: colors.successSoft, info: colors.infoSoft, danger: colors.dangerSoft, warning: colors.warningSoft }[d.tone];
  const t = item.trace.timings_ms ?? {};
  return (
    <Panel title="7 · Decisión" icon="flag" state={state === 'idle' ? 'idle' : 'done'} style={{ borderColor: state === 'idle' ? colors.border : tone, borderWidth: state === 'idle' ? 1 : 2 }}
      hint="El sistema decide si marca la asistencia">
      <View style={{ backgroundColor: soft, borderRadius: radius.md, padding: space.md, gap: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <Icon name={d.icon} size={30} color={tone} />
          <Text variant="heading" style={{ color: tone, flex: 1 }}>{d.title}</Text>
        </View>
        {d.student ? <Text variant="title">{d.student}</Text> : null}
        <Text variant="small">{d.detail}</Text>
      </View>
      <Text variant="caption" color="textMuted">
        Tiempos: detección {fmtMs(t.detect)} · red {fmtMs(t.network)}{t.compare != null ? ` · comparación ${fmtMs(t.compare)}` : ''} · total del motor {fmtMs(t.engine)}
      </Text>
    </Panel>
  );
}
