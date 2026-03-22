import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import { Loader2, CheckCircle2, AlertCircle, Play, Settings2 } from 'lucide-react';
import { twMerge } from 'tailwind-merge';

export type NodeStatus = 'idle' | 'running' | 'success' | 'error';

export function ActionNode({ data }: NodeProps) {
  const status = (data.status as NodeStatus) || 'idle';

  const StatusIcon = () => {
    switch (status) {
      case 'running': return <Loader2 size={16} className="text-yellow-500 animate-spin" />;
      case 'success': return <CheckCircle2 size={16} className="text-green-500" />;
      case 'error': return <AlertCircle size={16} className="text-red-500" />;
      default: return <Play size={16} className="text-slate-400" />;
    }
  };

  const statusColors = {
    idle: 'bg-slate-800 border-slate-600',
    running: 'bg-slate-800 border-yellow-500 shadow-[0_0_15px_rgba(234,179,8,0.3)]',
    success: 'bg-slate-800 border-green-500',
    error: 'bg-slate-800 border-red-500'
  };

  return (
    <div className={twMerge(
      "rounded-lg p-4 min-w-[200px] border-2 transition-all duration-300",
      statusColors[status]
    )}>
      <Handle
        type="target"
        position={Position.Left}
        className="w-3 h-3 bg-blue-500 border-2 border-slate-900"
      />

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 font-medium text-slate-100">
            <Settings2 size={16} className="text-blue-400" />
            {data.label ? String(data.label) : 'Action Script'}
          </div>
          <StatusIcon />
        </div>

        {data.scriptName ? (
          <div className="text-xs text-slate-400 font-mono bg-slate-900/50 p-1.5 rounded truncate border border-slate-700/50">
            {String(data.scriptName)}
          </div>
        ) : null}

        {(data.executionTime !== undefined || data.cost !== undefined) && status === 'success' ? (
          <div className="flex items-center justify-between text-xs mt-1 border-t border-slate-700/50 pt-2">
            {data.executionTime !== undefined && (
              <div className="text-slate-300 flex items-center gap-1">
                ⏱️ {Number(data.executionTime).toFixed(1)}s
              </div>
            )}
            {data.cost !== undefined && (
              <div className="text-green-400 flex items-center gap-1">
                💰 ${Number(data.cost).toFixed(3)}
              </div>
            )}
          </div>
        ) : null}
      </div>

      <Handle
        type="source"
        position={Position.Right}
        className="w-3 h-3 bg-blue-500 border-2 border-slate-900"
      />
    </div>
  );
}
