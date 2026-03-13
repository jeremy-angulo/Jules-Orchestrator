<<<<<<< SEARCH
      if (state.state === 'COMPLETED') {
=======
      if (state.state === 'AWAITING_PLAN_APPROVAL') {
        console.log(`[${project.id} - ${agentName}] ⏳ Session en attente d'approbation du plan. Validation automatique...`);
        await approvePlan(agentName, sessionName);
      } else if (state.state === 'AWAITING_USER_FEEDBACK') {
        console.log(`[${project.id} - ${agentName}] 💬 Session bloquée en attente d'un retour. Injection de "keep going"...`);
        await sendMessage(agentName, sessionName, "keep going");
      } else if (state.state === 'COMPLETED') {
>>>>>>> REPLACE
