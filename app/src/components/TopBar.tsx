import { useRef, useState } from 'react';
import './TopBar.css';
import { exportTreeAsJpg, exportTreeAsPdf, exportTreeAsDocx } from '../core/exportUtils';

interface TopBarProps {
  onFileLoad: (file: File) => void;
  onClearStructure: () => void;
  onExportJSON: () => void;
  hasData: boolean;
}

export default function TopBar({ onFileLoad, onClearStructure, onExportJSON, hasData }: TopBarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [exporting, setExporting] = useState(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onFileLoad(file);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const runExport = async (fn: () => Promise<void>) => {
    setExporting(true);
    try {
      await fn();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'No se pudo exportar el arbol.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="topbar">
      <div className="topbar-left">
        <h1 className="topbar-title">🌳 Visualizador de Estructura Taxonómica de Activos</h1>
      </div>
      <div className="topbar-actions">
        <input
          type="file"
          accept=".xlsx,.xls"
          onChange={handleFileChange}
          ref={fileInputRef}
          style={{ display: 'none' }}
          id="file-input"
        />
        <label htmlFor="file-input" className="topbar-btn primary">
          📂 Cargar Excel
        </label>
        <button className="topbar-btn danger" onClick={onClearStructure} disabled={!hasData}>
          🗑️ Borrar estructura
        </button>
        <button className="topbar-btn" onClick={onExportJSON} disabled={!hasData}>
          📥 Exportar JSON
        </button>
        <button className="topbar-btn" onClick={() => runExport(exportTreeAsJpg)} disabled={!hasData || exporting} title="Guardar el arbol como imagen JPG">
          🖼️ JPG
        </button>
        <button className="topbar-btn" onClick={() => runExport(exportTreeAsPdf)} disabled={!hasData || exporting} title="Guardar el arbol como PDF">
          📄 PDF
        </button>
        <button className="topbar-btn" onClick={() => runExport(exportTreeAsDocx)} disabled={!hasData || exporting} title="Guardar el arbol como documento Word">
          📝 Word
        </button>
      </div>
    </div>
  );
}
