import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image, Platform, Pressable, ScrollView, View } from 'react-native';
import { api } from '../api';
import { Button, Card, Chip, EmptyState, Icon, ProgressBar, ScreenHeader, Text } from '../ui';
import { radius, space, useTheme } from '../theme';
import { buildSteps, describeDecision, mergeItems } from '../lib/trace';
import {
  ComparePanel, CropPanel, DecisionPanel, DensePanel, DetectionPanel, NetworkPanel, PhotoPanel,
} from '../components/lab/Panels';

// "Laboratorio IA": segunda pantalla para exponer cómo viaja una foto (inscripción o reconocimiento) por la red
// neuronal. Consulta GET /api/trace cada 400 ms y anima lo que llega, con los datos reales de esa foto.
//   En vivo      -> cada recorrido nuevo se anima solo, paso a paso, a la velocidad elegida.
//   Paso a paso  -> el presentador avanza con los botones o con ← → (los recorridos nuevos esperan su turno).

const POLL_MS = 400;
const SPEEDS = [['Lento', 0.5], ['Normal', 1], ['Rápido', 2]];
const STATUS_ICON = { marked: 'checkmark-circle', already_present: 'information-circle', unknown: 'close-circle', enrolled: 'person-add', rejected: 'close-circle' };

function History({ items, currentId, onPick }) {
  const { colors } = useTheme();
  if (items.length === 0) return null;
  return (
    <View style={{ gap: space.xs }}>
      <Text variant="caption" color="textMuted">Últimos recorridos · toque uno para repetirlo</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
        {[...items].reverse().map((it) => {
          const d = describeDecision(it);
          const tone = { success: colors.success, info: colors.info, danger: colors.danger, warning: colors.warning }[d.tone];
          const on = it.id === currentId;
          return (
            <Pressable key={it.id} onPress={() => onPick(it)} accessibilityRole="button" accessibilityLabel={`Repetir recorrido ${it.id}: ${d.title}`}
              style={{ width: 96, gap: 4, padding: 4, borderRadius: radius.md, borderWidth: on ? 2 : 1, borderColor: on ? colors.primary : colors.border, backgroundColor: colors.surface }}>
              <Image source={{ uri: it.trace.input.image }} style={{ width: 86, height: 60, borderRadius: 6 }} resizeMode="cover" />
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                <Icon name={STATUS_ICON[it.decision?.status] ?? 'alert-circle'} size={14} color={tone} />
                <Text variant="caption" numberOfLines={1} style={{ flex: 1 }}>{it.kind === 'enroll' ? 'Inscripción' : 'Asistencia'}</Text>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

export default function LabScreen() {
  const { colors } = useTheme();
  const [items, setItems] = useState([]);
  const [current, setCurrent] = useState(null);
  const [step, setStep] = useState(0);
  const [finished, setFinished] = useState(false);
  const [mode, setMode] = useState('live');
  const [speed, setSpeed] = useState(1);
  const [conn, setConn] = useState('connecting');   // connecting | ok | demo-off | offline
  const [waiting, setWaiting] = useState(0);
  const queue = useRef([]);
  const cursor = useRef(null);
  const live = useRef({});                            // estado más reciente para el sondeo (que no se reinicia)
  live.current = { mode, current, finished };

  const steps = useMemo(() => buildSteps(current), [current]);
  const last = steps.length - 1;

  const show = useCallback((item) => { setCurrent(item); setStep(0); setFinished(false); }, []);
  const takeQueued = useCallback(() => {
    const next = queue.current.shift();
    setWaiting(queue.current.length);
    if (next) show(next);
    return !!next;
  }, [show]);

  // ---- sondeo de recorridos nuevos ----
  useEffect(() => {
    let stop = false;
    let timer;
    const handle = (incoming) => {
      if (!incoming.length) return;
      setItems((cur) => mergeItems(cur, incoming));
      const st = live.current;
      const idle = !st.current || st.finished;
      if (!st.current) {
        show(incoming[incoming.length - 1]);                       // primera vez: el más reciente
      } else if (st.mode === 'live' && idle) {
        show(incoming[0]);
        queue.current = incoming.slice(1).slice(-2);
        setWaiting(queue.current.length);
      } else {
        queue.current = [...queue.current, ...incoming].slice(-2); // esperan su turno
        setWaiting(queue.current.length);
      }
    };
    const tick = async () => {
      let wait = POLL_MS;
      try {
        if (cursor.current === null) {
          const r = await api.trace();
          if (r.demo) { cursor.current = r.last_id; setConn('ok'); } else { setConn('demo-off'); wait = 3000; }
        } else {
          const r = await api.trace(cursor.current);
          cursor.current = r.last_id;
          setConn('ok');
          handle(r.items);
        }
      } catch {
        setConn('offline');
        wait = 1500;
      }
      if (!stop) timer = setTimeout(tick, wait);
    };
    tick();
    return () => { stop = true; clearTimeout(timer); };
  }, [show]);

  // ---- reproducción automática (modo En vivo) ----
  useEffect(() => {
    if (mode !== 'live' || !current || finished) return undefined;
    const t = setTimeout(() => {
      if (step < last) setStep(step + 1);
      else if (!takeQueued()) setFinished(true);
    }, Math.max(80, steps[step].ms / speed));
    return () => clearTimeout(t);
  }, [mode, current, step, finished, speed, steps, last, takeQueued]);

  // Al volver a En vivo con un recorrido terminado y otros esperando, sigue con el siguiente
  useEffect(() => { if (mode === 'live' && finished && queue.current.length) takeQueued(); }, [mode, finished, takeQueued]);

  // ---- controles del modo Paso a paso ----
  const next = useCallback(() => {
    if (step < last) setStep(step + 1);
    else takeQueued();
  }, [step, last, takeQueued]);
  const prev = useCallback(() => setStep((s) => Math.max(0, s - 1)), []);
  const replay = useCallback(() => { setStep(0); setFinished(false); }, []);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return undefined;
    const onKey = (e) => {
      if (['INPUT', 'TEXTAREA'].includes(e.target?.tagName)) return;
      if (e.key === ' ') { e.preventDefault(); setMode((m) => (m === 'live' ? 'step' : 'live')); }
      else if (mode === 'step' && (e.key === 'ArrowRight' || e.key === 'ArrowDown')) { e.preventDefault(); next(); }
      else if (mode === 'step' && (e.key === 'ArrowLeft' || e.key === 'ArrowUp')) { e.preventDefault(); prev(); }
      else if (e.key === 'r' || e.key === 'R') replay();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [mode, next, prev, replay]);

  // ---- vista ----
  const stateFor = (id) => {
    const i = steps.findIndex((s) => s.id === id);
    return i < 0 || step < i ? 'idle' : step === i ? 'active' : 'done';
  };
  const idx = (id) => steps.findIndex((s) => s.id === id);
  const connChip = {
    ok: <Chip tone="success" icon="radio" label="Conectado · esperando fotos" />,
    connecting: <Chip tone="neutral" icon="sync" label="Conectando…" />,
    offline: <Chip tone="danger" icon="cloud-offline" label="Sin conexión con el servidor" />,
    'demo-off': <Chip tone="warning" icon="power" label="Modo demo apagado" />,
  }[conn];

  const header = (
    <ScreenHeader title="Laboratorio IA" right={connChip} />
  );

  if (conn === 'demo-off') {
    return (
      <ScrollView contentContainerStyle={{ padding: space.xl }}>
        {header}
        <EmptyState icon="flask" title="El modo demo está apagado"
          message="Inicie el backend (Node) y el servicio de reconocimiento (Python) con la variable DEMO_TRACE=1 y vuelva a abrir esta pantalla." />
      </ScrollView>
    );
  }

  const decision = current ? describeDecision(current) : null;
  const caption = !current ? '' : steps[step]?.id === 'decision' ? `Decisión: ${decision.title}` : steps[step]?.caption;
  const detectIdx = idx('detect');
  const tr = current?.trace;
  const decisionIdx = idx('decision');
  const noCrop = tr && !tr.crop;

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: 60, gap: space.sm }}>
      {header}

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.md }}>
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <Button label="En vivo" icon="play" variant={mode === 'live' ? 'primary' : 'secondary'} onPress={() => setMode('live')} />
          <Button label="Paso a paso" icon="footsteps" variant={mode === 'step' ? 'primary' : 'secondary'} onPress={() => setMode('step')} />
        </View>
        {mode === 'live' ? (
          <View style={{ flexDirection: 'row', gap: space.xs, alignItems: 'center' }}>
            <Text variant="small" color="textMuted">Velocidad</Text>
            {SPEEDS.map(([label, v]) => <Button key={label} label={label} variant={speed === v ? 'soft' : 'ghost'} onPress={() => setSpeed(v)} />)}
          </View>
        ) : (
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <Button label="Anterior" icon="chevron-back" variant="secondary" disabled={!current || step === 0} onPress={prev} />
            <Button label={step >= last && waiting ? 'Ver el nuevo' : 'Siguiente'} icon="chevron-forward" disabled={!current || (step >= last && !waiting)} onPress={next} />
            <Button label="Repetir" icon="refresh" variant="ghost" disabled={!current} onPress={replay} />
          </View>
        )}
        {waiting > 0 ? <Chip tone="primary" icon="notifications" label={`${waiting} recorrido(s) nuevo(s) en espera`} /> : null}
      </View>
      {current ? <ProgressBar value={(step + 1) / steps.length} color="primary" height={6} /> : null}

      {current ? (
        <Card style={{ backgroundColor: colors.primarySoft, borderColor: colors.primary, paddingVertical: space.md, flexDirection: 'row', alignItems: 'center', gap: space.md }}>
          <Text variant="heading" accessibilityLiveRegion="polite" style={{ flex: 1 }}>{caption}</Text>
          <Text variant="label" color="primary">Paso {step + 1} de {steps.length}</Text>
        </Card>
      ) : null}

      {!current ? (
        <EmptyState icon="camera" title={conn === 'offline' ? 'Sin conexión con el servidor' : 'Esperando una foto…'}
          message={conn === 'offline'
            ? 'Revise la dirección del servidor en Ajustes y que el backend esté encendido.'
            : 'Pida que tomen una foto en la tablet (inscribir a alguien o tomar asistencia). Aparecerá aquí al instante.'} />
      ) : (
        <>
          {/* 3 columnas: entrada · red neuronal · resultado. En pantallas estrechas se apilan solas. */}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md, alignItems: 'flex-start' }}>
            <View style={{ width: 272, gap: space.md }}>
              <PhotoPanel item={current} state={stateFor('input')} showDetection={detectIdx >= 0 && step >= detectIdx} />
              <DetectionPanel item={current} state={stateFor('detect')} />
              <CropPanel item={current} state={noCrop ? (decisionIdx >= 0 && step >= decisionIdx ? 'done' : 'idle') : stateFor('crop')} />
            </View>
            <View style={{ flex: 1, minWidth: 600, gap: space.md }}>
              <NetworkPanel item={current} steps={steps} step={step} />
              <DensePanel item={current} steps={steps} step={step} />
            </View>
            <View style={{ width: 340, gap: space.md }}>
              <ComparePanel item={current} steps={steps} step={step} />
              <DecisionPanel item={current} steps={steps} step={step} />
            </View>
          </View>
        </>
      )}

      <History items={items} currentId={current?.id} onPick={(it) => { show(it); }} />
      {Platform.OS === 'web' ? (
        <Text variant="caption" color="textMuted">Teclado: Espacio cambia entre En vivo y Paso a paso · ← → avanzan o retroceden (Paso a paso) · R repite el recorrido</Text>
      ) : null}
    </ScrollView>
  );
}
