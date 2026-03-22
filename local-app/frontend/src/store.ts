import { create } from 'zustand';
import {
  addEdge,
  applyNodeChanges,
  applyEdgeChanges,
} from '@xyflow/react';
import type {
  Connection,
  Edge,
  EdgeChange,
  Node,
  NodeChange,
  OnNodesChange,
  OnEdgesChange,
  OnConnect,
} from '@xyflow/react';
import axios from 'axios';

export type RunStatus = 'idle' | 'running' | 'success' | 'error';

export type LogEntry = {
  timestamp: string;
  message: string;
  type?: 'info' | 'success' | 'error' | 'warning';
};

export type BlockDef = {
  id: string;
  name: string;
  description?: string;
  type: string;
  scriptName: string;
};

export type WorkflowState = {
  nodes: Node[];
  edges: Edge[];
  runStatus: RunStatus;
  currentCost: number;
  logs: LogEntry[];
  logsText: string;
  currentRunId: string | null;
  blocks: BlockDef[];
  onNodesChange: OnNodesChange;
  onEdgesChange: OnEdgesChange;
  onConnect: OnConnect;
  setNodes: (nodes: Node[] | ((prev: Node[]) => Node[])) => void;
  setEdges: (edges: Edge[] | ((prev: Edge[]) => Edge[])) => void;
  setRunStatus: (status: RunStatus) => void;
  setCurrentCost: (cost: number) => void;
  addLog: (log: LogEntry) => void;
  setLogsText: (text: string) => void;
  clearLogs: () => void;
  setCurrentRunId: (runId: string | null) => void;
  setBlocks: (blocks: BlockDef[]) => void;
  saveWorkflow: (id: string) => Promise<void>;
};

export const useWorkflowStore = create<WorkflowState>((set, get) => ({
  nodes: [],
  edges: [],
  runStatus: 'idle',
  currentCost: 0,
  logs: [],
  logsText: '',
  currentRunId: null,
  blocks: [],

  onNodesChange: (changes: NodeChange[]) => {
    set({
      nodes: applyNodeChanges(changes, get().nodes),
    });
  },

  onEdgesChange: (changes: EdgeChange[]) => {
    set({
      edges: applyEdgeChanges(changes, get().edges),
    });
  },

  onConnect: (connection: Connection) => {
    set({
      edges: addEdge(connection, get().edges),
    });
  },

  setNodes: (nodesOrUpdater: Node[] | ((prev: Node[]) => Node[])) => set((state) => ({
    nodes: typeof nodesOrUpdater === 'function' ? nodesOrUpdater(state.nodes) : nodesOrUpdater
  })),
  setEdges: (edgesOrUpdater: Edge[] | ((prev: Edge[]) => Edge[])) => set((state) => ({
    edges: typeof edgesOrUpdater === 'function' ? edgesOrUpdater(state.edges) : edgesOrUpdater
  })),
  setRunStatus: (runStatus: RunStatus) => set({ runStatus }),
  setCurrentCost: (currentCost: number) => set({ currentCost }),
  addLog: (log: LogEntry) => set((state) => ({ logs: [...state.logs, log] })),
  setLogsText: (text: string) => set({ logsText: text }),
  clearLogs: () => set({ logs: [], logsText: '' }),
  setCurrentRunId: (currentRunId: string | null) => set({ currentRunId }),
  setBlocks: (blocks: BlockDef[]) => set({ blocks }),

  saveWorkflow: async (id: string) => {
    try {
      const { nodes, edges } = get();
      await axios.post('http://localhost:8000/api/workflows', {
        id,
        nodes,
        edges,
      });
      get().addLog({
        timestamp: new Date().toISOString(),
        message: 'Workflow saved successfully',
        type: 'success',
      });
    } catch (error: any) {
      console.error('Failed to save workflow', error);
      get().addLog({
        timestamp: new Date().toISOString(),
        message: `Failed to save workflow: ${error.message}`,
        type: 'error',
      });
    }
  },
}));
