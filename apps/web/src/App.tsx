import { HashRouter, Link, Route, Routes } from 'react-router-dom';
import { Confirm } from './pages/Confirm';
import { FolderPicker } from './pages/FolderPicker';
import { History } from './pages/History';
import { Home } from './pages/Home';
import { Review } from './pages/Review';
import { ScanProgress } from './pages/ScanProgress';

export function App() {
  return (
    <HashRouter>
      <header className="topbar">
        <Link to="/" className="brand">TwinPix Cloud</Link>
        <nav>
          <Link to="/historico">Histórico</Link>
        </nav>
      </header>
      <main className="page">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/pastas" element={<FolderPicker />} />
          <Route path="/varredura/:id" element={<ScanProgress />} />
          <Route path="/revisao/:scanId" element={<Review />} />
          <Route path="/revisao/:scanId/grupo/:groupId" element={<Review />} />
          <Route path="/confirmar" element={<Confirm />} />
          <Route path="/historico" element={<History />} />
        </Routes>
      </main>
    </HashRouter>
  );
}
