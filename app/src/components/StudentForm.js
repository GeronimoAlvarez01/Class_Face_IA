import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Image, Modal, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, bumpPhotos, photoUrl } from '../api';
import { useApp } from '../context';
import { Avatar, Button, Card, Checkbox, Chip, Field, Icon, IconButton, InlineError, Sheet, Text, haptic, useFeedback } from '../ui';
import { CameraBox, FaceGuide } from './CameraBox';
import { ResultModal } from './ResultModal';
import { radius, space, useTheme } from '../theme';

const DOC_RE = /^[A-Za-z0-9]{4,20}$/;

const CHECK_EVERY_MS = 1000;       // sin detector local: un cuadro de prueba por segundo mientras no haya foto
const TICK_MS = 300;               // con detector local: solo mira si ya está listo (no toma fotos hasta entonces)
const RETRY_MS = 1500;             // si el servidor no confirma la foto, espera antes de volver a intentar
const SUCCESS_MODAL = {
  kind: 'success', title: 'Foto registrada correctamente', message: 'El rostro quedó bien encuadrado.', autoCloseMs: 2200,
};

/**
 * Pantalla completa de cámara para fotografiar al estudiante. NO hay botón de disparo: la persona encuadra el
 * rostro dentro del óvalo y, cuando el servidor confirma que está bien encuadrado, el óvalo se pone verde, se toma
 * la foto sola y sale una modal de confirmación.
 */
function CaptureModal({ visible, onClose, onCaptured }) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const camRef = useRef(null);
  const busyRef = useRef(false);
  const doneRef = useRef(false);
  const [facing, setFacing] = useState('front');
  const [hint, setHint] = useState('Ubica el rostro en el óvalo.');
  const [problem, setProblem] = useState(false);
  const [result, setResult] = useState(null);   // la modal "Foto registrada correctamente"
  const [photo, setPhoto] = useState(null);
  // Detector de rostros en el dispositivo (web): { status, message, ready } o null si no hay
  const [live, setLive] = useState(null);
  const liveRef = useRef(null);
  const nextTryAt = useRef(0);
  const onFace = useCallback((s) => {
    liveRef.current = s;
    setLive(s);
    if (s && !s.ready) setProblem(false); // se movió: el aviso vuelve a ser el del detector
  }, []);

  useEffect(() => {
    if (!visible) return undefined;
    doneRef.current = false;
    busyRef.current = false;
    nextTryAt.current = 0;
    setResult(null);
    setPhoto(null);
    setProblem(false);
    setHint('Ubica el rostro en el óvalo.');

    const tick = async () => {
      if (busyRef.current || doneRef.current || !camRef.current?.isReady() || Date.now() < nextTryAt.current) return;
      const local = !!liveRef.current; // hay detector local
      if (local && !liveRef.current.ready) return; // no se toma ninguna foto hasta que el rostro esté en el óvalo
      busyRef.current = true;
      try {
        if (!local) {
          // 1) sin detector local: cuadro de prueba, barato, revisado en el servidor
          nextTryAt.current = Date.now() + CHECK_EVERY_MS;
          const probe = await camRef.current.capture(0.4);
          const first = await api.faceCheck(probe.base64, probe.guide);
          if (doneRef.current) return;
          if (first.status !== 'ok') { setProblem(true); setHint(first.message ?? 'Ubica el rostro en el óvalo.'); return; }
        }
        // 2) foto buena (es la referencia de por vida del estudiante) y se comprueba ELLA, no solo el cuadro de prueba
        const final = await camRef.current.capture(0.8);
        const second = await api.faceCheck(final.base64, final.guide);
        if (doneRef.current) return;
        if (second.status !== 'ok') {
          setProblem(true);
          setHint(second.message ?? 'Mantén el rostro quieto dentro del óvalo.');
          nextTryAt.current = Date.now() + RETRY_MS; // el servidor vio otra cosa: no insistir enseguida
          return;
        }
        doneRef.current = true;
        setProblem(false);
        setPhoto(final);
        setResult(SUCCESS_MODAL);
      } catch (e) {
        setProblem(true);
        setHint(e.status === 0 ? 'No hay conexión con el servidor.' : e.message || 'No se pudo revisar la foto.');
        nextTryAt.current = Date.now() + RETRY_MS;
      } finally {
        busyRef.current = false;
      }
    };

    const id = setInterval(tick, TICK_MS);
    return () => { clearInterval(id); doneRef.current = true; };
  }, [visible]);

  const finish = () => {
    const taken = photo;
    setResult(null);
    if (taken) onCaptured(taken);
    onClose();
  };

  const ok = !!result;
  // Con detector local, mientras el rostro no esté listo el aviso es el suyo (acércate, aléjate, ubica el rostro...)
  const liveProblem = !!live && !live.ready && live.status !== 'ok' && live.status !== 'loading';
  const showProblem = live && !live.ready ? liveProblem : problem;
  const shownHint = live && (!live.ready || !problem) ? live.message : hint;
  const guideColor = ok ? colors.successStrong : showProblem ? '#FBBF24' : 'rgba(255,255,255,0.85)';

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        <CameraBox
          ref={camRef}
          facing={facing}
          style={{ flex: 1, borderRadius: 0 }}
          onFace={onFace}
          overlay={(
            <>
              <FaceGuide color={guideColor} solid={ok} />
              <View style={{ position: 'absolute', top: insets.top + 12, left: 12, right: 12, flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: radius.pill, paddingRight: space.md }}>
                <IconButton icon="close" label="Cancelar" tone="#FFFFFF" onPress={onClose} />
                <Text weight="700" color="#FFFFFF" style={{ flex: 1 }}>Foto de frente, con buena luz</Text>
                <IconButton icon="camera-reverse" label="Cambiar de cámara" tone="#FFFFFF" onPress={() => setFacing((f) => (f === 'back' ? 'front' : 'back'))} />
              </View>
              <View style={{ position: 'absolute', left: 0, right: 0, bottom: insets.bottom + 28, alignItems: 'center' }}>
                <View
                  accessibilityLiveRegion="polite"
                  style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: radius.pill, paddingHorizontal: space.lg, paddingVertical: space.md, maxWidth: '90%' }}
                >
                  <Icon name={ok ? 'checkmark-circle' : showProblem ? 'alert-circle' : 'scan'} size={20} color={ok ? 'success' : showProblem ? '#FBBF24' : '#FFFFFF'} />
                  <Text color="#FFFFFF" style={{ flexShrink: 1 }}>{ok ? 'Rostro encuadrado' : shownHint}</Text>
                </View>
              </View>
            </>
          )}
        />
        {/* Dentro de este Modal para que se vea encima en iOS y Android */}
        <ResultModal result={result} onClose={finish} />
      </View>
    </Modal>
  );
}

/**
 * Crear o editar un estudiante.
 *  - Crear: documento, nombre, foto de frente, grupos y consentimiento. La foto se valida de inmediato:
 *    si no tiene un rostro claro el servidor responde y el administrador la repite en el momento.
 *  - Editar: solo nombre y (opcionalmente) reemplazar la foto.
 * `defaultDocument` precarga el documento al crear; `onSaved(estudiante, groupIds)` recibe el estudiante creado y los
 * grupos elegidos (al editar, el estudiante actualizado).
 */
export function StudentForm({ visible, onClose, student, defaultGroupIds = [], defaultDocument = '', onSaved }) {
  const { colors } = useTheme();
  const { toast } = useFeedback();
  const { groups, reloadGroups } = useApp();
  const editing = !!student;

  const [document, setDocument] = useState('');
  const [fullName, setFullName] = useState('');
  const [photo, setPhoto] = useState(null);
  const [groupIds, setGroupIds] = useState([]);
  const [consent, setConsent] = useState(false);
  const [saving, setSaving] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [errors, setErrors] = useState({});

  useEffect(() => {
    if (!visible) return;
    setDocument(student?.document ?? defaultDocument);
    setFullName(student?.full_name ?? '');
    setPhoto(null);
    setGroupIds(defaultGroupIds);
    setConsent(false);
    setErrors({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, student]);

  const validate = () => {
    const e = {};
    if (!fullName.trim()) e.fullName = 'Escriba el nombre completo';
    if (!editing && !DOC_RE.test(document.trim())) e.document = 'Use de 4 a 20 letras o números, sin espacios';
    if (!editing && !photo) e.photo = 'Tome una foto de frente del estudiante';
    if (!editing && !consent) e.consent = 'Se necesita la autorización del estudiante';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = async () => {
    if (!validate()) { haptic.error(); return; }
    setSaving(true);
    try {
      let saved;
      if (editing) {
        saved = await api.students.update(student.id, { full_name: fullName.trim(), ...(photo ? { photo_base64: photo.base64 } : {}) });
        toast('Estudiante actualizado', 'success');
      } else {
        saved = await api.students.create({
          document: document.trim(), full_name: fullName.trim(), consent: true, photo_base64: photo.base64, group_ids: groupIds,
        });
        toast(`${fullName.trim()} quedó registrado`, 'success');
      }
      bumpPhotos();
      reloadGroups();
      onSaved?.(saved, groupIds);
      onClose();
    } catch (err) {
      // 422 = el servicio no encontró un rostro utilizable; 409 = documento repetido
      if (err.status === 422) setErrors({ photo: err.message });
      else if (err.status === 409) setErrors({ document: err.message });
      else setErrors({ form: err.message });
      haptic.error();
    } finally {
      setSaving(false);
    }
  };

  const toggleGroup = (id) => setGroupIds((ids) => (ids.includes(id) ? ids.filter((g) => g !== id) : [...ids, id]));

  return (
    <>
      <Sheet
        visible={visible && !capturing}
        onClose={onClose}
        title={editing ? 'Editar estudiante' : 'Registrar estudiante'}
        wide
        footer={(
          <>
            <Button label="Cancelar" variant="secondary" disabled={saving} onPress={onClose} />
            <Button label={saving ? 'Registrando rostro…' : editing ? 'Guardar cambios' : 'Registrar estudiante'} icon="checkmark" loading={saving} onPress={submit} />
          </>
        )}
      >
        <InlineError message={errors.form} />
        <Field
          label="Nombre completo"
          value={fullName}
          onChangeText={(t) => setFullName(t.toUpperCase())}
          autoCapitalize="characters"
          placeholder="NOMBRES APELLIDOS"
          error={errors.fullName}
        />
        <Field
          label="Documento de identidad"
          value={document}
          onChangeText={setDocument}
          editable={!editing}
          keyboardType="default"
          autoCapitalize="characters"
          placeholder="1007074776"
          error={errors.document}
          helper={editing ? 'El documento no se puede cambiar.' : 'Es el identificador del estudiante en el sistema.'}
        />

        <View style={{ gap: 6 }}>
          <Text variant="label">Foto de frente</Text>
          <Card style={{ borderColor: errors.photo ? colors.danger : colors.border, borderStyle: photo || editing ? 'solid' : 'dashed', gap: space.md }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.lg, flexWrap: 'wrap' }}>
              {photo ? (
                <Image source={{ uri: photo.uri }} style={{ width: 120, height: 150, borderRadius: radius.md }} accessibilityLabel="Foto tomada" />
              ) : editing ? (
                <Avatar name={student.full_name} url={photoUrl(student)} size={96} />
              ) : (
                <View style={{ width: 120, height: 150, borderRadius: radius.md, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="person" size={48} color="textMuted" />
                </View>
              )}
              <View style={{ flex: 1, minWidth: 220, gap: space.sm }}>
                <Button label={photo ? 'Repetir foto' : editing ? 'Reemplazar foto' : 'Tomar foto'} icon="camera" variant={photo ? 'secondary' : 'primary'} onPress={() => setCapturing(true)} />
                <Text variant="small" color="textMuted">De frente, rostro completo y bien iluminado, sin gafas oscuras ni gorra. Una sola persona en la foto.</Text>
              </View>
            </View>
            {errors.photo ? (
              <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' }}>
                <Icon name="alert-circle" size={20} color="danger" />
                <Text variant="small" color="danger" style={{ flex: 1 }}>{errors.photo}</Text>
              </View>
            ) : null}
          </Card>
        </View>

        {!editing ? (
          <>
            <View style={{ gap: 6 }}>
              <Text variant="label">Grupos</Text>
              {(groups ?? []).length === 0 ? <Text variant="small" color="textMuted">Aún no hay grupos. Puede matricularlo después.</Text> : (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
                  {groups.map((g) => (
                    <Chip key={g.id} label={g.label} tone={groupIds.includes(g.id) ? 'primary' : 'neutral'} icon={groupIds.includes(g.id) ? 'checkmark' : undefined} onPress={() => toggleGroup(g.id)} />
                  ))}
                </View>
              )}
            </View>
            <Checkbox
              checked={consent}
              onChange={setConsent}
              error={!!errors.consent}
              label="El estudiante autoriza el tratamiento de su imagen facial como dato biométrico, con el único fin de registrar su asistencia a clase (Ley 1581 de 2012)."
            />
            {errors.consent ? <Text variant="small" color="danger">{errors.consent}</Text> : null}
          </>
        ) : null}
      </Sheet>

      <CaptureModal visible={visible && capturing} onClose={() => setCapturing(false)} onCaptured={(p) => { setPhoto(p); setErrors((e) => ({ ...e, photo: undefined })); }} />
    </>
  );
}
