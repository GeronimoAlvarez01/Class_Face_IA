import React, { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { api, getApiConfig } from '../api';
import { useApp } from '../context';
import { Button, Card, Chip, Field, Icon, ScreenHeader, Text, useFeedback } from '../ui';
import { space } from '../theme';
import { longLabel } from '../lib/dates';

export default function SettingsScreen() {
  const { toast } = useFeedback();
  const { applySettings, health } = useApp();
  const initial = getApiConfig();
  const [baseUrl, setBaseUrl] = useState(initial.baseUrl);
  const [token, setToken] = useState(initial.token);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState(null);

  const test = async () => {
    setTesting(true);
    setResult(null);
    try {
      const h = await api.health({ baseUrl: baseUrl.trim().replace(/\/+$/, ''), token: token.trim() });
      setResult({ ok: true, health: h });
    } catch (e) {
      setResult({ ok: false, message: e.message });
    } finally {
      setTesting(false);
    }
  };

  const save = async () => {
    const ok = await applySettings({ baseUrl, token });
    toast(ok ? 'Conectado al servidor' : 'Guardado, pero no hay conexión con el servidor', ok ? 'success' : 'error');
  };

  const h = result?.ok ? result.health : null;
  return (
    <ScrollView contentContainerStyle={{ padding: space.xl, paddingBottom: 80, gap: space.lg, maxWidth: 760, width: '100%', alignSelf: 'center' }}>
      <ScreenHeader title="Ajustes" subtitle="Conexión con el servidor de asistencia." />

      <Card style={{ gap: space.lg }}>
        <Field
          label="Dirección del servidor"
          value={baseUrl}
          onChangeText={setBaseUrl}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          placeholder="http://192.168.1.20:3000"
          helper="La IP del computador donde corre el servidor. La tablet y el computador deben estar en la misma red Wi-Fi."
        />
        <Field label="Clave de acceso (opcional)" value={token} onChangeText={setToken} autoCapitalize="none" autoCorrect={false} secureTextEntry placeholder="ADMIN_TOKEN del servidor" />
        <View style={{ flexDirection: 'row', gap: space.md, flexWrap: 'wrap' }}>
          <Button label="Probar conexión" icon="pulse" variant="secondary" loading={testing} onPress={test} />
          <Button label="Guardar y conectar" icon="checkmark" onPress={save} />
        </View>

        {result ? (
          <View style={{ gap: space.sm }} accessibilityLiveRegion="polite">
            {result.ok ? (
              <>
                <Chip tone="success" icon="checkmark-circle" label="Conexión correcta" />
                <Text variant="small" color="textMuted">Fecha del servidor: {longLabel(h.today)}</Text>
                {h.recognition === 'mock' ? <Chip tone="warning" icon="warning" label="Reconocimiento SIMULADO (modo mock): no es el modelo real" /> : <Chip tone="info" icon="scan" label="Reconocimiento facial real activo" />}
                {h.allow_any_day ? <Chip tone="warning" icon="flask" label="Modo pruebas: permite tomar asistencia cualquier día" /> : null}
              </>
            ) : (
              <>
                <Chip tone="danger" icon="close-circle" label="No se pudo conectar" />
                <Text variant="small" color="textMuted">{result.message} Revise la IP, que el servidor esté encendido y que el puerto sea el correcto.</Text>
              </>
            )}
          </View>
        ) : health ? <Chip tone="success" icon="checkmark-circle" label="Conectado" /> : null}
      </Card>

      <Card style={{ flexDirection: 'row', gap: space.md }}>
        <Icon name="shield-checkmark" size={28} color="primary" />
        <View style={{ flex: 1, gap: 4 }}>
          <Text weight="600">Privacidad de los datos biométricos</Text>
          <Text variant="small" color="textMuted">
            La imagen del rostro es un dato sensible (Ley 1581 de 2012). Registre a un estudiante solo con su autorización, use los datos únicamente para tomar asistencia
            y elimine su registro cuando deje de ser necesario. Las fotos del escáner no se guardan: solo se usan para reconocer.
          </Text>
        </View>
      </Card>
    </ScrollView>
  );
}
