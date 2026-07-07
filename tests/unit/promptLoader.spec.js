import { describe, it, expect, vi, beforeEach } from 'vitest';
import esmock from 'esmock';

describe('promptLoader.js', () => {
    let promptLoader;
    let mockFs;
    let mockDb;

    beforeEach(async () => {
        mockFs = {
            existsSync: vi.fn(),
            readFileSync: vi.fn()
        };
        mockDb = {
            getPrompt: vi.fn(),
            upsertPrompt: vi.fn()
        };

        promptLoader = await esmock('../../src/utils/promptLoader.js', {
            'fs': mockFs,
            '../../src/db/database.js': mockDb
        });
    });

    it('loadPrompt should return content from DB if it exists', async () => {
        mockDb.getPrompt.mockResolvedValue({ content: 'db content' });

        const content = await promptLoader.loadPrompt('proj', 'name');

        expect(content).toBe('db content');
        expect(mockDb.getPrompt).toHaveBeenCalledWith('proj', 'name');
        expect(mockFs.readFileSync).not.toHaveBeenCalled();
    });

    it('loadPrompt should load from FS and upsert to DB if not in DB', async () => {
        mockDb.getPrompt.mockResolvedValue(null);
        mockFs.existsSync.mockReturnValue(true);
        mockFs.readFileSync.mockReturnValue('fs content');

        const content = await promptLoader.loadPrompt('proj', 'name');

        expect(content).toBe('fs content');
        expect(mockFs.readFileSync).toHaveBeenCalled();
        expect(mockDb.upsertPrompt).toHaveBeenCalledWith('proj', 'name', 'fs content', {
            source: 'markdown',
            isInitial: true
        });
    });

    it('loadPrompt should return empty string if not in DB and FS file missing', async () => {
        mockDb.getPrompt.mockResolvedValue(null);
        mockFs.existsSync.mockReturnValue(false);

        const content = await promptLoader.loadPrompt('proj', 'missing');

        expect(content).toBe('');
    });

    it('loadPrompt should handle FS read errors', async () => {
        mockDb.getPrompt.mockResolvedValue(null);
        mockFs.existsSync.mockReturnValue(true);
        mockFs.readFileSync.mockImplementation(() => { throw new Error('read fail'); });

        const content = await promptLoader.loadPrompt('proj', 'fail');

        expect(content).toBe('');
    });

    it('savePrompt should upsert content to DB', async () => {
        await promptLoader.savePrompt('proj', 'name', 'new content', 'manual');

        expect(mockDb.upsertPrompt).toHaveBeenCalledWith('proj', 'name', 'new content', {
            source: 'manual',
            isInitial: false
        });
    });

    it('savePrompt should handle null content', async () => {
        await promptLoader.savePrompt('proj', 'name', null);
        expect(mockDb.upsertPrompt).toHaveBeenCalledWith('proj', 'name', '', expect.anything());
    });
});
