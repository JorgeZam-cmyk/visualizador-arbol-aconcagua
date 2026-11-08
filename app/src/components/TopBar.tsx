import { useRef, useState } from 'react';
import './TopBar.css';
import { exportTreeAsJpg, exportTreeAsPdf, exportTreeAsDocx } from '../core/exportUtils';

interface TopBarProps {
  onFileLoad: (file: File) => void | Promise<void>;
  onClearStructure: () => void;
  onExportJSON: () => void;
  hasData: boolean;
}

interface FileSystemFileHandleLike {
  name: string;
  getFile: () => Promise<File>;
  queryPermission?: (options?: { mode?: 'read' }) => Promise<'granted' | 'denied' | 'prompt'>;
  requestPermission?: (options?: { mode?: 'read' }) => Promise<'granted' | 'denied' | 'prompt'>;
}

type WindowWithFilePicker = Window & {
  showOpenFilePicker?: (options?: {
    multiple?: boolean;
    types?: Array<{
      description?: string;
      accept: Record<string, string[]>;
    }>;
  }) => Promise<FileSystemFileHandleLike[]>;
};

export default function TopBar({ onFileLoad, onClearStructure, onExportJSON, hasData }: TopBarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileHandleRef = useRef<FileSystemFileHandleLike | null>(null);
  const [linkedFileName, setLinkedFileName] = useState('');
  const [busy, setBusy] = useState(false);

  const loadFile = async (file: File) => {
    setBusy(true);
    try {
      await onFileLoad(file);
    } finally {
      setBusy(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      fileHandleRef.current = null;
      setLinkedFileName(file.name);
      await loadFile(file);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleChooseExcel = async () => {
    const pickerWindow = window as WindowWithFilePicker;

    // Edge/Chrome: conserva el identificador del archivo para volver a leerlo.
    if (pickerWindow.showOpenFilePicker) {
      try {
        const [handle] = await pickerWindow.showOpenFilePicker({
          multiple: false,
          types: [{
            description: 'Archivos Excel',
            accept: {
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
              'application/vnd.ms-excel': ['.xls'],
            },
          }],
        });
        if (!handle) return;
        fileHandleRef.current = handle;
        setLinkedFileName(handle.name);
        await loadFile(await handle.getFile());
        return;
      } catch (err) {
        // AbortError significa que el usuario canceló el selector.
        if (err instanceof DOMException && err.name === 'AbortError') return;
        console.error('No se pudo abrir Excel con acceso directo:', err);
        alert('No fue posible vincular el Excel. Se abrirá el selector tradicional.');
      }
    }

    // Alternativa para navegadores o políticas que no permiten File System Access.
    fileInputRef.current?.click();
  };

  const handleRefreshExcel = async () => {
    const handle = fileHandleRef.current;
    if (!handle) {
      alert('Primero use "Cargar Excel" para vincular el archivo.');
      return;
    }

    setBusy(true);
    try {
      let permission = handle.queryPermission
        ? await handle.queryPermission({ mode: 'read' })
        : 'granted';

      if (permission !== 'granted' && handle.requestPermission) {
        permission = await handle.requestPermission({ mode: 'read' });
      }
      if (permission !== 'granted') {
        throw new Error('Edge no autorizó volver a leer el archivo.');
      }

      // Excel debe estar guardado con Ctrl+S. getFile() obtiene la versión más reciente.
      const latestFile = await handle.getFile();
      await onFileLoad(latestFile);
    } catch (err) {
      console.error('No se pudo actualizar el Excel:', err);
      alert(
        'No se pudo leer la última versión del Excel.\n\n' +
        '1. Guarde el libro con Ctrl+S.\n' +
        '2. Espere a que OneDrive termine de sincronizar.\n' +
        '3. Vuelva a presionar "Actualizar Excel".\n\n' +
        'Si el problema continúa, Windows o Excel mantiene el archivo bloqueado.'
      );
    } finally {
      setBusy(false);
    }
  };

  const runExport = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'No se pudo exportar el árbol.');
    } finally {
      setBusy(false);
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
        <button
          type="button"
          className="topbar-btn primary"
          onClick={handleChooseExcel}
          disabled={busy}
          title={linkedFileName ? `Archivo vinculado: ${linkedFileName}` : 'Seleccionar y vincular un Excel'}
        >
          📂 Cargar Excel
        </button>
        <button
          type="button"
          className="topbar-btn primary"
          onClick={handleRefreshExcel}
          disabled={!fileHandleRef.current || busy}
          title={linkedFileName ? `Volver a leer: ${linkedFileName}` : 'Primero cargue un Excel'}
        >
          🔄 Actualizar Excel
        </button>
        <button className="topbar-btn danger" onClick={onClearStructure} disabled={!hasData || busy}>
          🗑️ Borrar estructura
        </button>
        <button className="topbar-btn" onClick={onExportJSON} disabled={!hasData || busy}>
          📥 Exportar JSON
        </button>
        <button className="topbar-btn" onClick={() => runExport(exportTreeAsJpg)} disabled={!hasData || busy}>
          🖼️ JPG
        </button>
        <button className="topbar-btn" onClick={() => runExport(exportTreeAsPdf)} disabled={!hasData || busy}>
          📄 PDF
        </button>
        <button className="topbar-btn" onClick={() => runExport(exportTreeAsDocx)} disabled={!hasData || busy}>
          📝 Word
        </button>
      </div>
    </div>
  );
}
