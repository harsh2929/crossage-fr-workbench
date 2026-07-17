import { registerRootComponent } from 'expo';
import React from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import App from './App';

// react-native-gesture-handler requires the whole app to sit under one GestureHandlerRootView. App has
// several conditional returns, so we wrap it ONCE here at the true root (createElement keeps this a
// plain .ts entry — no JSX). Every gesture (markup, pinch-zoom, slide-select, pan) descends from here.
function Root() {
  return React.createElement(GestureHandlerRootView, { style: { flex: 1 } }, React.createElement(App));
}

// registerRootComponent calls AppRegistry.registerComponent('main', () => Root);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately.
registerRootComponent(Root);
