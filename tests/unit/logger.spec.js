import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { log, setControlCenterForLogger } from '../../src/utils/logger.js';

describe('logger.js', () => {
    let logSpy;
    let errorSpy;

    beforeEach(() => {
        logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        setControlCenterForLogger(null);
    });

    afterEach(() => {
        logSpy.mockRestore();
        errorSpy.mockRestore();
    });

    it('should log to console.log by default for info level', () => {
        log('info', 'test message', { foo: 'bar' });
        expect(logSpy).toHaveBeenCalledWith('[INFO] test message', { foo: 'bar' });
    });

    it('should log to console.error for error level', () => {
        log('error', 'error message');
        expect(errorSpy).toHaveBeenCalledWith('[ERROR] error message', {});
    });

    it('should use control center if provided', () => {
        const mockCC = {
            log: vi.fn()
        };
        setControlCenterForLogger(mockCC);
        log('info', 'cc message', { cc: true });

        expect(mockCC.log).toHaveBeenCalledWith('info', 'cc message', { cc: true });
        expect(logSpy).not.toHaveBeenCalled();
    });

    it('should fallback to console if control center does not have log function', () => {
        setControlCenterForLogger({});
        log('info', 'fallback message');
        expect(logSpy).toHaveBeenCalledWith('[INFO] fallback message', {});
    });
});
