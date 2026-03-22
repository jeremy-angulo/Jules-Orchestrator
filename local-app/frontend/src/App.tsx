import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ReactFlow,
  MiniMap,
  Controls,
  Background,
  BackgroundVariant,
  useReactFlow,
  ReactFlowProvider,
} from '@xyflow/react';
import type { Edge, Node } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useWorkflowStore } from './store';
import { InputNode } from './components/nodes/InputNode';
import { ActionNode } from './components/nodes/ActionNode';
import { Play, Save, Terminal, Activity, FileSpreadsheet, ListTree, Bot, Plus, Settings } from 'lucide-react';
import axios from 'axios';
import { SettingsModal } from './components/SettingsModal';
import { DataViewerModal } from './components/DataViewerModal';
import { v4 as uuidv4 } from 'uuid';

const nodeTypes = {
  inputNode: InputNode,
  actionNode: ActionNode,
};

const DUMMY_BLOCKS = [
  { id: '1', name: 'Scrape LinkedIn', type: 'actionNode', scriptName: 'linkedin_scraper.py' },
  { id: '2', name: 'Find Email', type: 'actionNode', scriptName: 'find_email.py' },
  { id: '3', name: 'Generate Content', type: 'actionNode', scriptName: 'ai_generator.py' },
];

function WorkflowCanvas() {
  const {
    nodes,
    edges,
    onNodesChange,
    onEdgesChange,
    onConnect,
    setNodes,
    setRunStatus,
    runStatus,
    currentCost,
    addLog,
    saveWorkflow,
    setCurrentRunId,
    currentRunId,
    setCurrentCost
  } = useWorkflowStore();

  const { screenToFlowPosition } = useReactFlow();

  const logsEndRef = useRef<HTMLDivElement>(null);

  const [dataViewerOpen, setDataViewerOpen] = useState(false);
  const [dataViewerRunId, setDataViewerRunId] = useState('');
  const [dataViewerNodeId, setDataViewerNodeId] = useState('');

  const [chunkSize, setChunkSize] = useState(10);
  const [activeTab, setActiveTab] = useState<'library' | 'ai'>('library');

  const [aiPrompt, setAiPrompt] = useState('');
  const [aiBlockName, setAiBlockName] = useState('');
  const [isGeneratingBlock, setIsGeneratingBlock] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const fetchBlocks = async () => {
    try {
      const response = await axios.get('http://localhost:8000/api/blocks');
      useWorkflowStore.getState().setBlocks(response.data);
    } catch (error) {
      console.error('Failed to fetch blocks, falling back to dummy blocks', error);
      useWorkflowStore.getState().setBlocks(DUMMY_BLOCKS);
    }
  };

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [useWorkflowStore.getState().logsText]);

  useEffect(() => {
    fetchBlocks();
  }, []);

  // Polling for run status
  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval>;

    if (runStatus === 'running' && currentRunId) {
      intervalId = setInterval(async () => {
        try {
          const response = await axios.get(`http://localhost:8000/api/runs/${currentRunId}/status`);
          const data = response.data;

          if (data.cost !== undefined) setCurrentCost(data.cost);

          let parsedLogsText = '';
          if (data.logs_text) {
            useWorkflowStore.getState().setLogsText(data.logs_text);
            parsedLogsText = data.logs_text;

            // Parse logs to find active node
            // E.g., "Executing step X (Node Y)"
            const executionMatches = [...parsedLogsText.matchAll(/Executing step \d+ \(Node (.*?)\)/g)];
            if (executionMatches.length > 0) {
              const activeNodeId = executionMatches[executionMatches.length - 1][1];

              setNodes((currentNodes: Node[]) => currentNodes.map(n => {
                if (n.type !== 'actionNode') return n;

                // If it's the currently active node
                if (n.id === activeNodeId) {
                  // Determine if failed by checking if there's a subsequent failure log for this step
                  const stepMatch = parsedLogsText.match(new RegExp(`Executing step (\\d+) \\(Node ${activeNodeId}\\)`));
                  if (stepMatch) {
                    const stepNum = stepMatch[1];
                    const hasFailed = parsedLogsText.includes(`Step ${stepNum} failed`) || parsedLogsText.includes(`Error executing step ${stepNum}`);
                    if (hasFailed) return { ...n, data: { ...n.data, status: 'error' } };

                    // If the run is completely finished and it was the last node, it might be success
                    if (data.status === 'success') return { ...n, data: { ...n.data, status: 'success' } };

                    // Otherwise it's running or success if we moved past it
                    // To see if we moved past it, check if there's an execution log for a HIGHER step number
                    const hasNextStep = parsedLogsText.includes(`Executing step ${parseInt(stepNum) + 1} (Node`);
                    if (hasNextStep) return { ...n, data: { ...n.data, status: 'success' } };

                    return { ...n, data: { ...n.data, status: 'running' } };
                  }
                  return { ...n, data: { ...n.data, status: 'running' } };
                }

                // If it was a previously executed node
                const stepMatchForN = parsedLogsText.match(new RegExp(`Executing step (\\d+) \\(Node ${n.id}\\)`));
                if (stepMatchForN) {
                    const stepNum = stepMatchForN[1];
                    const hasFailed = parsedLogsText.includes(`Step ${stepNum} failed`) || parsedLogsText.includes(`Error executing step ${stepNum}`);
                    if (hasFailed) return { ...n, data: { ...n.data, status: 'error' } };

                    return { ...n, data: { ...n.data, status: 'success' } };
                }

                return n;
              }));
            }
          }

          // Parse node metrics
          if (parsedLogsText) {
             const metricsMatches = [...parsedLogsText.matchAll(/\[METRICS\] Node (.*?) time=(.*?) cost=(.*)/g)];
             if (metricsMatches.length > 0) {
                 setNodes((currentNodes: Node[]) => currentNodes.map(n => {
                     const match = metricsMatches.find(m => m[1] === n.id);
                     if (match) {
                         return {
                             ...n,
                             data: {
                                 ...n.data,
                                 executionTime: parseFloat(match[2]),
                                 cost: parseFloat(match[3])
                             }
                         };
                     }
                     return n;
                 }));
             }
          }

          if (data.status !== 'running') {
            setRunStatus(data.status);
            if (data.status === 'success') {
              setNodes((currentNodes: Node[]) => currentNodes.map(n => n.type === 'actionNode' ? { ...n, data: { ...n.data, status: 'success' } } : n));
              addLog({ timestamp: new Date().toISOString(), message: 'Pipeline completed successfully', type: 'success' });
            } else if (data.status === 'error' || data.status === 'failed') {
               // We don't overwrite nodes that might have already been marked as error from log parsing
               setNodes((currentNodes: Node[]) => currentNodes.map(n => n.type === 'actionNode' && (n.data as any).status !== 'error' ? { ...n, data: { ...n.data, status: 'error' } } : n));
               addLog({ timestamp: new Date().toISOString(), message: 'Pipeline failed', type: 'error' });
            }
          }

        } catch (error) {
          console.error('Error polling status:', error);
          setRunStatus('error');
          addLog({ timestamp: new Date().toISOString(), message: 'Lost connection to backend during execution', type: 'error' });
        }
      }, 1000);
    }

    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [runStatus, currentRunId, setCurrentCost, setRunStatus, addLog, setNodes, nodes]);

  const handleDragStart = (e: React.DragEvent, block: any) => {
    e.dataTransfer.setData('application/reactflow', JSON.stringify(block));
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();

      const reactFlowBounds = document.querySelector('.react-flow')?.getBoundingClientRect();
      const dataStr = e.dataTransfer.getData('application/reactflow');

      if (!dataStr || !reactFlowBounds) return;

      const block = JSON.parse(dataStr);

      const position = screenToFlowPosition({
        x: e.clientX,
        y: e.clientY,
      });

      const newNode = {
        id: uuidv4(),
        type: block.type,
        position,
        data: {
          label: block.name,
          scriptName: block.scriptName,
          status: 'idle'
        },
      };

      setNodes([...nodes, newNode]);
    },
    [nodes, setNodes, screenToFlowPosition]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const handleRunPipeline = async () => {
    try {
      setRunStatus('running');
      addLog({ timestamp: new Date().toISOString(), message: 'Starting pipeline execution...', type: 'info' });
      useWorkflowStore.getState().setLogsText('');

      setNodes(nodes.map(n => n.type === 'actionNode' ? { ...n, data: { ...n.data, status: 'idle' } } : n));

      const workflowId = 'default-workflow-id';
      await saveWorkflow(workflowId);

      const globalConfig = {
        OPENAI_API_KEY: localStorage.getItem('OPENAI_API_KEY') || '',
        ANTHROPIC_API_KEY: localStorage.getItem('ANTHROPIC_API_KEY') || '',
      };

      const payload = {
        chunk_size: chunkSize,
        global_config: globalConfig
      };

      const response = await axios.post(`http://localhost:8000/api/workflows/${workflowId}/run`, payload);
      setCurrentRunId(response.data.run_id);

    } catch (error: any) {
      console.error('Failed to run pipeline', error);
      setRunStatus('error');
      setNodes(nodes.map(n => n.type === 'actionNode' ? { ...n, data: { ...n.data, status: 'error' } } : n));
      addLog({
        timestamp: new Date().toISOString(),
        message: `Pipeline failed: ${error.message}`,
        type: 'error'
      });
    }
  };

  const handleSave = () => {
    saveWorkflow('default-workflow-id');
  };

  const handleAddInputNode = () => {
    const newNode = {
      id: uuidv4(),
      type: 'inputNode',
      position: { x: 100, y: 100 },
      data: { label: 'Upload CSV' },
    };
    setNodes([...nodes, newNode]);
  };

  const handleGenerateBlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!aiPrompt || !aiBlockName) return;

    setIsGeneratingBlock(true);
    addLog({
      timestamp: new Date().toISOString(),
      message: `Starting generation for block "${aiBlockName}"...`,
      type: 'info'
    });

    try {
      await axios.post('http://localhost:8000/api/blocks/generate', {
        name: aiBlockName,
        prompt: aiPrompt
      });

      addLog({
        timestamp: new Date().toISOString(),
        message: `Successfully generated block "${aiBlockName}".`,
        type: 'success'
      });

      setAiPrompt('');
      setAiBlockName('');
      await fetchBlocks();
      setActiveTab('library');
    } catch (error: any) {
      console.error('Failed to generate block', error);
      addLog({
        timestamp: new Date().toISOString(),
        message: `Failed to generate block: ${error.message}`,
        type: 'error'
      });
    } finally {
      setIsGeneratingBlock(false);
    }
  };

  const handleEdgeClick = useCallback((_event: React.MouseEvent, edge: Edge) => {
    if (!currentRunId) {
      alert("No active or completed run to download data from.");
      return;
    }

    const sourceNode = nodes.find(n => n.id === edge.source);
    if (!sourceNode || sourceNode.type === 'inputNode') {
      alert("This edge comes from the Input Node. No intermediate CSV generated yet.");
      return;
    }

    setDataViewerRunId(currentRunId);
    setDataViewerNodeId(sourceNode.id);
    setDataViewerOpen(true);
  }, [nodes, currentRunId]);

  const handleNodeClick = useCallback((_event: React.MouseEvent, node: Node) => {
    if (!currentRunId) return;

    if (node.type === 'actionNode' && node.data?.status === 'success') {
      setDataViewerRunId(currentRunId);
      setDataViewerNodeId(node.id);
      setDataViewerOpen(true);
    }
  }, [currentRunId]);

  return (
    <div className="flex h-screen w-full bg-slate-50 overflow-hidden font-sans">
      <DataViewerModal
        isOpen={dataViewerOpen}
        onClose={() => setDataViewerOpen(false)}
        runId={dataViewerRunId}
        nodeId={dataViewerNodeId}
      />

      {/* Sidebar - 25% */}
      <div className="w-1/4 min-w-[300px] h-full bg-slate-900 border-r border-slate-800 flex flex-col shadow-xl z-10">
        <div className="p-5 border-b border-slate-800 flex justify-between items-start">
          <div>
            <div className="flex items-center gap-2 text-blue-400 mb-1">
              <Activity className="w-6 h-6" />
              <h1 className="text-xl font-bold tracking-tight text-white">Data Studio</h1>
            </div>
            <p className="text-xs text-slate-400">B2B Extraction & Enrichment</p>
          </div>
          <button
            onClick={() => setIsSettingsOpen(true)}
            className="text-slate-400 hover:text-white transition-colors p-2 bg-slate-800 hover:bg-slate-700 rounded-md"
            title="Settings"
          >
            <Settings size={18} />
          </button>
        </div>

        {/* Blocks Library */}
        <div className="p-4 flex-1 flex flex-col overflow-hidden">
          <div className="flex border-b border-slate-800 mb-4">
            <button
              onClick={() => setActiveTab('library')}
              className={`flex-1 pb-2 text-sm font-semibold flex items-center justify-center gap-2 transition-colors ${activeTab === 'library' ? 'text-blue-400 border-b-2 border-blue-400' : 'text-slate-500 hover:text-slate-300'}`}
            >
              <ListTree size={16} />
              Block Library
            </button>
            <button
              onClick={() => setActiveTab('ai')}
              className={`flex-1 pb-2 text-sm font-semibold flex items-center justify-center gap-2 transition-colors ${activeTab === 'ai' ? 'text-blue-400 border-b-2 border-blue-400' : 'text-slate-500 hover:text-slate-300'}`}
            >
              <Bot size={16} />
              Créer un Bloc (IA)
            </button>
          </div>

          {activeTab === 'library' && (
            <div className="space-y-3 overflow-y-auto pr-2 pb-4 flex-1 custom-scrollbar">
              <div
                className="bg-green-900/20 border border-green-500/30 p-3 rounded-lg cursor-grab hover:bg-green-900/40 transition-colors flex items-center gap-3 text-green-300"
                onClick={handleAddInputNode}
              >
                <FileSpreadsheet size={18} />
                <div>
                  <div className="font-medium text-sm">Input CSV</div>
                  <div className="text-xs text-green-500/70">Click to add input node</div>
                </div>
              </div>

              {useWorkflowStore.getState().blocks.map((block) => (
                <div
                  key={block.id}
                  draggable
                  onDragStart={(e) => handleDragStart(e, block)}
                  className="bg-slate-800 border border-slate-700 p-3 rounded-lg cursor-grab hover:border-blue-500/50 hover:bg-slate-800/80 transition-all flex flex-col gap-1"
                >
                  <div className="font-medium text-sm text-slate-200">{block.name}</div>
                  <div className="text-xs text-slate-500 font-mono truncate">{block.scriptName}</div>
                </div>
              ))}
            </div>
          )}

          {activeTab === 'ai' && (
            <form onSubmit={handleGenerateBlock} className="flex flex-col gap-4 overflow-y-auto pr-2 custom-scrollbar">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Nom du bloc</label>
                <input
                  type="text"
                  value={aiBlockName}
                  onChange={(e) => setAiBlockName(e.target.value)}
                  placeholder="ex: Scrape Company Website"
                  className="w-full bg-slate-950 border border-slate-700 rounded-md p-2 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-blue-500 transition-colors"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Que doit faire ce bloc ?</label>
                <textarea
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  placeholder="Décris l'action à effectuer. L'IA générera un script Python."
                  className="w-full bg-slate-950 border border-slate-700 rounded-md p-2 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-blue-500 transition-colors min-h-[100px] resize-y"
                  required
                />
              </div>
              <button
                type="submit"
                disabled={isGeneratingBlock}
                className="bg-blue-600 hover:bg-blue-700 disabled:bg-slate-700 disabled:text-slate-400 text-white p-2 rounded-md flex items-center justify-center gap-2 text-sm font-medium transition-colors"
              >
                {isGeneratingBlock ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    L'IA code et teste le script en arrière-plan...
                  </>
                ) : (
                  <>
                    <Plus size={16} />
                    Générer le script
                  </>
                )}
              </button>
            </form>
          )}
        </div>

        {/* Logs Console */}
        <div className="h-1/3 min-h-[250px] bg-slate-950 border-t border-slate-800 flex flex-col">
          <div className="px-4 py-2 bg-slate-900 border-b border-slate-800 flex items-center justify-between text-xs font-mono text-slate-400">
            <div className="flex items-center gap-2">
              <Terminal size={14} />
              Execution Logs
            </div>
            {runStatus === 'running' && (
              <div className="flex items-center gap-2 text-yellow-500">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-yellow-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-yellow-500"></span>
                </span>
                Running
              </div>
            )}
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-2 font-mono text-[11px] custom-scrollbar whitespace-pre-wrap text-slate-300">
            {useWorkflowStore.getState().logsText || (
              <div className="text-slate-600 text-center mt-4">No logs yet. Run pipeline to see output.</div>
            )}
            <div ref={logsEndRef} />
          </div>
        </div>
      </div>

      {/* Main Canvas - 75% */}
      <div className="flex-1 relative h-full">
        <div className="absolute top-4 right-4 z-10 flex gap-3">
          <div className="bg-white px-3 py-2 rounded-md shadow-sm border border-slate-200 flex items-center gap-2 text-sm">
            <span className="text-slate-500 font-medium">Taille du lot (Chunk) :</span>
            <input
              type="number"
              min="1"
              value={chunkSize}
              onChange={(e) => setChunkSize(parseInt(e.target.value) || 1)}
              className="w-16 bg-slate-50 border border-slate-300 rounded px-2 py-1 text-slate-700 focus:outline-none focus:border-blue-500"
            />
          </div>

          <div className="bg-green-50 px-4 py-2 rounded-md shadow-sm border border-green-200 flex items-center gap-2 text-sm font-bold text-green-800">
            <span>Coût Total :</span>
            <span className="text-green-600 font-mono">${currentCost.toFixed(3)}</span>
          </div>

          <button
            onClick={handleSave}
            className="bg-white hover:bg-slate-50 text-slate-700 px-4 py-2 rounded-md shadow-sm border border-slate-200 flex items-center gap-2 text-sm font-medium transition-colors"
          >
            <Save size={16} />
            Save
          </button>

          <button
            onClick={handleRunPipeline}
            disabled={runStatus === 'running'}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white px-5 py-2 rounded-md shadow-sm flex items-center gap-2 text-sm font-medium transition-colors"
          >
            {runStatus === 'running' ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Play size={16} />
            )}
            Run Pipeline
          </button>
        </div>

        <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />

        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onEdgeClick={handleEdgeClick}
          onNodeClick={handleNodeClick}
          nodeTypes={nodeTypes}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          fitView
          className="bg-slate-50"
        >
          <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="#cbd5e1" />
          <Controls className="bg-white border-slate-200 shadow-md" />
          <MiniMap
            className="bg-white border border-slate-200 shadow-md rounded-lg overflow-hidden"
            maskColor="rgba(241, 245, 249, 0.7)"
            nodeColor={(n) => {
              if (n.type === 'inputNode') return '#22c55e';
              return '#3b82f6';
            }}
          />
        </ReactFlow>
      </div>
    </div>
  );
}

// Separate component for the loader to ensure it's available
const Loader2 = ({ className, size }: { className?: string, size?: number }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size || 24}
    height={size || 24}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
  </svg>
);

function App() {
  return (
    <ReactFlowProvider>
      <WorkflowCanvas />
    </ReactFlowProvider>
  );
}

export default App;
