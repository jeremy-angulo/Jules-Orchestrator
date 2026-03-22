import { useEffect, useState } from 'react';
import { AgGridReact } from 'ag-grid-react';
import { X, Loader2, AlertCircle } from 'lucide-react';
import axios from 'axios';

type DataViewerModalProps = {
  isOpen: boolean;
  onClose: () => void;
  runId: string;
  nodeId: string;
};

export function DataViewerModal({ isOpen, onClose, runId, nodeId }: DataViewerModalProps) {
  const [rowData, setRowData] = useState<any[]>([]);
  const [columnDefs, setColumnDefs] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && runId && nodeId) {
      const fetchData = async () => {
        setIsLoading(true);
        setError(null);
        try {
          const response = await axios.get(`http://localhost:8000/api/data/preview?run_id=${runId}&node_id=${nodeId}`);

          // TODO: Improve error handling and fallback logic when the API response structure is unexpected
          if (response.data.data && response.data.columns) {
            setRowData(response.data.data);
            // TODO: Memoize the column definitions using `useMemo` to prevent unnecessary re-renders of the AgGrid component
            setColumnDefs(response.data.columns.map((col: string) => ({ field: col, filter: true, sortable: true, resizable: true })));
          } else {
            setError("No data returned.");
          }
        } catch (err: any) {
          setError(err.response?.data?.detail || err.message || "Failed to load data.");
        } finally {
          setIsLoading(false);
        }
      };

      fetchData();
    }
  }, [isOpen, runId, nodeId]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[100] flex items-center justify-center p-6">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl h-[80vh] border border-slate-200 overflow-hidden flex flex-col">
        <div className="bg-slate-50 p-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-slate-800 text-lg">Data Preview</h2>
            <p className="text-xs text-slate-500 font-mono">Run: {runId} | Node: {nodeId}</p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 transition-colors p-2 rounded-md hover:bg-slate-200"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 p-4 overflow-hidden relative">
          {isLoading && (
            // TODO: Replace this simple spinner with a skeleton loader component that matches the table layout
            <div className="absolute inset-0 bg-white/80 z-10 flex flex-col items-center justify-center text-blue-600 gap-2">
              <Loader2 className="animate-spin" size={32} />
              <span className="font-medium text-sm text-slate-600">Loading preview data...</span>
            </div>
          )}

          {error && (
            <div className="absolute inset-0 bg-red-50/90 z-10 flex flex-col items-center justify-center gap-2 p-6 text-center">
              <AlertCircle className="text-red-500" size={32} />
              <h3 className="font-semibold text-red-700">Failed to Load Data</h3>
              <p className="text-sm text-red-600 max-w-md">{error}</p>
              <button
                onClick={onClose}
                className="mt-4 px-4 py-2 bg-red-100 hover:bg-red-200 text-red-700 rounded-md font-medium transition-colors"
              >
                Close
              </button>
            </div>
          )}

          {!isLoading && !error && (
            <div className="ag-theme-alpine w-full h-full">
              <AgGridReact
                rowData={rowData}
                columnDefs={columnDefs}
                defaultColDef={{
                  flex: 1,
                  minWidth: 100,
                  resizable: true,
                }}
                pagination={true}
                paginationPageSize={50}
              />
            </div>
          )}
        </div>
        <div className="bg-slate-50 border-t border-slate-200 p-3 text-xs text-slate-500 flex justify-between">
          <span>Displaying up to 50 rows of intermediate data.</span>
        </div>
      </div>
    </div>
  );
}
