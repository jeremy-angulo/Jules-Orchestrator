import { GLOBAL_CONFIG } from '../src/config.js';
GLOBAL_CONFIG.JULES_MAIN_TOKEN = 'test-token';
GLOBAL_CONFIG.JULES_SECONDARY_TOKENS = [];
import test from 'node:test';
import assert from 'node:assert';
import { runSessionMonitor } from '../src/agents/sessionMonitor.js';

test('runSessionMonitor processes active sessions and handles errors', async () => {
    // Save original fetch
    const originalFetch = globalThis.fetch;
    const originalSetTimeout = global.setTimeout;

    let fetchCallCount = 0;

    // We mock fetch because julesClient uses it
    globalThis.fetch = async (url, options) => {
        fetchCallCount++;

        // Mock listSessions first page
        if (fetchCallCount === 1) {
            return {
                ok: true,
                text: async () => JSON.stringify({
                    sessions: [
                        { id: '1', name: 'sessions/1', state: 'AWAITING_PLAN_APPROVAL' },
                        { id: '2', name: 'sessions/2', state: 'AWAITING_USER_FEEDBACK' },
                        { id: '3', name: 'sessions/3', state: 'COMPLETED' },
                        { id: '4', name: 'sessions/4', state: 'IN_PROGRESS' }
                    ],
                    nextPageToken: 'page2'
                })
            };
        }

        // Mock listSessions second page
        if (fetchCallCount === 2) {
             return {
                ok: true,
                text: async () => JSON.stringify({
                    sessions: [
                        { id: '5', name: 'sessions/5', state: 'AWAITING_PLAN_APPROVAL' }
                    ]
                })
            };
        }

        // Mock approvePlan / sendMessage responses
        if (fetchCallCount === 3 || fetchCallCount === 4 || fetchCallCount === 5) {
             return { ok: true, text: async () => JSON.stringify({}) };
        }

        // Once done, trigger an error to break the loop on next iteration
        if (fetchCallCount > 5) {
             throw new Error('Break Loop');
        }

        return { ok: true, text: async () => JSON.stringify({}) };
    };

    let loopBreaks = 0;
    global.setTimeout = (cb) => {
        loopBreaks++;
        // On first sleep, execute immediately so it goes to next loop iteration
        // On second sleep, throw Error to break out of inner infinite catch sleep loop
        if (loopBreaks === 1) {
             cb();
             return {};
        }
        throw new Error('Break Loop on Sleep');
    };

    try {
        await runSessionMonitor();
    } catch(e) {
        assert.ok(e.message === 'Break Loop on Sleep');
    }

    globalThis.fetch = originalFetch;
    global.setTimeout = originalSetTimeout;

    assert.ok(fetchCallCount >= 5, 'Should have made all the list and action API calls before breaking loop');
});

test('runSessionMonitor handles list error and breaks loop', async () => {
    const originalFetch = globalThis.fetch;
    const originalSetTimeout = global.setTimeout;

    globalThis.fetch = async () => {
        // Return null/empty to simulate failure in listSessions
        return { ok: false, text: async () => 'Error API' };
    };

    global.setTimeout = (cb) => {
        // Break out of loop immediately when sleep is called
        throw new Error('Break Loop on Error Sleep');
    };

    try {
        await runSessionMonitor();
    } catch(e) {
        assert.ok(e.message === 'Break Loop on Error Sleep');
    }

    globalThis.fetch = originalFetch;
    global.setTimeout = originalSetTimeout;
});
