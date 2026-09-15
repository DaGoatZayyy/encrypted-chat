import React from 'react';
import ReactDOM from 'react-dom/client';
import { Auth0Provider } from '@auth0/auth0-react';
import App from './App';
import RealtimeOverlay from './RealtimeOverlay';
import ReadSearchOverlay from './ReadSearchOverlay';
import GroupManagementOverlay from './GroupManagementOverlay';
import Enhancements from './Enhancements';
import './styles.css';
import './enhancements.css';
import './side-menu.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Auth0Provider
      domain={import.meta.env.VITE_AUTH0_DOMAIN}
      clientId={import.meta.env.VITE_AUTH0_CLIENT_ID}
      authorizationParams={{ redirect_uri: window.location.origin }}
      cacheLocation="memory"
    >
      <App />
      <RealtimeOverlay />
      <ReadSearchOverlay />
      <GroupManagementOverlay />
      <Enhancements />
    </Auth0Provider>
  </React.StrictMode>,
);
