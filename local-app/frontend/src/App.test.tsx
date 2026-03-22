import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from './App';

// Mock ResizeObserver for @xyflow/react
globalThis.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

describe('App Component', () => {
  it('renders without crashing and displays Run Pipeline button', () => {
    render(<App />);
    const runButton = screen.getByRole('button', { name: /run pipeline/i });
    expect(runButton).toBeInTheDocument();
  });
});
