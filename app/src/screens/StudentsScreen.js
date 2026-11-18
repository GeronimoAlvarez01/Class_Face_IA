import React, { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { api, photoUrl } from '../api';
import { useApp } from '../context';
import {
  Avatar, Button, Card, EmptyState, ErrorState, Field, IconButton, PhotoView, ScreenHeader, Sheet, SkeletonList, Text, useAsync, useFeedback,
} from '../ui';
import { StudentForm } from '../components/StudentForm';
import { space } from '../theme';

export default function StudentsScreen() {
  const { toast, confirm } = useFeedback();
  const { reloadGroups } = useApp();
  const [version, setVersion] = useState(0);
  const students = useAsync(() => api.students.list(), [version]);
  const [query, setQuery] = useState('');
  const [form, setForm] = useState({ open: false, student: null });
  const [photoOf, setPhotoOf] = useState(null);

  const refresh = () => { setVersion((v) => v + 1); reloadGroups(); };
  const list = (students.data ?? []).filter((s) => `${s.full_name} ${s.document}`.toLowerCase().includes(query.trim().toLowerCase()));

  const remove = async (s) => {
    const ok = await confirm({
      title: 'Eliminar estudiante', confirmLabel: 'Eliminar', danger: true,
      message: `Se borrarán ${s.full_name}, su foto, su huella facial y todo su historial de asistencia. Esta acción no se puede deshacer.`,
    });
    if (!ok) return;
    try { await api.students.remove(s.id); toast('Estudiante eliminado', 'success'); refresh(); } catch (e) { toast(e.message, 'error'); }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: space.xl, paddingBottom: 80, gap: space.lg }}>
      <ScreenHeader
        title="Estudiantes"
        subtitle="Registre a cada estudiante con una foto de frente. El sistema lo reconoce al instante, sin entrenar nada."
        right={<Button label="Registrar estudiante" icon="person-add" size="lg" onPress={() => setForm({ open: true, student: null })} />}
      />
      <Field value={query} onChangeText={setQuery} placeholder="Buscar por nombre o documento" accessibilityLabel="Buscar estudiante" />

      {students.error ? <ErrorState error={students.error} onRetry={students.reload} /> : students.loading && !students.data ? <SkeletonList rows={5} /> : list.length === 0 ? (
        <EmptyState
          icon={query ? 'search' : 'person-add'}
          title={query ? 'Sin resultados' : 'Aún no hay estudiantes'}
          message={query ? 'Pruebe con otro nombre o documento.' : 'Registre al primero con su nombre, documento y una foto de frente.'}
          action={query ? null : <Button label="Registrar estudiante" icon="person-add" onPress={() => setForm({ open: true, student: null })} />}
        />
      ) : (
        <View style={{ gap: space.sm }}>
          {list.map((s) => (
            <Card key={s.id} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md }}>
              <Avatar name={s.full_name} url={photoUrl(s)} size={56} />
              <View style={{ flex: 1 }}>
                <Text weight="600" numberOfLines={2}>{s.full_name}</Text>
                <Text variant="small" color="textMuted">{s.document}</Text>
              </View>
              <IconButton icon="image" label={`Ver foto de ${s.full_name}`} filled onPress={() => setPhotoOf(s)} />
              <IconButton icon="create" label={`Editar a ${s.full_name}`} filled onPress={() => setForm({ open: true, student: s })} />
              <IconButton icon="trash" label={`Eliminar a ${s.full_name}`} tone="danger" filled onPress={() => remove(s)} />
            </Card>
          ))}
        </View>
      )}

      <StudentForm visible={form.open} student={form.student} onClose={() => setForm({ open: false, student: null })} onSaved={refresh} />
      <Sheet visible={!!photoOf} onClose={() => setPhotoOf(null)} title="Foto de inscripción">
        {photoOf ? (
          <View style={{ alignItems: 'center', gap: space.md }}>
            <PhotoView url={photoUrl(photoOf)} name={photoOf.full_name} />
            <Text variant="heading" style={{ textAlign: 'center' }}>{photoOf.full_name}</Text>
            <Text color="textMuted">{photoOf.document}</Text>
          </View>
        ) : null}
      </Sheet>
    </ScrollView>
  );
}
