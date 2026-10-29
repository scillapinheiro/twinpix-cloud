import { HashRouter, Link, Route, Routes } from 'react-router-dom';
import { Batch } from './pages/Batch';
import { FolderPicker } from './pages/FolderPicker';
import { FolderClusters } from './pages/FolderClusters';
import { History } from './pages/History';
import { Home } from './pages/Home';
import { Review } from './pages/Review';
import { Rules } from './pages/Rules';
import { ScanProgress } from './pages/ScanProgress';

export function App() {
  return (
    <HashRouter>
      <header className="topbar">
        <Link to="/" className="brand">TwinPix Cloud</Link>
        <nav>
          <Link to="/historico">Histórico</Link>
          {' '}
          <Link to="/regras">Regras</Link>
        </nav>
      </header>
      <main className="page">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/pastas" element={<FolderPicker />} />
          <Route path="/varredura/:id" element={<ScanProgress />} />
          <Route path="/revisao/:scanId" element={<Review />} />
          <Route path="/revisao/:scanId/grupo/:groupId" element={<Review />} />
          <Route path="/lote/:scanId" element={<Batch />} />
          <Route path="/pastas-repetidas/:scanId" element={<FolderClusters />} />
          <Route path="/historico" element={<History />} />
          <Route path="/regras" element={<Rules />} />
        </Routes>
      </main>
    </HashRouter>
  );
}
