import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter, Routes, Route } from 'react-router-dom';
import { Lobby } from './pages/Lobby';
import { Team } from './pages/Team';
import { Tournament } from './pages/Tournament';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <Routes>
        <Route path="/" element={<Lobby />} />
        <Route path="/tournament" element={<Tournament />} />
        <Route path="/team/:team" element={<Team />} />
      </Routes>
    </HashRouter>
  </React.StrictMode>,
);
