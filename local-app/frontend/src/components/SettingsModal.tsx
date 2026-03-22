import { useState, useEffect } from 'react';
import { Settings, X, Save } from 'lucide-react';

type SettingsModalProps = {
  isOpen: boolean;
  onClose: () => void;
};

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const [openAIApiKey, setOpenAIApiKey] = useState('');
  const [anthropicApiKey, setAnthropicApiKey] = useState('');

  useEffect(() => {
    if (isOpen) {
      setOpenAIApiKey(localStorage.getItem('OPENAI_API_KEY') || '');
      setAnthropicApiKey(localStorage.getItem('ANTHROPIC_API_KEY') || '');
    }
  }, [isOpen]);

  const handleSave = () => {
    localStorage.setItem('OPENAI_API_KEY', openAIApiKey);
    localStorage.setItem('ANTHROPIC_API_KEY', anthropicApiKey);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md border border-slate-200 overflow-hidden flex flex-col">
        <div className="bg-slate-50 p-4 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2 font-semibold text-slate-800">
            <Settings className="text-blue-500" size={20} />
            Global Settings
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 transition-colors p-1 rounded-md hover:bg-slate-200"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-6 flex flex-col gap-4 flex-1 overflow-y-auto">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              OpenAI API Key
            </label>
            <input
              type="password"
              value={openAIApiKey}
              onChange={(e) => setOpenAIApiKey(e.target.value)}
              placeholder="sk-..."
              className="w-full bg-white border border-slate-300 rounded-md p-2 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Anthropic API Key
            </label>
            <input
              type="password"
              value={anthropicApiKey}
              onChange={(e) => setAnthropicApiKey(e.target.value)}
              placeholder="sk-ant-..."
              className="w-full bg-white border border-slate-300 rounded-md p-2 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
            />
          </div>
          <p className="text-xs text-slate-500 mt-2">
            Keys are stored locally in your browser's localStorage and only sent to the local backend during execution.
          </p>
        </div>

        <div className="p-4 border-t border-slate-200 bg-slate-50 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-md text-sm font-medium text-slate-600 hover:bg-slate-200 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 rounded-md text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 flex items-center gap-2 transition-colors shadow-sm"
          >
            <Save size={16} />
            Save Configuration
          </button>
        </div>
      </div>
    </div>
  );
}
