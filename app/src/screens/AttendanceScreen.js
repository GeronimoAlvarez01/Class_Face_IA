import React, { useEffect, useState } from 'react';
import { ScrollView, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../api';
import { useApp } from '../context';
import {
  Button, Card, Chip, EmptyState, ErrorState, Icon, PhotoView, ProgressBar, ScreenHeader, Select, Sheet,
  SkeletonList, Text, useAsync, useFeedback,
} from '../ui';
import { AttendanceGrid } from '../components/AttendanceGrid';
import { space, useTheme } from '../theme';
import { nextSession, pickScanSession, sessionSummary, toChanges, toggle } from '../lib/grid';
import { longLabel } from '../lib/dates';
import { photoUrl } from '../api';

function Legend() {
  const { colors } = useTheme();
  const box = (bg, border, content) => (
    <View style={{ width: 20, height: 20, borderRadius: 6, backgroundColor: bg, borderWidth: 2, borderColor: border, alignItems: 'center', justifyContent: 'center' }}>{content}</View>
  );
  const item = (visual, text) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>{visual}<Text variant="small" color="textMuted">{text}</Text></View>
  );
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.lg }}>
      {item(box(colors.successStrong, colors.successStrong, <Icon name="checkmark" size={14} color="#FFFFFF" />), 'Asistió')}
      {item(box(colors.surface, colors.border), 'Sin asistencia')}
      {item(box(colors.disabled, colors.disabled), 'Clase futura o cancelada')}
      {item(<View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary }} />, 'Marcado por reconocimiento facial')}
      {item(box(colors.surface, colors.warning), 'Cambio sin guardar')}
    </View>
  );
}

export default function AttendanceScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const compact = useWindowDimensions().width < 600; // teléfono
  const { toast } = useFeedback();
  const { health, groups, groupsError, reloadGroups, groupId, setGroupId, goTo, startScan, refreshKey } = useApp();

  const grid = useAsync(() => (groupId ? api.grid.get(groupId) : Promise.resolve(null)), [groupId, refreshKey]);
  const [pending, setPending] = useState({});
  const [saving, setSaving] = useState(false);
  const [photoOf, setPhotoOf] = useState(null);

  useEffect(() => { setPending({}); }, [groupId, refreshKey]);

  const data = grid.data;
  const scan = data ? pickScanSession(data, health?.allow_any_day) : null;
  const upcoming = data ? nextSession(data) : null;
  const summary = data && scan?.session ? sessionSummary(data, scan.session.id, pending) : null;
  const pendingCount = Object.keys(pending).length;

  const save = async () => {
    setSaving(true);
    try {
      await api.grid.save(groupId, toChanges(pending));
      toast('Cambios guardados', 'success');
      setPending({});
      await grid.reload();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const groupSelect = (
    <Select
      label="Grupo"
      value={groupId}
      onChange={setGroupId}
      placeholder="Elija un grupo"
      options={(groups ?? []).map((g) => ({ value: g.id, label: g.label, sub: `${g.student_count} estudiantes` }))}
    />
  );

  let body;
  if (groupsError) body = <ErrorState error={groupsError} onRetry={reloadGroups} />;
  else if (!groups) body = <SkeletonList />;
  else if (groups.length === 0) {
    body = (
      <EmptyState
        icon="people"
        title="Cree su primer grupo"
        message="Un grupo es una asignatura con sus estudiantes. Después configure las fechas de clase y ya puede tomar asistencia."
        action={<Button label="Crear grupo" icon="add" onPress={() => goTo('groups')} />}
      />
    );
  } else if (!groupId) {
    body = <EmptyState icon="hand-left" title="Elija un grupo" message="Seleccione el grupo para ver su control de asistencia." />;
  } else if (grid.error) body = <ErrorState error={grid.error} onRetry={grid.reload} />;
  else if (grid.loading && !data) body = <SkeletonList rows={6} />;
  else if (data && data.sessions.length === 0) {
    body = (
      <EmptyState icon="calendar" title="Falta configurar el calendario" message="Defina la fecha de inicio y el número de semanas para que aparezcan las clases."
        action={<Button label="Configurar calendario" icon="calendar" onPress={() => goTo('schedule')} />} />
    );
  } else if (data && data.students.length === 0) {
    body = (
      <EmptyState icon="person-add" title="Este grupo aún no tiene estudiantes" message="Agregue estudiantes con su foto para que el sistema pueda reconocerlos."
        action={<Button label="Agregar estudiantes" icon="person-add" onPress={() => goTo('groups')} />} />
    );
  } else if (data) {
    body = (
      <>
        {scan?.session ? (
          <Card style={{ gap: space.md }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, flexWrap: 'wrap' }}>
              <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="today" color="primary" />
              </View>
              <View style={{ flex: 1, minWidth: 200 }}>
                <Text variant="heading">{scan.isToday ? 'Clase de hoy' : `Clase del ${scan.session.label}`} · Semana {scan.session.week_number}</Text>
                <Text color="textMuted">{longLabel(scan.session.date)}</Text>
              </View>
              {!scan.isToday ? <Chip tone="warning" icon="flask" label="Modo pruebas" /> : null}
              <Text variant="title">{summary.present.length}<Text variant="body" color="textMuted"> / {summary.total} presentes</Text></Text>
            </View>
            <ProgressBar value={summary.total ? summary.present.length / summary.total : 0} height={10} />
          </Card>
        ) : (
          <Card style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
            <Icon name="information-circle" color="info" size={28} />
            <View style={{ flex: 1 }}>
              <Text variant="heading">Hoy no hay clase programada</Text>
              <Text color="textMuted">{upcoming ? `La próxima clase es el ${longLabel(upcoming.date)}.` : 'No quedan clases por dictar en este calendario.'}</Text>
            </View>
          </Card>
        )}
        <Legend />
        <AttendanceGrid
          grid={data}
          pending={pending}
          onToggle={(student, session) => setPending((p) => toggle(p, student, session.id))}
          onPhoto={setPhotoOf}
        />
      </>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: space.xl, paddingBottom: 140 + insets.bottom, gap: space.lg }}>
        <ScreenHeader
          title="Control de asistencia"
          subtitle="Marque con ✓ a quienes asistieron. El reconocimiento facial lo hace por usted."
          right={(
            <Button
              label="Tomar asistencia"
              icon="camera"
              size="lg"
              disabled={!scan?.session}
              onPress={() => startScan(groupId)}
              accessibilityLabel={scan?.session ? 'Tomar asistencia con la cámara' : 'Tomar asistencia (no disponible: hoy no hay clase)'}
            />
          )}
        />
        {groupSelect}
        {body}
      </ScrollView>

      {pendingCount > 0 ? (
        <View style={{ position: 'absolute', left: space.xl, right: space.xl, bottom: space.xl + insets.bottom }}>
          <Card style={{
            flexDirection: compact ? 'column' : 'row', alignItems: compact ? 'stretch' : 'center', gap: space.md, flexWrap: compact ? 'nowrap' : 'wrap',
            borderColor: colors.warning,
            shadowColor: colors.shadow, shadowOpacity: 0.18, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 8,
          }}
          >
            {compact ? (
              // Teléfono: aviso arriba y los dos botones del mismo ancho debajo
              <>
                <View style={{ alignItems: 'flex-start' }}>
                  <Chip tone="warning" icon="create" label={`${pendingCount} ${pendingCount === 1 ? 'cambio' : 'cambios'} sin guardar`} />
                </View>
                <View style={{ flexDirection: 'row', gap: space.sm }}>
                  <Button label="Descartar" variant="secondary" disabled={saving} onPress={() => setPending({})} />
                  <Button label="Guardar cambios" icon="save" loading={saving} style={{ flex: 1 }} onPress={save} />
                </View>
              </>
            ) : (
              <>
                <Chip tone="warning" icon="create" label={`${pendingCount} ${pendingCount === 1 ? 'cambio' : 'cambios'} sin guardar`} />
                <View style={{ flex: 1 }} />
                <Button label="Descartar" variant="secondary" disabled={saving} onPress={() => setPending({})} />
                <Button label="Guardar cambios" icon="save" loading={saving} onPress={save} />
              </>
            )}
          </Card>
        </View>
      ) : null}

      <Sheet visible={!!photoOf} onClose={() => setPhotoOf(null)} title="Foto de inscripción">
        {photoOf ? (
          <View style={{ alignItems: 'center', gap: space.md }}>
            <PhotoView url={photoUrl(photoOf)} name={photoOf.full_name} />
            <Text variant="heading" style={{ textAlign: 'center' }}>{photoOf.full_name}</Text>
            <Text color="textMuted">{photoOf.document}</Text>
          </View>
        ) : null}
      </Sheet>
    </View>
  );
}
