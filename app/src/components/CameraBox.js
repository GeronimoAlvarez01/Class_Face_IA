import React, { forwardRef, useImperativeHandle, useRef } from 'react';
import { ActivityIndicator, Linking, StyleSheet, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Button, Icon, Text } from '../ui';
import { radius, space } from '../theme';

/** Óvalo guía: ayuda a centrar el rostro y a que ocupe un buen tamaño en la foto. */
export function FaceGuide({ color = 'rgba(255,255,255,0.85)' }) {
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
      <View style={{ height: '72%', aspectRatio: 0.78, borderRadius: 999, borderWidth: 3, borderColor: color, borderStyle: 'dashed' }} />
    </View>
  );
}

/**
 * Cámara con permiso incluido. Por ref expone:
 *   isReady()          -> la vista previa ya está lista
 *   capture(quality)   -> { uri, base64 }  (calidad 0.5 pesa poco y basta para detectar un rostro)
 * Funciona igual en la tablet (Android) y en el navegador de Mac/Windows con la cámara web.
 */
export const CameraBox = forwardRef(function CameraBox({ facing = 'back', overlay, style }, ref) {
  const [permission, requestPermission] = useCameraPermissions();
  const cam = useRef(null);
  const ready = useRef(false);

  useImperativeHandle(ref, () => ({
    isReady: () => ready.current && !!cam.current,
    capture: async (quality = 0.5) => {
      const photo = await cam.current.takePictureAsync({ quality, base64: true, shutterSound: false });
      return { uri: photo.uri, base64: photo.base64 };
    },
  }), []);

  const box = { backgroundColor: '#000', overflow: 'hidden', borderRadius: radius.lg };

  if (!permission) {
    return <View style={[box, { alignItems: 'center', justifyContent: 'center' }, style]}><ActivityIndicator color="#fff" /></View>;
  }

  if (!permission.granted) {
    return (
      <View style={[box, { alignItems: 'center', justifyContent: 'center', padding: space.xl, gap: space.md, backgroundColor: '#111827' }, style]}>
        <Icon name="camera" size={44} color="#FFFFFF" />
        <Text variant="heading" color="#FFFFFF" style={{ textAlign: 'center' }}>Necesitamos la cámara</Text>
        <Text color="#CBD5E1" style={{ textAlign: 'center', maxWidth: 380 }}>
          Se usa únicamente para reconocer a los estudiantes y tomar la asistencia. Las fotos no se guardan en la tablet.
        </Text>
        {permission.canAskAgain
          ? <Button label="Permitir cámara" icon="camera" onPress={requestPermission} />
          : <Button label="Abrir ajustes" icon="settings" onPress={() => Linking.openSettings()} />}
      </View>
    );
  }

  return (
    <View style={[box, style]}>
      <CameraView ref={cam} style={StyleSheet.absoluteFill} facing={facing} onCameraReady={() => { ready.current = true; }} />
      {overlay}
    </View>
  );
});
