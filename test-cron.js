import cron from 'node-cron';
const task = cron.schedule('* * * * *', () => {});
console.log(cron.getTasks ? 'has getTasks' : 'no getTasks');
if (cron.getTasks) {
    cron.getTasks().forEach(t => t.stop());
} else if (task && task.stop) {
    task.stop();
}
