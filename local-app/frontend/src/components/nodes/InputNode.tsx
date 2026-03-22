import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import { Upload } from 'lucide-react';
import { useState } from 'react';

export function InputNode({ data }: NodeProps) {
  const [fileName, setFileName] = useState<string | null>(data.fileName as string || null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setFileName(file.name);
      if (typeof data.onFileSelect === 'function') {
        data.onFileSelect(file);
      }
    }
  };

  return (
    <div className="bg-green-100 border-2 border-green-500 rounded-lg p-4 shadow-sm min-w-[200px] flex flex-col items-center justify-center">
      <div className="font-semibold text-green-900 mb-2 flex items-center gap-2">
        <Upload size={16} />
        {data.label ? String(data.label) : 'Input CSV'}
      </div>

      <div className="mt-2 text-sm text-green-800 bg-white/50 px-3 py-2 rounded border border-green-300 w-full text-center relative overflow-hidden group">
        {fileName ? (
          <span className="truncate block" title={fileName}>{fileName}</span>
        ) : (
          <span className="text-green-600/70">Select File</span>
        )}
        <input
          type="file"
          accept=".csv"
          onChange={handleFileChange}
          className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
        />
      </div>

      <Handle
        type="source"
        position={Position.Right}
        className="w-3 h-3 bg-green-600 border-2 border-white"
      />
    </div>
  );
}
