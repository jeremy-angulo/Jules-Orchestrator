import { describe, it, expect, vi, beforeEach } from 'vitest';
import esmock from 'esmock';

describe('Prompts DB & Loader', () => {
    let promptsDb;
    let promptLoader;
    let mockExecute;
    let mockFs;
    let mockCache;

    beforeEach(async () => {
        mockExecute = vi.fn();
        mockCache = new Map();
        mockFs = {
            existsSync: vi.fn(),
            readFileSync: vi.fn()
        };

        // Mock database/prompts.js
        promptsDb = await esmock('../../src/db/prompts.js', {
            '../../src/db/core.js': { executeWithRetry: mockExecute },
            '../../src/db/cache.js': { projectPromptsCache: mockCache }
        });

        // Mock utils/promptLoader.js
        promptLoader = await esmock('../../src/utils/promptLoader.js', {
            'fs': mockFs,
            '../../src/db/database.js': {
                getPrompt: promptsDb.getPrompt,
                upsertPrompt: promptsDb.upsertPrompt
            }
        });
    });

    describe('src/db/prompts.js', () => {
        it('listPromptsByProject should fetch from DB and cache', async () => {
            const mockRows = [{ name: 'p1', content: 'c1' }];
            mockExecute.mockResolvedValue({ rows: mockRows });

            const result = await promptsDb.listPromptsByProject('proj1');
            expect(result).toEqual(mockRows);
            expect(mockExecute).toHaveBeenCalledWith(expect.objectContaining({
                sql: expect.stringContaining('SELECT * FROM prompts')
            }));
            expect(mockCache.get('proj1')).toEqual(mockRows);

            // Second call should use cache
            const result2 = await promptsDb.listPromptsByProject('proj1');
            expect(result2).toEqual(mockRows);
            expect(mockExecute).toHaveBeenCalledTimes(1);
        });

        it('getPrompt should find specific prompt by name', async () => {
            mockCache.set('proj1', [{ name: 'p1', content: 'c1' }, { name: 'p2', content: 'c2' }]);

            const p = await promptsDb.getPrompt('proj1', 'p2');
            expect(p).toEqual({ name: 'p2', content: 'c2' });
        });

        it('upsertPrompt should insert/update and clear cache', async () => {
            mockCache.set('proj1', [{ name: 'p1' }]);

            await promptsDb.upsertPrompt('proj1', 'p1', 'new content', { source: 'manual' });

            expect(mockExecute).toHaveBeenCalledWith(expect.objectContaining({
                sql: expect.stringContaining('INSERT INTO prompts'),
                args: expect.arrayContaining(['proj1', 'p1', 'new content', 'manual', 0])
            }));
            expect(mockCache.has('proj1')).toBe(false);
        });
    });

    describe('src/utils/promptLoader.js', () => {
        it('loadPrompt should return content from DB if available', async () => {
            mockCache.set('proj1', [{ name: 'test-prompt', content: 'db-content' }]);

            const content = await promptLoader.loadPrompt('proj1', 'test-prompt');
            expect(content).toBe('db-content');
            expect(mockFs.readFileSync).not.toHaveBeenCalled();
        });

        it('loadPrompt should load from FS and upsert if not in DB', async () => {
            mockExecute.mockResolvedValue({ rows: [] }); // DB is empty
            mockFs.existsSync.mockReturnValue(true);
            mockFs.readFileSync.mockReturnValue('fs-content');

            const content = await promptLoader.loadPrompt('proj1', 'test-prompt');
            expect(content).toBe('fs-content');
            expect(mockExecute).toHaveBeenCalledWith(expect.objectContaining({
                sql: expect.stringContaining('INSERT INTO prompts'),
                args: expect.arrayContaining(['proj1', 'test-prompt', 'fs-content', 'markdown', 1])
            }));
        });

        it('loadPrompt should return empty string if not found anywhere', async () => {
            mockExecute.mockResolvedValue({ rows: [] });
            mockFs.existsSync.mockReturnValue(false);

            const content = await promptLoader.loadPrompt('proj1', 'missing');
            expect(content).toBe('');
        });

        it('savePrompt should call upsertPrompt', async () => {
            await promptLoader.savePrompt('proj1', 'p1', 'contentX');
            expect(mockExecute).toHaveBeenCalledWith(expect.objectContaining({
                args: expect.arrayContaining(['proj1', 'p1', 'contentX', 'manual', 0])
            }));
        });
    });
});
