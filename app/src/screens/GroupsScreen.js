import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import { api, photoUrl } from '../api';
import { useApp } from '../context';
import {
  Avatar, Button, Card, Chip, EmptyState, ErrorState, Field, Icon, IconButton, InlineError, PhotoView, ScreenHeader, Sheet,
  SkeletonList, Text, useAsync, useFeedback,
} from '../ui';
import { StudentForm } from '../components/StudentForm';
import { radius, space, useTheme } from '../theme';

function GroupForm({ visible, onClose, group, onSaved }) {
  const { toast } = useFeedback();
  const [f, setF] = useState({ code: '', group_number: '', name: '', term: '' });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  React.useEffect(() => {
    if (visible) { setF({ code: group?.code ?? '', group_number: group?.group_number ?? '', name: group?.name ?? '', term: group?.term ?? '' }); setErrors({}); }
  }, [visible, group]);

  const set = (k) => (v) => setF((s) => ({ ...s, [k]: k === 'name' || k === 'code' ? v.toUpperCase() : v }));
  const submit = async () => {
    const e = {};
    if (!f.code.trim()) e.code = 'Escriba el código de la asignatura';
    if (!f.group_number.trim()) e.group_number = 'Escriba el número del grupo';
    if (!f.name.trim()) e.name = 'Escriba el nombre de la asignatura';
    setErrors(e);
    if (Object.keys(e).length) return;
    setSaving(true);
    try {
      const body = { code: f.code.trim(), group_number: f.group_number.trim(), name: f.name.trim(), term: f.term.trim() };
      const saved = group ? await api.groups.update(group.id, body) : await api.groups.create(body);
      toast(group ? 'Grupo actualizado' : 'Grupo creado', 'success');
      onSaved(saved);
      onClose();
    } catch (err) {
      setErrors({ form: err.message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={group ? 'Editar grupo' : 'Nuevo grupo'}
      footer={(<><Button label="Cancelar" variant="secondary" onPress={onClose} /><Button label={group ? 'Guardar' : 'Crear grupo'} icon="checkmark" loading={saving} onPress={submit} /></>)}
    >
      <InlineError message={errors.form} />
      <Field label="Nombre de la asignatura" value={f.name} onChangeText={set('name')} placeholder="METODOLOGIA DE LA INVESTIGACION" error={errors.name} />
      <View style={{ flexDirection: 'row', gap: space.md }}>
        <Field style={{ flex: 1 }} label="Código" value={f.code} onChangeText={set('code')} placeholder="ET0018" error={errors.code} autoCapitalize="characters" />
        <Field style={{ flex: 1 }} label="Grupo" value={f.group_number} onChangeText={set('group_number')} placeholder="002" error={errors.group_number} />
      </View>
      <Field label="Periodo (opcional)" value={f.term} onChangeText={set('term')} placeholder="2026-2" />
    </Sheet>
  );
}

function AddExistingSheet({ visible, onClose, group, memberIds, onAdded }) {
  const { toast } = useFeedback();
  const all = useAsync(() => (visible ? api.students.list() : Promise.resolve([])), [visible]);
  const [picked, setPicked] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const { colors } = useTheme();
  React.useEffect(() => { if (visible) { setPicked([]); setError(null); } }, [visible]);

  const available = (all.data ?? []).filter((s) => !memberIds.includes(s.id));
  const add = async () => {
    setSaving(true);
    try {
      for (const id of picked) await api.groups.addStudent(group.id, id);
      toast(`${picked.length} ${picked.length === 1 ? 'estudiante agregado' : 'estudiantes agregados'}`, 'success');
      onAdded();
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Agregar estudiantes existentes"
      footer={(<><Button label="Cancelar" variant="secondary" onPress={onClose} /><Button label={`Agregar (${picked.length})`} icon="person-add" disabled={!picked.length} loading={saving} onPress={add} /></>)}
    >
      <InlineError message={error} />
      {all.loading ? <SkeletonList rows={3} /> : available.length === 0 ? (
        <Text color="textMuted">Todos los estudiantes registrados ya están en este grupo. Use «Registrar nuevo» para crear otro.</Text>
      ) : available.map((s) => {
        const on = picked.includes(s.id);
        return (
          <Pressable
            key={s.id}
            onPress={() => setPicked((p) => (on ? p.filter((x) => x !== s.id) : [...p, s.id]))}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on }}
            style={{ minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.sm, borderRadius: radius.md, backgroundColor: on ? colors.primarySoft : colors.surfaceAlt }}
          >
            <Avatar name={s.full_name} url={photoUrl(s)} size={44} />
            <View style={{ flex: 1 }}>
              <Text weight="600" numberOfLines={2}>{s.full_name}</Text>
              <Text variant="small" color="textMuted">{s.document}</Text>
            </View>
            <Icon name={on ? 'checkmark-circle' : 'ellipse-outline'} color={on ? 'primary' : 'textMuted'} />
          </Pressable>
        );
      })}
    </Sheet>
  );
}

function GroupDetail({ group, onBack }) {
  const { colors } = useTheme();
  const compact = useWindowDimensions().width < 600; // teléfono
  const { toast, confirm } = useFeedback();
  const { reloadGroups, setGroupId, goTo } = useApp();
  const [version, setVersion] = useState(0);
  const members = useAsync(() => api.students.list(group.id), [group.id, version]);
  const [editGroup, setEditGroup] = useState(false);
  const [adding, setAdding] = useState(false);
  const [creating, setCreating] = useState(false);
  const [photoOf, setPhotoOf] = useState(null);

  const refresh = () => { setVersion((v) => v + 1); reloadGroups(); };

  const removeMember = async (s) => {
    const ok = await confirm({
      title: 'Quitar del grupo', confirmLabel: 'Quitar', danger: true,
      message: `${s.full_name} saldrá de este grupo y se borrará su asistencia en él. Su registro y su foto se conservan.`,
    });
    if (!ok) return;
    try { await api.groups.removeStudent(group.id, s.id); toast('Estudiante retirado del grupo', 'success'); refresh(); } catch (e) { toast(e.message, 'error'); }
  };

  const deleteGroup = async () => {
    const ok = await confirm({
      title: 'Eliminar grupo', confirmLabel: 'Eliminar grupo', danger: true,
      message: 'Se borrarán el calendario y toda la asistencia de este grupo. Los estudiantes no se eliminan. Esta acción no se puede deshacer.',
    });
    if (!ok) return;
    try { await api.groups.remove(group.id); toast('Grupo eliminado', 'success'); await reloadGroups(); onBack(); } catch (e) { toast(e.message, 'error'); }
  };

  const list = members.data ?? [];
  return (
    <ScrollView contentContainerStyle={{ padding: space.xl, paddingBottom: 80, gap: space.lg }}>
      {compact ? (
        // Teléfono: acciones arriba y el nombre del grupo con todo el ancho
        <View style={{ gap: space.md }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <IconButton icon="chevron-back" label="Volver a grupos" filled onPress={onBack} />
            <View style={{ flex: 1 }} />
            <Button label="Editar" icon="create" variant="secondary" onPress={() => setEditGroup(true)} />
            <IconButton icon="trash" label="Eliminar grupo" tone="danger" filled onPress={deleteGroup} />
          </View>
          <Text variant="title" accessibilityRole="header">{group.label}</Text>
        </View>
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <IconButton icon="chevron-back" label="Volver a grupos" filled onPress={onBack} />
          <Text variant="title" style={{ flex: 1 }} accessibilityRole="header">{group.label}</Text>
          <Button label="Editar" icon="create" variant="secondary" onPress={() => setEditGroup(true)} />
          <IconButton icon="trash" label="Eliminar grupo" tone="danger" filled onPress={deleteGroup} />
        </View>
      )}

      <Card style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, flexWrap: 'wrap' }}>
        <Icon name="calendar" size={26} color="primary" />
        <View style={{ flex: 1, minWidth: 200 }}>
          <Text weight="600">Calendario de clases</Text>
          <Text color="textMuted">{group.session_count ? `${group.session_count} clases programadas` : 'Aún no hay fechas de clase'}</Text>
        </View>
        <Button label={group.session_count ? 'Ver calendario' : 'Configurar fechas'} variant="soft" style={compact ? { flexBasis: '100%' } : null} onPress={() => { setGroupId(group.id); goTo('schedule'); }} />
      </Card>

      {compact ? (
        // Teléfono: título en su línea y botones apilados con todo el ancho
        <View style={{ gap: space.sm }}>
          <Text variant="heading">Estudiantes ({list.length})</Text>
          <Button label="Registrar nuevo" icon="person-add" onPress={() => setCreating(true)} />
          <Button label="Agregar existentes" icon="people" variant="secondary" onPress={() => setAdding(true)} />
        </View>
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, flexWrap: 'wrap' }}>
          <Text variant="heading" style={{ flex: 1 }}>Estudiantes ({list.length})</Text>
          <Button label="Agregar existentes" icon="people" variant="secondary" onPress={() => setAdding(true)} />
          <Button label="Registrar nuevo" icon="person-add" onPress={() => setCreating(true)} />
        </View>
      )}

      {members.error ? <ErrorState error={members.error} onRetry={members.reload} /> : members.loading && !members.data ? <SkeletonList /> : list.length === 0 ? (
        <EmptyState icon="person-add" title="Aún no hay estudiantes" message="Registre a cada estudiante con una foto de frente; no hace falta entrenar nada." />
      ) : (
        <View style={{ gap: space.sm }}>
          {list.map((s) => (
            <Card key={s.id} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md }}>
              <Pressable onPress={() => setPhotoOf(s)} accessibilityRole="button" accessibilityLabel={`Ver foto de ${s.full_name}`}>
                <Avatar name={s.full_name} url={photoUrl(s)} size={52} />
              </Pressable>
              <View style={{ flex: 1 }}>
                <Text weight="600" numberOfLines={2}>{s.full_name}</Text>
                <Text variant="small" color="textMuted">{s.document}</Text>
              </View>
              <Chip label="Ver foto" icon="image" tone="success" onPress={() => setPhotoOf(s)} />
              <IconButton icon="close-circle" label={`Quitar a ${s.full_name} del grupo`} tone="danger" onPress={() => removeMember(s)} />
            </Card>
          ))}
        </View>
      )}

      <GroupForm visible={editGroup} onClose={() => setEditGroup(false)} group={group} onSaved={refresh} />
      <AddExistingSheet visible={adding} onClose={() => setAdding(false)} group={group} memberIds={list.map((s) => s.id)} onAdded={refresh} />
      <StudentForm visible={creating} onClose={() => setCreating(false)} defaultGroupIds={[group.id]} onSaved={refresh} />
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

export default function GroupsScreen() {
  const { groups, groupsError, reloadGroups, contentWidth, setGroupId } = useApp();
  const [openId, setOpenId] = useState(null);
  const [creating, setCreating] = useState(false);

  const open = useMemo(() => (groups ?? []).find((g) => g.id === openId) ?? null, [groups, openId]);
  if (open) return <GroupDetail group={open} onBack={() => setOpenId(null)} />;

  const cols = contentWidth >= 1000 ? 3 : contentWidth >= 640 ? 2 : 1;
  const gap = space.lg;
  const cardW = (contentWidth - space.xl * 2 - gap * (cols - 1)) / cols;

  return (
    <ScrollView contentContainerStyle={{ padding: space.xl, paddingBottom: 80, gap: space.lg }}>
      <ScreenHeader
        title="Grupos"
        subtitle="Cada grupo es una asignatura con sus estudiantes y su calendario de clases."
        right={<Button label="Nuevo grupo" icon="add" size="lg" onPress={() => setCreating(true)} />}
      />
      {groupsError ? <ErrorState error={groupsError} onRetry={reloadGroups} /> : !groups ? <SkeletonList /> : groups.length === 0 ? (
        <EmptyState icon="school" title="Todavía no hay grupos" message="Cree el primero para empezar a registrar estudiantes y fechas de clase."
          action={<Button label="Crear grupo" icon="add" onPress={() => setCreating(true)} />} />
      ) : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap }}>
          {groups.map((g) => (
            <Card key={g.id} onPress={() => { setGroupId(g.id); setOpenId(g.id); }} accessibilityLabel={`Abrir ${g.label}`} style={{ width: cardW, gap: space.md }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                <Chip label={`Grupo ${g.group_number}`} tone="primary" />
                {g.term ? <Chip label={g.term} /> : null}
              </View>
              <Text variant="heading">{g.name}</Text>
              <Text color="textMuted">{g.code}</Text>
              <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' }}>
                <Chip icon="people" label={`${g.student_count} estudiantes`} tone="info" />
                <Chip icon="calendar" label={g.session_count ? `${g.session_count} clases` : 'Sin calendario'} tone={g.session_count ? 'success' : 'warning'} />
              </View>
            </Card>
          ))}
        </View>
      )}
      <GroupForm visible={creating} onClose={() => setCreating(false)} onSaved={(g) => { reloadGroups(); setGroupId(g.id); }} />
    </ScrollView>
  );
}
