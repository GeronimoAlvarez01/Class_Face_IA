import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, BackHandler, View, useWindowDimensions } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { api, getApiConfig, loadSettings, saveSettings } from './src/api';
import { AppContext } from './src/context';
import { ThemeProvider, useTheme } from './src/theme';
import { FeedbackProvider } from './src/ui';
import { AppShell, RAIL_WIDTH } from './src/components/AppShell';
import AttendanceScreen from './src/screens/AttendanceScreen';
import GroupsScreen from './src/screens/GroupsScreen';
import StudentsScreen from './src/screens/StudentsScreen';
import ScheduleScreen from './src/screens/ScheduleScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import ScanScreen from './src/screens/ScanScreen';
import LabScreen from './src/screens/LabScreen';

const SCREENS = {
  attendance: AttendanceScreen,
  groups: GroupsScreen,
  students: StudentsScreen,
  schedule: ScheduleScreen,
  lab: LabScreen,
  settings: SettingsScreen,
};

function Root() {
  const { colors, dark } = useTheme();
  const { width } = useWindowDimensions();

  const [booted, setBooted] = useState(false);
  const [route, setRoute] = useState('attendance');
  const [scanGroupId, setScanGroupId] = useState(null); // si hay valor, se muestra el escáner a pantalla completa
  const [refreshKey, setRefreshKey] = useState(0);
  const [health, setHealth] = useState(null);
  const [healthError, setHealthError] = useState(null);
  const [groups, setGroups] = useState(null);
  const [groupsError, setGroupsError] = useState(null);
  const [groupId, setGroupId] = useState(null);

  const reloadGroups = useCallback(async () => {
    try {
      const list = await api.groups.list();
      setGroups(list);
      setGroupsError(null);
      setGroupId((cur) => (list.some((g) => g.id === cur) ? cur : list[0]?.id ?? null));
      return null;
    } catch (e) {
      setGroupsError(e);
      return e;
    }
  }, []);

  const connect = useCallback(async () => {
    try {
      setHealth(await api.health());
      setHealthError(null);
      const groupsErr = await reloadGroups();
      if (groupsErr) return groupsErr.status === 401 ? 'auth' : false; // el servidor responde, pero la clave no sirve
      return true;
    } catch (e) {
      setHealth(null);
      setHealthError(e);
      setGroupsError(e);
      return false;
    }
  }, [reloadGroups]);

  const applySettings = useCallback(async (s) => {
    await saveSettings(s);
    return connect();
  }, [connect]);

  useEffect(() => {
    (async () => {
      const cfg = await loadSettings();
      if (!cfg.baseUrl) setRoute('settings'); // primera vez en la tablet: pedir la dirección del servidor
      else await connect();
      setBooted(true);
    })();
  }, [connect]);

  // Botón "atrás" de Android: cierra el escáner, o vuelve a Asistencia, y solo entonces sale de la app
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (scanGroupId) { setScanGroupId(null); setRefreshKey((k) => k + 1); return true; }
      if (route !== 'attendance') { setRoute('attendance'); return true; }
      return false;
    });
    return () => sub.remove();
  }, [scanGroupId, route]);

  const value = useMemo(() => ({
    health, groups, groupsError, reloadGroups, groupId, setGroupId, refreshKey, applySettings,
    goTo: setRoute,
    startScan: (id) => setScanGroupId(id),
    contentWidth: width >= 720 ? width - RAIL_WIDTH : width,
  }), [health, groups, groupsError, reloadGroups, groupId, refreshKey, applySettings, width]);

  if (!booted) {
    return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}><ActivityIndicator size="large" /></View>;
  }

  const Screen = SCREENS[route];
  return (
    <AppContext.Provider value={value}>
      <StatusBar style={dark ? 'light' : 'dark'} />
      {scanGroupId ? (
        <ScanScreen groupId={scanGroupId} onClose={() => { setScanGroupId(null); setRefreshKey((k) => k + 1); }} />
      ) : (
        <AppShell route={route} onNavigate={setRoute} labEnabled={health?.demo_trace === true} connectionError={healthError && getApiConfig().baseUrl ? healthError : null}>
          <Screen />
        </AppShell>
      )}
    </AppContext.Provider>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <FeedbackProvider>
          <Root />
        </FeedbackProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
