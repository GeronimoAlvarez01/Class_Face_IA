import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Modal, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, bumpPhotos, photoUrl } from '../api';
import { useApp } from '../context';
import { Avatar, Button, Card, Checkbox, Chip, Field, Icon, IconButton, InlineError, Sheet, Text, haptic, useFeedback } from '../ui';
import { CameraBox, FaceGuide } from './CameraBox';
import { radius, space, useTheme } from '../theme';

const DOC_RE = /^[A-Za-z0-9]{4,20}$/;

/** Pantalla completa de cámara para fotografiar al estudiante (una foto de frente). */
function CaptureModal({ visible, onClose, onCaptured }) {
  const insets = useSafeAreaInsets();
  const camRef = useRef(null);
  const [facing, setFacing] = useState('back');
  const [busy, setBusy] = useState(false);

  const take = async () => {
    if (busy || !camRef.current?.isReady()) return;
    setBusy(true);
    try {
      haptic.tap();
      // Calidad alta: esta foto es la referencia de por vida del estudiante
      onCaptured(await camRef.current.capture(0.85));
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        <CameraBox
          ref={camRef}
          facing={facing}
          style={{ flex: 1, borderRadius: 0 }}
          overlay={(
            <>
              <FaceGuide />
              <View style={{ position: 'absolute', top: insets.top + 12, left: 12, right: 12, flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: radius.pill, paddingRight: space.md }}>
                <IconButton icon="close" label="Cancelar" tone="#FFFFFF" onPress={onClose} />
                <Text weight="700" color="#FFFFFF" style={{ flex: 1 }}>Foto de frente, con buena luz</Text>
                <IconButton icon="camera-reverse" label="Cambiar de cámara" tone="#FFFFFF" onPress={() => setFacing((f) => (f === 'back' ? 'front' : 'back'))} />
              </View>
              <View style={{ position: 'absolute', left: 0, right: 0, bottom: insets.bottom + 24, alignItems: 'center' }}>
                <Pressable
                  onPress={take}
                  disabled={busy}
                  accessibilityRole="button"
                  accessibilityLabel="Tomar foto"
                  style={({ pressed }) => ({ width: 82, height: 82, borderRadius: 41, borderWidth: 5, borderColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', opacity: busy ? 0.5 : pressed ? 0.8 : 1 })}
                >
                  {busy ? <ActivityIndicator color="#FFFFFF" /> : <View style={{ width: 62, height: 62, borderRadius: 31, backgroundColor: '#FFFFFF' }} />}
                </Pressable>
              </View>
            </>
          )}
        />
      </View>
    </Modal>
  );
}

/**
 * Crear o editar un estudiante.
 *  - Crear: documento, nombre, foto de frente, grupos y consentimiento. La foto se valida de inmediato:
 *    si no tiene un rostro claro el servidor responde y el administrador la repite en el momento.
 *  - Editar: solo nombre y (opcionalmente) reemplazar la foto.
 */
export function StudentForm({ visible, onClose, student, defaultGroupIds = [], onSaved }) {
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
    setDocument(student?.document ?? '');
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
      if (editing) {
        await api.students.update(student.id, { full_name: fullName.trim(), ...(photo ? { photo_base64: photo.base64 } : {}) });
        toast('Estudiante actualizado', 'success');
      } else {
        await api.students.create({
          document: document.trim(), full_name: fullName.trim(), consent: true, photo_base64: photo.base64, group_ids: groupIds,
        });
        toast(`${fullName.trim()} quedó registrado`, 'success');
      }
      bumpPhotos();
      reloadGroups();
      onSaved?.();
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
          placeholder="APELLIDOS NOMBRES"
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
