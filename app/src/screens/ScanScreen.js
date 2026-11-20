import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, photoUrl } from '../api';
import { useApp } from '../context';
import {
  Avatar, Button, Card, EmptyState, ErrorState, Field, Icon, IconButton, InlineError, ProgressBar, Sheet, Text, haptic, useAsync, useFeedback,
} from '../ui';
import { CameraBox, FaceGuide } from '../components/CameraBox';
import { ResultModal } from '../components/ResultModal';
import { radius, space, useTheme } from '../theme';
import { isPresent, pickScanSession } from '../lib/grid';
import { describeCheck, describeError, describeResult } from '../lib/scan';
import { longLabel } from '../lib/dates';

const SCAN_EVERY_MS = 1500; // el escáner automático revisa el encuadre cada 1,5 s mientras no haya una modal abierta
const WHITE = '#FFFFFF';
const GLASS = 'rgba(0,0,0,0.55)';

export default function ScanScreen({ groupId, onClose }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { toast } = useFeedback();
  const { health } = useApp();
  const wide = width >= 900;

  const grid = useAsync(() => api.grid.get(groupId), [groupId]);
  const camRef = useRef(null);
  const busyRef = useRef(false);
  const cooldownUntil = useRef(0);

  const [facing, setFacing] = useState('back');
  const [auto, setAuto] = useState(true);
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState(null);
  const [modal, setModal] = useState(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [manualError, setManualError] = useState(null);
  const [marked, setMarked] = useState(() => new Set()); // marcados en esta sesión de escaneo

  const session = useMemo(() => (grid.data ? pickScanSession(grid.data, health?.allow_any_day).session : null), [grid.data, health]);

  const presentIds = useMemo(() => {
    const ids = new Set(marked);
    if (grid.data && session) grid.data.students.forEach((st) => { if (isPresent(st, session.id)) ids.add(st.id); });
    return ids;
  }, [grid.data, session, marked]);
  const students = grid.data?.students ?? [];
  const missing = students.filter((st) => !presentIds.has(st.id));

  const markLocal = (id) => setMarked((prev) => new Set(prev).add(id));

  const showResult = useCallback((view) => {
    setHint(null);
    setModal(view);
  }, []);

  const closeModal = useCallback(() => {
    cooldownUntil.current = Date.now() + (modal?.cooldownMs ?? 0);
    setModal(null);
  }, [modal]);

  /**
   * Una captura. En automático va en dos fases: primero se revisa el encuadre (/api/face-check, sin indicador de
   * carga ni modal) y solo si el rostro está bien ubicado en el óvalo se reconoce esa misma foto.
   * `manual` (el profesor tocó el botón) reconoce directo e ignora el enfriamiento; el servidor igual exige el óvalo.
   */
  const attempt = useCallback(async (manual = false) => {
    if (!session || busyRef.current || !camRef.current?.isReady()) return;
    if (!manual && Date.now() < cooldownUntil.current) return;
    busyRef.current = true;
    try {
      const photo = await camRef.current.capture(0.5);
      if (!manual) {
        const check = describeCheck(await api.faceCheck(photo.base64, photo.guide));
        if (!check.ready) {
          setHint(check.message);
          return;
        }
      }
      setBusy(true);
      const res = await api.recognize(session.id, photo.base64, photo.guide);
      const view = describeResult(res);
      if (view.kind === 'hint') {
        setHint(view.message);
      } else {
        if (res.student) markLocal(res.student.id); // marked o already_present: ya está en la lista
        showResult(view);
      }
    } catch (e) {
      showResult(describeError(e));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [session, showResult]);

  // Escáner automático: se detiene mientras haya una modal y se reanuda al cerrarla
  useEffect(() => {
    if (!auto || modal || !session) return undefined;
    const id = setInterval(() => attempt(false), SCAN_EVERY_MS);
    return () => clearInterval(id);
  }, [auto, modal, session, attempt]);

  const markManually = async (student) => {
    try {
      await api.grid.save(groupId, [{ session_id: session.id, student_id: student.id, status: 'present' }]);
      markLocal(student.id);
      setManualOpen(false);
      setSearch('');
      toast(`Asistencia de ${student.full_name} registrada`, 'success');
    } catch (e) {
      setManualError(e.message);
    }
  };

  // ---------- estados previos a la cámara ----------
  const centered = (child) => (
    <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', padding: space.xl, paddingTop: insets.top + space.xl }}>
      {child}
      <View style={{ height: space.lg }} />
      <Button label="Volver" variant="secondary" icon="chevron-back" onPress={onClose} />
    </View>
  );
  if (grid.loading && !grid.data) return centered(<ActivityIndicator size="large" />);
  if (grid.error) return centered(<ErrorState error={grid.error} onRetry={grid.reload} />);
  if (!session) {
    return centered(<EmptyState icon="calendar" title="Hoy no hay clase programada" message="La asistencia solo se toma el día de la clase. Revisa el calendario del grupo." />);
  }
  if (students.length === 0) {
    return centered(<EmptyState icon="people" title="El grupo no tiene estudiantes" message="Agrega estudiantes con su foto antes de tomar asistencia." />);
  }

  // Verde y continuo cuando el rostro quedó reconocido (o ya estaba registrado); rojo si no coincide; ámbar si hay que reencuadrar
  const recognized = modal?.kind === 'success' || modal?.kind === 'info';
  const guideColor = recognized ? colors.successStrong : modal?.kind === 'error' ? colors.danger : hint ? '#FBBF24' : 'rgba(255,255,255,0.85)';
  const statusText = busy ? 'Reconociendo…' : hint ?? (auto ? 'Ubica el rostro en el óvalo.' : 'Ubica el rostro en el óvalo y toca el botón para capturar.');
  const filtered = missing.filter((s) => `${s.full_name} ${s.document}`.toLowerCase().includes(search.trim().toLowerCase()));

  const panel = (
    <View style={{ width: 380, backgroundColor: colors.bg, padding: space.xl, paddingTop: insets.top + space.xl, gap: space.lg }}>
      <View>
        <Text variant="heading">Asistencia de hoy</Text>
        <Text color="textMuted">{longLabel(session.date)}</Text>
      </View>
      <Card style={{ gap: space.sm }}>
        <Text variant="display">{presentIds.size}<Text variant="heading" color="textMuted"> / {students.length}</Text></Text>
        <ProgressBar value={presentIds.size / students.length} height={10} />
        <Text variant="small" color="textMuted">presentes</Text>
      </Card>
      <Text variant="label">Faltan por registrar ({missing.length})</Text>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: space.sm }}>
        {missing.length === 0 ? (
          <Card style={{ alignItems: 'center', gap: space.sm }}><Icon name="checkmark-circle" size={36} color="success" /><Text weight="600">¡Todos presentes!</Text></Card>
        ) : missing.map((st) => (
          <View key={st.id} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
            <Avatar name={st.full_name} url={photoUrl(st)} size={36} />
            <Text variant="small" style={{ flex: 1 }} numberOfLines={2}>{st.full_name}</Text>
          </View>
        ))}
      </ScrollView>
      <Button label="Marcar manualmente" icon="create" variant="secondary" onPress={() => setManualOpen(true)} />
      <Button label="Terminar" icon="checkmark-done" onPress={onClose} />
    </View>
  );

  return (
    <View style={{ flex: 1, flexDirection: 'row', backgroundColor: '#000' }}>
      <CameraBox
        ref={camRef}
        facing={facing}
        style={{ flex: 1, borderRadius: 0 }}
        overlay={(
          <>
            <FaceGuide color={guideColor} solid={recognized} />

            {/* Barra superior */}
            <View style={{ position: 'absolute', top: insets.top + 12, left: 12, right: 12, flexDirection: 'row', alignItems: 'center', gap: space.sm, backgroundColor: GLASS, borderRadius: radius.pill, paddingRight: space.md }}>
              <IconButton icon="chevron-back" label="Salir del escáner" tone={WHITE} onPress={onClose} />
              <View style={{ flex: 1 }}>
                <Text weight="700" color={WHITE} numberOfLines={1}>Tomando asistencia · Semana {session.week_number}</Text>
                <Text variant="caption" color="#CBD5E1" numberOfLines={1}>{grid.data.group.label}</Text>
              </View>
              {!wide ? <Text weight="700" color={WHITE}>{presentIds.size}/{students.length}</Text> : null}
              <IconButton icon="camera-reverse" label="Cambiar de cámara" tone={WHITE} onPress={() => setFacing((f) => (f === 'back' ? 'front' : 'back'))} />
            </View>

            {/* Controles inferiores */}
            <View style={{ position: 'absolute', left: 0, right: 0, bottom: insets.bottom + 20, alignItems: 'center', gap: space.lg }}>
              <View
                accessibilityLiveRegion="polite"
                style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, backgroundColor: GLASS, borderRadius: radius.pill, paddingHorizontal: space.lg, paddingVertical: space.sm, maxWidth: '90%' }}
              >
                {busy ? <ActivityIndicator color={WHITE} size="small" /> : <Icon name={hint ? 'alert-circle' : 'scan'} size={18} color={hint ? '#FBBF24' : WHITE} />}
                <Text variant="small" color={WHITE} style={{ flexShrink: 1 }}>{statusText}</Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xl }}>
                <Pressable
                  onPress={() => { haptic.tap(); setAuto((a) => !a); }}
                  accessibilityRole="switch"
                  accessibilityState={{ checked: auto }}
                  accessibilityLabel="Escaneo automático"
                  style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.lg, borderRadius: radius.pill, backgroundColor: auto ? colors.primary : GLASS }}
                >
                  <Icon name={auto ? 'flash' : 'flash-off'} size={20} color={auto ? 'primaryText' : WHITE} />
                  <Text variant="label" color={auto ? 'primaryText' : WHITE}>Automático</Text>
                </Pressable>
                <Pressable
                  onPress={() => attempt(true)}
                  disabled={busy}
                  accessibilityRole="button"
                  accessibilityLabel="Capturar y reconocer"
                  style={({ pressed }) => ({ width: 78, height: 78, borderRadius: 39, borderWidth: 5, borderColor: WHITE, alignItems: 'center', justifyContent: 'center', opacity: busy ? 0.5 : pressed ? 0.8 : 1 })}
                >
                  <View style={{ width: 58, height: 58, borderRadius: 29, backgroundColor: WHITE }} />
                </Pressable>
                <Pressable
                  onPress={() => setManualOpen(true)}
                  accessibilityRole="button"
                  accessibilityLabel="Marcar asistencia manualmente"
                  style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.lg, borderRadius: radius.pill, backgroundColor: GLASS }}
                >
                  <Icon name="create" size={20} color={WHITE} />
                  <Text variant="label" color={WHITE}>Manual</Text>
                </Pressable>
              </View>
            </View>
          </>
        )}
      />
      {wide ? panel : null}

      <ResultModal
        result={modal}
        onClose={closeModal}
        onRetry={() => { closeModal(); setTimeout(() => attempt(true), 250); }}
        onManual={() => { closeModal(); setManualOpen(true); }}
      />

      <Sheet visible={manualOpen} onClose={() => { setManualOpen(false); setManualError(null); }} title="Marcar asistencia manualmente">
        <InlineError message={manualError} />
        <Field label="Buscar estudiante" value={search} onChangeText={setSearch} placeholder="Nombre o documento" />
        {filtered.length === 0 ? <Text color="textMuted">{missing.length === 0 ? 'Todos los estudiantes ya tienen asistencia.' : 'Sin resultados.'}</Text> : null}
        {filtered.map((st) => (
          <Pressable
            key={st.id}
            onPress={() => markManually(st)}
            accessibilityRole="button"
            accessibilityLabel={`Marcar asistencia de ${st.full_name}`}
            style={({ pressed }) => ({ minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.sm, borderRadius: radius.md, backgroundColor: pressed ? colors.primarySoft : colors.surfaceAlt })}
          >
            <Avatar name={st.full_name} url={photoUrl(st)} size={44} />
            <View style={{ flex: 1 }}>
              <Text weight="600" numberOfLines={2}>{st.full_name}</Text>
              <Text variant="small" color="textMuted">{st.document}</Text>
            </View>
            <Icon name="checkmark-circle" color="success" />
          </Pressable>
        ))}
      </Sheet>
    </View>
  );
}
