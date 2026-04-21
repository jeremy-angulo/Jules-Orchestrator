export const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export async function sleepInterruptible(ms, shouldStop, sliceMs = 1000) {
	const safeSlice = Math.max(100, Number.isFinite(sliceMs) ? sliceMs : 1000);
	let remaining = Math.max(0, ms);
	while (remaining > 0) {
		if (shouldStop && shouldStop()) {
			return false;
		}
		const waitMs = Math.min(remaining, safeSlice);
		await sleep(waitMs);
		remaining -= waitMs;
	}
	return true;
}
