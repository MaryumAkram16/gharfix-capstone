import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Set initial document direction based on saved language preference
const savedLanguage = localStorage.getItem('app_language') || 'english';
if (savedLanguage === 'urdu') {
  document.documentElement.dir = 'rtl';
  document.documentElement.lang = 'ur';
} else {
  document.documentElement.dir = 'ltr';
  document.documentElement.lang = 'en';
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
