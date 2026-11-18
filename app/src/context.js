import { createContext, useContext } from 'react';

// Estado compartido de toda la app: conexión, grupo seleccionado y navegación.
export const AppContext = createContext(null);
export const useApp = () => useContext(AppContext);
