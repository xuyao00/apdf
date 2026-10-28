import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

document.documentElement.dataset.platform = window.apdf?.platform || 'browser';
document.documentElement.dataset.theme = localStorage.getItem('apdf-theme') === 'dark' ? 'dark' : 'light';

if (window.apdf) createRoot(document.getElementById('root')!).render(<App />);
else createRoot(document.getElementById('root')!).render(<div className="browser-notice"><h1>aPDF is a desktop app.</h1><p>Start the native viewer with <code>npm run dev</code>.</p></div>);
