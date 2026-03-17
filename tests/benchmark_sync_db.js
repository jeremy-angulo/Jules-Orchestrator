
import { incrementTasks, decrementTasks, isProjectLocked } from '../src/db/database.js';
import { performance } from 'perf_hooks';

const PROJECT_ID = 'bench-project';
const ITERATIONS = 10000;

async function benchmarkAsync() {
    const start = performance.now();
    let lagTotal = 0;
    let lagMax = 0;

    console.log(`Starting benchmark with ${ITERATIONS} iterations...`);

    for (let i = 0; i < ITERATIONS; i++) {
        const opStart = performance.now();
        await isProjectLocked(PROJECT_ID);
        await incrementTasks(PROJECT_ID);
        await decrementTasks(PROJECT_ID);
        const opEnd = performance.now();

        const duration = opEnd - opStart;
        lagTotal += duration;
        lagMax = Math.max(lagMax, duration);
    }

    const end = performance.now();
    console.log(`Total time: ${(end - start).toFixed(2)}ms`);
    console.log(`Average op time: ${(lagTotal / ITERATIONS).toFixed(4)}ms`);
    console.log(`Max op time: ${lagMax.toFixed(4)}ms`);
}

benchmarkAsync();
