import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sleep, sleepInterruptible } from '../../src/utils/helpers.js';

describe('helpers.js - sleep and sleepInterruptible tests', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe('sleep', () => {
        it('should resolve after the specified delay', async () => {
            const promise = sleep(500);

            // Fast-forward time
            vi.advanceTimersByTime(500);

            await expect(promise).resolves.toBeUndefined();
        });
    });

    describe('sleepInterruptible', () => {
        it('should return true and wait the full duration when not interrupted', async () => {
            const shouldStop = vi.fn().mockReturnValue(false);
            const promise = sleepInterruptible(1000, shouldStop, 200);

            // Let's advance slice by slice
            for (let i = 0; i < 5; i++) {
                await vi.advanceTimersByTimeAsync(200);
            }

            const result = await promise;
            expect(result).toBe(true);
            expect(shouldStop).toHaveBeenCalled();
        });

        it('should return false and abort early when shouldStop returns true', async () => {
            let callCount = 0;
            const shouldStop = vi.fn().mockImplementation(() => {
                callCount++;
                return callCount >= 3; // Stop on the 3rd check
            });

            const promise = sleepInterruptible(1000, shouldStop, 200);

            // Advance time in slices
            await vi.advanceTimersByTimeAsync(200); // call 1: shouldStop -> false, waits 200
            await vi.advanceTimersByTimeAsync(200); // call 2: shouldStop -> false, waits 200
            await vi.advanceTimersByTimeAsync(200); // call 3: shouldStop -> true, aborts early!

            const result = await promise;
            expect(result).toBe(false);
            expect(shouldStop).toHaveBeenCalledTimes(3);
        });

        it('should handle zero or negative duration gracefully and return true immediately', async () => {
            const shouldStop = vi.fn().mockReturnValue(false);

            const promiseZero = sleepInterruptible(0, shouldStop);
            const promiseNeg = sleepInterruptible(-500, shouldStop);

            expect(await promiseZero).toBe(true);
            expect(await promiseNeg).toBe(true);
            expect(shouldStop).not.toHaveBeenCalled();
        });

        it('should enforce a minimum sliceMs of 100 when a smaller slice is provided', async () => {
            const shouldStop = vi.fn().mockReturnValue(false);
            const promise = sleepInterruptible(500, shouldStop, 50); // 50 < 100 limit

            // Because slice is clamped to 100, we expect 5 checks of 100ms
            for (let i = 0; i < 5; i++) {
                await vi.advanceTimersByTimeAsync(100);
            }

            const result = await promise;
            expect(result).toBe(true);
            expect(shouldStop).toHaveBeenCalledTimes(5);
        });

        it('should fallback to 1000ms if sliceMs is not a finite number', async () => {
            const shouldStop = vi.fn().mockReturnValue(false);
            const promise = sleepInterruptible(2000, shouldStop, 'invalid_slice'); // not finite

            // Clamp defaults to 1000ms. We expect 2 checks of 1000ms.
            await vi.advanceTimersByTimeAsync(1000);
            await vi.advanceTimersByTimeAsync(1000);

            const result = await promise;
            expect(result).toBe(true);
            expect(shouldStop).toHaveBeenCalledTimes(2);
        });

        it('should handle falsy/undefined shouldStop parameter gracefully', async () => {
            const promise = sleepInterruptible(500, null, 100);

            for (let i = 0; i < 5; i++) {
                await vi.advanceTimersByTimeAsync(100);
            }

            const result = await promise;
            expect(result).toBe(true);
        });
    });
});
