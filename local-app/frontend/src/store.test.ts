import { describe, it, expect, beforeEach } from 'vitest';
import { useWorkflowStore } from './store';
import type { Node } from '@xyflow/react';

describe('Workflow Store', () => {
  beforeEach(() => {
    // Reset store state before each test
    const store = useWorkflowStore.getState();
    store.setNodes([]);
    store.setEdges([]);
  });

  it('should add a node to the state', () => {
    const store = useWorkflowStore.getState();
    expect(store.nodes.length).toBe(0);

    const newNode: Node = {
      id: 'node-1',
      type: 'actionNode',
      position: { x: 0, y: 0 },
      data: { label: 'Test Node' },
    };

    store.setNodes([newNode]);

    const updatedStore = useWorkflowStore.getState();
    expect(updatedStore.nodes.length).toBe(1);
    expect(updatedStore.nodes[0].id).toBe('node-1');
  });
});
