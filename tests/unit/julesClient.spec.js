import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import esmock from 'esmock';

describe('julesClient.js', () => {
    let julesClient;
    let mockHelpers;
    let mockTokenRotation;
    let mockMetricsStore;
    let mockLogger;
    let mockGithubClient;
    let mockConfig;

    beforeEach(async () => {
        vi.useFakeTimers();
        mockHelpers = {
            sleep: vi.fn(() => Promise.resolve())
        };
        mockTokenRotation = {
            getAvailableToken: vi.fn(() => Promise.resolve({ token: 'test-token', index: 0, label: 'Test Token' }))
        };
        mockMetricsStore = {
            recordApiCall: vi.fn(),
            recordServiceCheck: vi.fn(),
            recordServiceError: vi.fn()
        };
        mockLogger = {
            log: vi.fn()
        };
        mockGithubClient = {
            checkAndMergePR: vi.fn(() => Promise.resolve())
        };
        mockConfig = {
            GLOBAL_CONFIG: {
                POLLING_INTERVAL: 10
            }
        };

        julesClient = await esmock('../../src/api/julesClient.js', {
            '../../src/utils/helpers.js': mockHelpers,
            '../../src/api/tokenRotation.js': mockTokenRotation,
            '../../src/services/metricsStore.js': mockMetricsStore,
            '../../src/utils/logger.js': mockLogger,
            '../../src/api/githubClient.js': mockGithubClient,
            '../../src/config.js': mockConfig
        });

        vi.stubGlobal('fetch', vi.fn());
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    describe('julesAPI', () => {
        it('should make a successful GET request', async () => {
            vi.mocked(fetch).mockResolvedValue({
                ok: true,
                status: 200,
                text: async () => JSON.stringify({ data: 'ok' })
            });

            const result = await julesClient.julesAPI('Agent', '/test');

            expect(result).toEqual({ data: 'ok', _tokenInfo: { index: 0, label: 'Test Token' } });
            expect(fetch).toHaveBeenCalledWith(
                expect.stringContaining('/test'),
                expect.objectContaining({
                    method: 'GET',
                    headers: { 'X-Goog-Api-Key': 'test-token' }
                })
            );
            expect(mockMetricsStore.recordServiceCheck).toHaveBeenCalledWith('jules_api', true, expect.any(Object));
        });

        it('should handle POST request and record API call', async () => {
            vi.mocked(fetch).mockResolvedValue({
                ok: true,
                status: 200,
                text: async () => JSON.stringify({ success: true })
            });

            await julesClient.julesAPI('Agent', '/sessions', 'POST', { some: 'data' });

            expect(mockMetricsStore.recordApiCall).toHaveBeenCalledWith('test-token', 'Agent');
            expect(fetch).toHaveBeenCalledWith(
                expect.stringContaining('/sessions'),
                expect.objectContaining({
                    method: 'POST',
                    body: JSON.stringify({ some: 'data' })
                })
            );
        });

        it('should handle query parameters', async () => {
            vi.mocked(fetch).mockResolvedValue({
                ok: true,
                status: 200,
                text: async () => JSON.stringify({})
            });

            await julesClient.julesAPI('Agent', '/test', 'GET', null, { param1: 'val1', param2: 123 });

            const url = vi.mocked(fetch).mock.calls[0][0];
            expect(url).toContain('param1=val1');
            expect(url).toContain('param2=123');
        });

        it('should return null and record error on non-ok response', async () => {
            vi.mocked(fetch).mockResolvedValue({
                ok: false,
                status: 401,
                statusText: 'Unauthorized',
                json: async () => ({ error: 'bad' }),
                text: async () => '{"error": "bad"}'
            });

            const result = await julesClient.julesAPI('Agent', '/test');

            expect(result).toBeNull();
            expect(mockMetricsStore.recordServiceError).toHaveBeenCalledWith('jules_api', expect.stringContaining('401'), expect.any(Object));
        });

        it('should handle network errors', async () => {
            vi.mocked(fetch).mockRejectedValue(new Error('Network failure'));

            const result = await julesClient.julesAPI('Agent', '/test');

            expect(result).toBeNull();
            expect(mockMetricsStore.recordServiceError).toHaveBeenCalledWith('jules_api', 'Jules API network error', expect.any(Object));
        });
    });

    describe('Service Methods', () => {
        beforeEach(() => {
            vi.mocked(fetch).mockResolvedValue({
                ok: true,
                status: 200,
                text: async () => JSON.stringify({ success: true })
            });
        });

        it('listSources should call correct endpoint', async () => {
            await julesClient.listSources('Agent', 10, 'token', 'filter');
            expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/sources?pageSize=10&pageToken=token&filter=filter'), expect.any(Object));
        });

        it('getSource should handle ID formatting', async () => {
            await julesClient.getSource('Agent', '123');
            expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/sources/123'), expect.any(Object));

            await julesClient.getSource('Agent', 'sources/456');
            expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/sources/456'), expect.any(Object));
        });

        it('createSession should send correct body', async () => {
            await julesClient.createSession('Agent', 'prompt', 'title', 'github/repo', 'branch', 'AUTO_CREATE_PR');
            const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1].body);
            expect(body.prompt).toBe('prompt');
            expect(body.sourceContext.source).toBe('sources/github/repo');
            expect(body.automationMode).toBe('AUTO_CREATE_PR');
        });

        it('getSession should call correct endpoint', async () => {
            await julesClient.getSession('Agent', 's1');
            expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/sessions/s1'), expect.any(Object));
        });

        it('deleteSession should call DELETE', async () => {
            await julesClient.deleteSession('Agent', 's1');
            expect(vi.mocked(fetch).mock.calls[0][1].method).toBe('DELETE');
        });

        it('sendMessage should call :sendMessage', async () => {
            await julesClient.sendMessage('Agent', 's1', 'hi');
            expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/sessions/s1:sendMessage'), expect.objectContaining({
                method: 'POST',
                body: JSON.stringify({ prompt: 'hi' })
            }));
        });

        it('approvePlan should call :approvePlan', async () => {
            await julesClient.approvePlan('Agent', 's1');
            expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/sessions/s1:approvePlan'), expect.any(Object));
        });

        it('listActivities should call correct endpoint', async () => {
            await julesClient.listActivities('Agent', 's1', 50);
            expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/sessions/s1/activities?pageSize=50'), expect.any(Object));
        });

        it('getActivity should call correct endpoint', async () => {
            await julesClient.getActivity('Agent', 's1', 'a1');
            expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/sessions/s1/activities/a1'), expect.any(Object));
        });
    });

    describe('monitorExistingSession', () => {
        const mockProject = { id: 'p1', githubRepo: 'r1' };

        it('should return true if session is already COMPLETED with PR', async () => {
            vi.mocked(fetch).mockResolvedValueOnce({
                ok: true,
                text: async () => JSON.stringify({ state: 'COMPLETED', outputs: [{ pullRequest: { url: 'url' } }] })
            });

            const result = await julesClient.monitorExistingSession('s1', 'Agent', mockProject);
            expect(result).toBe(true);
        });

        it('should return false if session is already FAILED', async () => {
            vi.mocked(fetch).mockResolvedValueOnce({
                ok: true,
                text: async () => JSON.stringify({ state: 'FAILED' })
            });

            const result = await julesClient.monitorExistingSession('s1', 'Agent', mockProject);
            expect(result).toBe(false);
        });

        it('should monitor until COMPLETED', async () => {
            vi.mocked(fetch)
                .mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ state: 'RUNNING' }) }) // initial get
                .mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ state: 'RUNNING' }) }) // loop get
                .mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ state: 'COMPLETED', outputs: [{ pullRequest: { url: 'url' } }] }) }); // loop get

            const result = await julesClient.monitorExistingSession('s1', 'Agent', mockProject);
            expect(result).toBe(true);
            expect(fetch).toHaveBeenCalledTimes(3);
        });

        it('should handle AWAITING_PLAN_APPROVAL', async () => {
            vi.mocked(fetch)
                .mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ state: 'RUNNING' }) }) // initial get
                .mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ state: 'AWAITING_PLAN_APPROVAL' }) }) // loop get
                .mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({}) }) // approvePlan response
                .mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ state: 'COMPLETED', outputs: [{ pullRequest: { url: 'url' } }] }) }); // loop get

            const result = await julesClient.monitorExistingSession('s1', 'Agent', mockProject);
            expect(result).toBe(true);
            expect(fetch).toHaveBeenCalledWith(expect.stringContaining(':approvePlan'), expect.any(Object));
        });
    });

    describe('startAndMonitorSession', () => {
        const mockProject = { id: 'p1', githubRepo: 'repo1' };

        it('should return true when session completes with PR', async () => {
            vi.mocked(fetch)
                .mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ name: 'sessions/s1' }) }) // create
                .mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ state: 'RUNNING' }) })   // poll 1
                .mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ state: 'COMPLETED', outputs: [{ pullRequest: { url: 'https://github.com/org/repo/pull/123' } }] }) }); // poll 2

            const result = await julesClient.startAndMonitorSession('instr', 'Agent', mockProject);
            expect(result).toBe(true);

            // Should have scheduled auto-merge
            vi.advanceTimersByTime(60000);
            expect(mockGithubClient.checkAndMergePR).toHaveBeenCalledWith(mockProject, '123');
        });

        it('should call callbacks and skip auto-merge if onPRCreated is provided', async () => {
            const onPRCreated = vi.fn();
            const onTokenPicked = vi.fn();
            const onSessionCreated = vi.fn();

            // Mock token rotation to return a different token for this test
            mockTokenRotation.getAvailableToken.mockResolvedValueOnce({ token: 't2', index: 1, label: 'T2' });

            vi.mocked(fetch)
                .mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ name: 'sessions/s1', _tokenInfo: { index: 1, label: 'T2' } }) })
                .mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ state: 'COMPLETED', outputs: [{ pullRequest: { url: 'https://github.com/org/repo/pull/456' } }] }) });

            await julesClient.startAndMonitorSession('instr', 'Agent', mockProject, { onPRCreated, onTokenPicked, onSessionCreated });

            expect(onTokenPicked).toHaveBeenCalledWith({ index: 1, label: 'T2' });
            expect(onSessionCreated).toHaveBeenCalledWith('sessions/s1');
            expect(onPRCreated).toHaveBeenCalledWith({ prUrl: 'https://github.com/org/repo/pull/456', prNumber: '456' });

            vi.advanceTimersByTime(60000);
            expect(mockGithubClient.checkAndMergePR).not.toHaveBeenCalled();
        });

        it('should retry on session creation failure', async () => {
            vi.mocked(fetch)
                .mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'err' }) // try 1
                .mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ name: 'sessions/s1' }) }) // try 2
                .mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ state: 'COMPLETED', outputs: [{ pullRequest: { url: 'pr/123' } }] }) });

            const result = await julesClient.startAndMonitorSession('instr', 'Agent', mockProject);
            expect(result).toBe(true);
            expect(mockHelpers.sleep).toHaveBeenCalledWith(30000);
        });

        it('should return false after max retries', async () => {
            vi.mocked(fetch).mockResolvedValue({ ok: false, status: 500, text: async () => 'err' });

            const result = await julesClient.startAndMonitorSession('instr', 'Agent', mockProject);
            expect(result).toBe(false);
            expect(fetch).toHaveBeenCalledTimes(3); // MAX_RETRIES = 3
        });

        it('should handle AWAITING_USER_FEEDBACK', async () => {
            vi.mocked(fetch)
                .mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ name: 'sessions/s1' }) }) // create
                .mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ state: 'AWAITING_USER_FEEDBACK' }) }) // poll
                .mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({}) }) // sendMessage
                .mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ state: 'COMPLETED', outputs: [{ pullRequest: { url: 'pr/123' } }] }) });

            const result = await julesClient.startAndMonitorSession('instr', 'Agent', mockProject);
            expect(result).toBe(true);
            expect(fetch).toHaveBeenCalledWith(expect.stringContaining(':sendMessage'), expect.objectContaining({
                body: JSON.stringify({ prompt: 'keep going' })
            }));
        });
    });
});
