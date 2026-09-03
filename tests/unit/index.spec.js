import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import esmock from 'esmock';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('src/index.js - Entry Point', () => {
  let originalEnv;
  let originalConsoleLog;
  let originalConsoleError;
  let exitSpy;

  const targetPath = resolve(__dirname, '../../src/index.js');
  const appPath = resolve(__dirname, '../../src/app.js');
  const controlCenterPath = resolve(__dirname, '../../src/controlCenter.js');
  const loggerPath = resolve(__dirname, '../../src/utils/logger.js');
  const healthMonitorPath = resolve(__dirname, '../../src/services/healthMonitor.js');
  const dbPath = resolve(__dirname, '../../src/db/database.js');

  beforeEach(() => {
    originalEnv = { ...process.env };
    originalConsoleLog = console.log;
    originalConsoleError = console.error;
    console.log = vi.fn();
    console.error = vi.fn();
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = originalEnv;
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('should run full initialization cycle successfully with default port', async () => {
    delete process.env.PORT;
    delete process.env.BOOTSTRAP_DATA;

    const mockListen = vi.fn((port, host, cb) => cb && cb());
    const mockApp = { listen: mockListen };

    const mockControlCenter = {
      init: vi.fn().mockResolvedValue(),
      startSchedulers: vi.fn().mockResolvedValue(),
      startAllAssignments: vi.fn().mockResolvedValue(),
      startAllSiteChecks: vi.fn().mockResolvedValue()
    };

    const mockSetControlCenterForLogger = vi.fn();
    const mockStartWebsiteHealthMonitor = vi.fn();

    const mockInitTables = vi.fn().mockResolvedValue();
    const mockGetAllProjectStates = vi.fn().mockResolvedValue([{ projectId: 'p1' }, { projectId: 'p2' }]);
    const mockSetActiveTasks = vi.fn().mockResolvedValue();

    await esmock(targetPath, {
      [appPath]: mockApp,
      [controlCenterPath]: { controlCenter: mockControlCenter },
      [loggerPath]: { setControlCenterForLogger: mockSetControlCenterForLogger },
      [healthMonitorPath]: { startWebsiteHealthMonitor: mockStartWebsiteHealthMonitor },
      [dbPath]: {
        initTables: mockInitTables,
        getAllProjectStates: mockGetAllProjectStates,
        setActiveTasks: mockSetActiveTasks
      }
    });

    await new Promise((r) => setTimeout(r, 50));

    expect(mockSetControlCenterForLogger).toHaveBeenCalledWith(mockControlCenter);
    expect(mockInitTables).toHaveBeenCalled();
    expect(mockListen).toHaveBeenCalledWith(3000, '0.0.0.0', expect.any(Function));
    expect(mockStartWebsiteHealthMonitor).toHaveBeenCalled();
    expect(mockControlCenter.init).toHaveBeenCalled();
    expect(mockGetAllProjectStates).toHaveBeenCalled();
    expect(mockSetActiveTasks).toHaveBeenCalledWith('p1', 0);
    expect(mockSetActiveTasks).toHaveBeenCalledWith('p2', 0);
    expect(mockControlCenter.startSchedulers).toHaveBeenCalled();
    expect(mockControlCenter.startAllAssignments).toHaveBeenCalled();
    expect(mockControlCenter.startAllSiteChecks).toHaveBeenCalled();
  });

  it('should parse and populate BOOTSTRAP_DATA when database is empty and custom PORT is provided', async () => {
    process.env.PORT = '8080';
    process.env.BOOTSTRAP_DATA = JSON.stringify({
      agents: [{ id: 'agent-1' }],
      projects: [{ id: 'proj-1' }],
      assignments: [{ id: 'ass-1' }]
    });

    const mockListen = vi.fn((port, host, cb) => cb && cb());
    const mockApp = { listen: mockListen };

    const mockControlCenter = {
      init: vi.fn().mockResolvedValue(),
      startSchedulers: vi.fn().mockResolvedValue(),
      startAllAssignments: vi.fn().mockResolvedValue(),
      startAllSiteChecks: vi.fn().mockResolvedValue()
    };

    const mockCreateAgent = vi.fn().mockResolvedValue();
    const mockUpsertProjectConfig = vi.fn().mockResolvedValue();
    const mockCreateAssignment = vi.fn().mockResolvedValue();
    const mockListAgents = vi.fn().mockResolvedValue([]);
    const mockListProjectsConfig = vi.fn().mockResolvedValue([]);

    await esmock(targetPath, {
      [appPath]: mockApp,
      [controlCenterPath]: { controlCenter: mockControlCenter },
      [loggerPath]: { setControlCenterForLogger: vi.fn() },
      [healthMonitorPath]: { startWebsiteHealthMonitor: vi.fn() },
      [dbPath]: {
        initTables: vi.fn().mockResolvedValue(),
        getAllProjectStates: vi.fn().mockResolvedValue([]),
        setActiveTasks: vi.fn().mockResolvedValue(),
        createAgent: mockCreateAgent,
        upsertProjectConfig: mockUpsertProjectConfig,
        createAssignment: mockCreateAssignment,
        listAgents: mockListAgents,
        listProjectsConfig: mockListProjectsConfig
      }
    });

    await new Promise((r) => setTimeout(r, 50));

    expect(mockListen).toHaveBeenCalledWith('8080', '0.0.0.0', expect.any(Function));
    expect(console.log).toHaveBeenCalledWith('[Bootstrap] Empty database detected. Importing data from BOOTSTRAP_DATA...');
    expect(mockListAgents).toHaveBeenCalled();
    expect(mockListProjectsConfig).toHaveBeenCalled();
    expect(mockCreateAgent).toHaveBeenCalledWith({ id: 'agent-1' });
    expect(mockUpsertProjectConfig).toHaveBeenCalledWith({ id: 'proj-1' });
    expect(mockCreateAssignment).toHaveBeenCalledWith({ id: 'ass-1' });
  });

  it('should skip BOOTSTRAP_DATA if agents or projects already exist', async () => {
    process.env.BOOTSTRAP_DATA = JSON.stringify({
      agents: [{ id: 'agent-1' }]
    });

    const mockCreateAgent = vi.fn();
    const mockListAgents = vi.fn().mockResolvedValue([{ id: 'existing-agent' }]);
    const mockListProjectsConfig = vi.fn().mockResolvedValue([]);

    await esmock(targetPath, {
      [appPath]: { listen: vi.fn((port, host, cb) => cb && cb()) },
      [controlCenterPath]: {
        controlCenter: {
          init: vi.fn().mockResolvedValue(),
          startSchedulers: vi.fn().mockResolvedValue(),
          startAllAssignments: vi.fn().mockResolvedValue(),
          startAllSiteChecks: vi.fn().mockResolvedValue()
        }
      },
      [loggerPath]: { setControlCenterForLogger: vi.fn() },
      [healthMonitorPath]: { startWebsiteHealthMonitor: vi.fn() },
      [dbPath]: {
        initTables: vi.fn().mockResolvedValue(),
        getAllProjectStates: vi.fn().mockResolvedValue([]),
        setActiveTasks: vi.fn().mockResolvedValue(),
        createAgent: mockCreateAgent,
        listAgents: mockListAgents,
        listProjectsConfig: mockListProjectsConfig
      }
    });

    await new Promise((r) => setTimeout(r, 50));

    expect(mockListAgents).toHaveBeenCalled();
    expect(mockCreateAgent).not.toHaveBeenCalled();
  });

  it('should log error if BOOTSTRAP_DATA contains invalid JSON', async () => {
    process.env.BOOTSTRAP_DATA = '{ invalid json }';

    await esmock(targetPath, {
      [appPath]: { listen: vi.fn((port, host, cb) => cb && cb()) },
      [controlCenterPath]: {
        controlCenter: {
          init: vi.fn().mockResolvedValue(),
          startSchedulers: vi.fn().mockResolvedValue(),
          startAllAssignments: vi.fn().mockResolvedValue(),
          startAllSiteChecks: vi.fn().mockResolvedValue()
        }
      },
      [loggerPath]: { setControlCenterForLogger: vi.fn() },
      [healthMonitorPath]: { startWebsiteHealthMonitor: vi.fn() },
      [dbPath]: {
        initTables: vi.fn().mockResolvedValue(),
        getAllProjectStates: vi.fn().mockResolvedValue([]),
        setActiveTasks: vi.fn().mockResolvedValue()
      }
    });

    await new Promise((r) => setTimeout(r, 50));

    expect(console.error).toHaveBeenCalledWith(
      '[Bootstrap] Failed to parse or apply BOOTSTRAP_DATA:',
      expect.any(Error)
    );
  });

  it('should handle ControlCenter init failures gracefully', async () => {
    delete process.env.BOOTSTRAP_DATA;

    const mockControlCenter = {
      init: vi.fn().mockRejectedValue(new Error('ControlCenter failure'))
    };

    await esmock(targetPath, {
      [appPath]: { listen: vi.fn((port, host, cb) => cb && cb()) },
      [controlCenterPath]: { controlCenter: mockControlCenter },
      [loggerPath]: { setControlCenterForLogger: vi.fn() },
      [healthMonitorPath]: { startWebsiteHealthMonitor: vi.fn() },
      [dbPath]: {
        initTables: vi.fn().mockResolvedValue()
      }
    });

    await new Promise((r) => setTimeout(r, 50));

    expect(console.error).toHaveBeenCalledWith(
      'Fatal error while starting ControlCenter:',
      expect.any(Error)
    );
  });

  it('should handle unhandled fatal error during main startup', async () => {
    delete process.env.BOOTSTRAP_DATA;

    await esmock(targetPath, {
      [appPath]: { listen: vi.fn() },
      [controlCenterPath]: { controlCenter: {} },
      [loggerPath]: { setControlCenterForLogger: vi.fn() },
      [healthMonitorPath]: { startWebsiteHealthMonitor: vi.fn() },
      [dbPath]: {
        initTables: vi.fn().mockRejectedValue(new Error('DB table init crash'))
      }
    });

    await new Promise((r) => setTimeout(r, 50));

    expect(console.error).toHaveBeenCalledWith(
      'Unhandled fatal error during startup:',
      expect.any(Error)
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
