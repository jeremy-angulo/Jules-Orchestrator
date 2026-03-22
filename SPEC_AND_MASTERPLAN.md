🏗️ SPECIFICATION ET MASTERPLAN : Agentic Lead Generation Builder
1. VISION GLOBALE
Ce projet est une infrastructure B2B hybride destinée à des freelances internes pour construire, exécuter et surveiller des pipelines asynchrones de prospection et d'enrichissement de données (Lead Gen).
L'architecture est Local-First : une application locale (Python/FastAPI + UI React Flow) tourne sur le PC du freelance pour exploiter sa puissance de calcul (Pandas) et son IP résidentielle, tout en se synchronisant avec un Cloud Admin Hub (Next.js) qui gère la sécurité des clés API (Vault), le contrôle budgétaire, et l'analytique.
Le workflow MVP métier cible la détection de signaux (Web/LinkedIn via Exa/Apify) et l'identification de décideurs (via People Data Labs et Fullenrich).
2. STACK TECHNIQUE STRICTE
☁️ Cloud Admin Hub (Dossier /cloud-hub)
 * Framework : Next.js 14 (App Router), Tailwind CSS, Shadcn UI, Recharts, React Hook Form + Zod, reactflow.
 * Base de données : PostgreSQL (via Prisma, utilisation massive de JSONB).
 * Authentification : NextAuth (Rôles : ADMIN, FREELANCE).
💻 Local Worker App (Dossier /local-app)
 * Backend : Python 3.10+, FastAPI, Pandas, Playwright, websockets, aiosqlite, plyer (notifications natives).
 * Frontend : React (Vite), React Router Dom, Tailwind CSS, Shadcn UI, React Flow, Zustand, AG Grid, papaparse.
 * Communication : FastAPI sert l'UI React. WebSockets/SSE pour la progression temps réel.
3. ARCHITECTURE DE LA BASE DE DONNÉES (CLOUD PRISMA)
 * User: id, email, passwordHash, role (ADMIN/FREELANCE), isActive, monthlyBudgetLimit, currentMonthSpend.
 * GlobalSettings: id, dataRetentionDays, defaultBudgetLimit.
 * ApiVault: id, providerName (OpenAI, Exa, Apify, PeopleDataLabs, Fullenrich, Firecrawl), encryptedKey, updatedAt.
 * PipelineTemplate: id, name, category, description, nodeGraphState (JSONB), createdById.
 * Project: id, name, freelancerId, totalCost, status, createdAt, updatedAt.
 * PipelineSync: id, projectId (unique), latestCsvState (JSONB), nodeGraphState (JSONB).
 * ExecutionTelemetry: id, projectId, freelancerId, blockType, actionName, status (SUCCESS/ERROR), errorCategory, errorMessage, durationMs, costAmount, rowsProcessed.
4. FONCTIONNALITÉS DÉTAILLÉES & RÈGLES MÉTIER
 * Data Model MVP : Les données circulent sous la forme de 3 entités logiques dans Pandas :
   * Entreprise (Nom, Domaine, Employés, Pays, Secteur, LinkedIn URL).
   * Signal (Nom, Valeur, Date, Preuve URL, Résumé).
   * Personne (Prénom, Nom, Titre, LinkedIn URL, Email, Téléphone).
 * Résilience & Fallback : Reprise à partir d'un bloc échoué. Logique de "Waterfall" : un bloc peut avoir une sortie "On Success" et "On Empty/Fail" pour maximiser le coverage.
 * Budget Enforcer : Rejet (HTTP 402) si dépassement de budget, et Backoff exponentiel (HTTP 429) sur le Cloud.
 * Validation & Sample Run : L'utilisateur configure la taille de l'échantillon (ex: 1 à 5). Le "Run Bulk" est verrouillé tant que l'échantillon n'est pas validé humainement.
 * Exclusion par Référence : Possibilité d'uploader un CSV maître pour exclure automatiquement les entreprises/domaines déjà traités.
5. DATA CONTRACTS (FORMATS D'ÉCHANGE ET D'EXPORT)
5.1. Workflow Export Format (.json)
Structure React Flow standard comprenant nodes et edges.
5.2. Block Execution Contract (Python)
Chaque bloc Python hérite de BaseBlock :
 * Input: df (Pandas DataFrame), config (Dict de l'UI).
 * Execution: Filtre, itère, modifie, ou crée de nouvelles colonnes. Gère les requêtes HTTP asynchrones.
 * Output: pd.DataFrame.
6. API CONTRACTS (CLOUD ENDPOINTS)
Chaque route /api/proxy/* requiert un Bearer <JWT> et implémente la vérification de budget (User.currentMonthSpend).
 * POST /api/proxy/llm : OpenAI/Anthropic proxy.
 * POST /api/proxy/exa : Appelle l'API Exa.ai pour la recherche web contextuelle.
 * POST /api/proxy/apify : Lance/récupère un Actor Apify (ex: LinkedIn Post Scraper).
 * POST /api/proxy/pdl : Appelle l'API People Data Labs (Company Enrichment & Person Search).
 * POST /api/proxy/fullenrich : Appelle l'API Fullenrich (Contact/Email/Phone enrichment).
 * POST /api/telemetry : Insère les logs de coûts et d'exécution.
 * POST /api/sync/pipeline : Reçoit les CSV massifs en "chunks" et les fusionne dans PipelineSync.
7. LE MASTERPLAN D'EXÉCUTION (AI AGENT CHECKLIST)
AI Agent: Execute sequentially. Check [x] after each sub-task. Respect [Dependency: X.X] tags strictly.
Phase 1: Cloud Hub Foundations, Auth & DB
 * [ ] 1.1 Initialize Next.js 14 project in /cloud-hub. Install Tailwind, Shadcn, Lucide, Recharts, reactflow.
 * [ ] 1.2 Setup Prisma with PostgreSQL (Schema from Section 3).
 * [ ] 1.3 Create Prisma migration and seed.ts (ADMIN user, default GlobalSettings).
 * [ ] 1.4 Setup NextAuth (CredentialsProvider, bcrypt). Include role, id, monthlyBudgetLimit in session.
 * [ ] 1.5 Create Next.js Middleware (Protect /admin and /api).
Phase 2: Admin Dashboard - Global Overview & Users
 * [ ] 2.1 Build AdminSidebar and AdminHeader.
 * [ ] 2.2 Create /admin Home Page with KPI Cards (Total Spend, Rows Processed) and Recharts AreaChart.
 * [ ] 2.3 Build /admin/freelancers Page (Shadcn DataTable, Budget Progress bar).
 * [ ] 2.4 Build "New Freelancer" Modal (react-hook-form + zod) and Server Action.
Phase 3: Admin Dashboard - Vault & Analytics
 * [ ] 3.1 Build /admin/vault Page. Form to input API keys (OpenAI, Exa, Apify, PDL, Fullenrich).
 * [ ] 3.2 Implement Node.js crypto utility. [Dependency: VAULT_ENCRYPTION_KEY] Create Actions to encrypt/decrypt keys in ApiVault.
 * [ ] 3.3 Build /admin/analytics/blocks Page (Block Efficiency Table, Error Clustering).
 * [ ] 3.4 Build /admin/settings Page.
Phase 4: Cloud API Proxy Endpoints
 * [ ] 4.1 Create POST /api/telemetry.
 * [ ] 4.2 Implement Budget Guardrail logic for all /api/proxy/* routes (Return 402 if exceeded, atomic update).
 * [ ] 4.3 Create POST /api/proxy/llm (OpenAI). [Dependency: 3.2 Vault]
 * [ ] 4.4 Create POST /api/proxy/exa (Web Search).
 * [ ] 4.5 Create POST /api/proxy/apify (LinkedIn actors).
 * [ ] 4.6 Create POST /api/proxy/pdl (Company & Person).
 * [ ] 4.7 Create POST /api/proxy/fullenrich (Contact data).
 * [ ] 4.8 Create POST /api/sync/pipeline. Implement Chunk Assembly Logic for large JSON payloads.
Phase 5: Local Worker Architecture (Python Backend)
 * [ ] 5.1 Initialize Python in /local-app/backend. requirements.txt: FastAPI, Pandas, Uvicorn, Playwright, HTTPX, aiosqlite, plyer, websockets.
 * [ ] 5.2 Setup script for playwright install chromium.
 * [ ] 5.3 Initialize SQLite asynchronously (aiosqlite). Create Auth router (/api/local/auth).
 * [ ] 5.4 Setup FastAPI WebSockets manager (PROGRESS, STATUS, LOG).
Phase 6: Local Worker UI - Workspace & Setup
 * [ ] 6.1 Initialize Vite + React + TS in /local-app/frontend. Install: Tailwind, Shadcn, reactflow, zustand, ag-grid-community, papaparse.
 * [ ] 6.2 Create Zustand stores (useProjectStore, useFlowStore).
 * [ ] 6.3 Build Workspace Layout (Canvas, Settings, Debug Terminal).
 * [ ] 6.4 Implement Prompt Playground UI in Block Settings ("Test on Row 1" via fast-track proxy call).
Phase 7: Python Engine & React Flow Validation
 * [ ] 7.1 Define BaseBlock abstract class (validate_config(), execute()). Include WS logger intercept.
 * [ ] 7.2 Build DAG Execution Manager. Implement Engine Loop (try/except, halt on FAILED, save state).
 * [ ] 7.3 Implement Checkpointing: Save Pandas DF to .parquet after every block.
 * [ ] 7.4 Create BlockNode React Flow component. Build Graph Validation logic.
 * [ ] 7.5 Implement Column Mapping UI (Dropdowns in Settings populated from previous node schema).
 * [ ] 7.6 Implement Sample Size Selector (1 to N) in the UI top bar.
Phase 8: MVP Lead Gen Blocks - Step 1 & 2 (Account & Signals)
Strategic Note: These blocks form the core of the MVP Workflow.
 * [ ] 8.1 Build ReferenceExclusionBlock (Python/React): Upload a master CSV, exclude rows from current DF based on matching domains/names.
 * [ ] 8.2 Build QueryGeneratorBlock (Python/React): Uses LLM Proxy to read user scope and generate optimized boolean queries for Exa or LinkedIn.
 * [ ] 8.3 Build ExaSearchAndExtractBlock (Python/React): Calls Exa Proxy with queries, then passes raw HTML to LLM Proxy to extract Company and Signal data.
 * [ ] 8.4 Build ApifyLinkedInScraperBlock (Python/React): Calls Apify Proxy to search LinkedIn posts, extracts context via LLM Proxy.
 * [ ] 8.5 Build PDLCompanyEnrichBlock (Python/React): Calls PDL proxy to normalize Company Name, Domain, Employees, Industry.
Phase 9: MVP Lead Gen Blocks - Step 3 (Decision Makers)
 * [ ] 9.1 Build BooleanTitleGeneratorBlock (Python/React): Takes persona text, generates boolean title string via LLM.
 * [ ] 9.2 Build PDLPeopleSearchBlock (Python/React): Uses company domains and title booleans to query PDL Proxy. Returns top N decision makers prioritized by seniority.
 * [ ] 9.3 Build FullenrichContactBlock (Python/React): Takes Person Name and Domain, calls Fullenrich Proxy to get Email/Phone.
 * [ ] 9.4 Implement Fallback / Waterfall Edges in Engine: Allow routing data to an alternative block if a block returns null or empty values.
Phase 10: Human-in-the-Loop & Safeguards
 * [ ] 10.1 Build ManualValidationBlock (Python/React): Emit 'PAUSED', full-screen AG Grid, POST to resume.
 * [ ] 10.2 Implement UI Safeguard: Lock "Run Bulk" button unless project.hasSampleRun == true.
 * [ ] 10.3 Implement Sample Run Logic: Engine runs df.head(n=sample_size) based on UI configuration.
 * [ ] 10.4 Build History Sidebar (React UI) & Rollback API (Restore .parquet).
 * [ ] 10.5 Implement Data Chunking Sync: Send final JSON to Cloud /api/sync/pipeline.
 * [ ] 10.6 Implement Native Windows Notifications (plyer) on completion.
