import fs from 'fs';

const file = 'src/agents/background.js';
let content = fs.readFileSync(file, 'utf8');

// Ensure tokenRotation is imported
if (!content.includes('QuotaExceededError')) {
    content = content.replace(
        "import { isProjectLocked, incrementTasks, decrementTasks } from '../db/database.js';",
        "import { isProjectLocked, incrementTasks, decrementTasks } from '../db/database.js';\nimport { QuotaExceededError } from '../api/tokenRotation.js';"
    );
}

// Update startAndMonitorSession call
content = content.replace(
  /await startAndMonitorSession\(prompt, `Background Agent \$\{index\}`, project\);/,
  "await startAndMonitorSession(prompt, `Background Agent - ${index}`, project);"
);

// Update catch block
content = content.replace(
  /catch \(error\) \{[\s\S]*?console\.error\(`\[\$\{project\.id\}\] ❌ Erreur critique dans la boucle background \$\{index\} :`, error\);[\s\S]*?decrementTasks\(project\.id\);[\s\S]*?await sleep\(60000\);[\s\S]*?\}/,
  `catch (error) {
         if (error instanceof QuotaExceededError || error.name === 'QuotaExceededError') {
           console.log(\`[\${project.id}] 🛑 Quota exceeded for Background Agent - \${index}: \${error.message}. Sleeping for 12 hours.\`);
           decrementTasks(project.id);
           await sleep(12 * 60 * 60 * 1000); // Wait for 12 hours
           continue;
         }
         console.error(\`[\${project.id}] ❌ Erreur critique dans la boucle background \${index} :\`, error);
         // Assurer qu'on libère la place s'il y a eu une erreur et qu'on l'a incrémentée
         decrementTasks(project.id);
         // Attendre avant de réessayer pour éviter de spammer
         await sleep(60000);
      }`
);

fs.writeFileSync(file, content);
console.log('patched background.js');
