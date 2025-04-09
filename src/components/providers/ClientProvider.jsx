"use client";

import React, { createContext, useState, useContext } from 'react';

// Create a global context for app state
export const AppContext = createContext(null);

// Provider component that wraps our app and makes context available
export function ClientProvider({ children }) {
  // Define your global state here
  const [appState, setAppState] = useState({
    darkMode: false,
    sidebarExpanded: true,
    currentUser: null,
    isLoading: false,
    toasts: []
  });

  // Create actions to update state
  const updateAppState = (newState) => {
    setAppState(prev => ({ ...prev, ...newState }));
  };

  // Value to be provided by the context
  const contextValue = {
    ...appState,
    updateAppState,
    toggleDarkMode: () => updateAppState({ darkMode: !appState.darkMode }),
    toggleSidebar: () => updateAppState({ sidebarExpanded: !appState.sidebarExpanded }),
    setLoading: (isLoading) => updateAppState({ isLoading }),
    addToast: (toast) => {
      const id = Date.now();
      updateAppState({
        toasts: [...appState.toasts, { id, ...toast }]
      });
      return id;
    },
    removeToast: (id) => {
      updateAppState({
        toasts: appState.toasts.filter(toast => toast.id !== id)
      });
    }
  };
  
  return (
    <AppContext.Provider value={contextValue}>
      {children}
    </AppContext.Provider>
  );
}

// Custom hook to use the app context
export function useAppContext() {
  const context = useContext(AppContext);
  if (!context) {
    console.warn('useAppContext must be used within a ClientProvider');
    // Return a default context to prevent errors
    return {
      darkMode: false,
      sidebarExpanded: true,
      currentUser: null,
      isLoading: false,
      toasts: [],
      updateAppState: () => {},
      toggleDarkMode: () => {},
      toggleSidebar: () => {},
      setLoading: () => {},
      addToast: () => 0,
      removeToast: () => {}
    };
  }
  return context;
}
