SPÉCIFICATION PRODUIT & ARCHITECTURE : MOTEUR D'ENRICHISSEMENT NODAL (V2.0)
Date : 2026
Cible : RevOps, Stratégistes Croissance, GTM Engineers
Concept : Un orchestrateur de données visuel (type n8n / Make), spécialisé dans la génération de leads, basé sur une exécution Python standardisée et des nœuds interchangeables.
1. Philosophie de l'Interface Utilisateur (Split-Screen & Drag-and-Drop)
Le produit abandonne l'approche "Chatbot Agentique" au profit d'un Builder Visuel déterministe.
 * Panneau Central (Canvas) : Une interface nodale où l'utilisateur glisse et dépose des "Blocs" (algorithmes/actions) et les relie entre eux pour former un pipeline d'enrichissement.
 * Barre Latérale Gauche (Historique & Logs) : Un journal d'exécution (historique des tâches) permettant de voir le statut de chaque Run, les erreurs, les temps d'exécution, et les coûts consommés en temps réel.
 * Inspecteur de Données : Le fil qui relie deux blocs représente l'état de la donnée à un instant T. L'utilisateur peut cliquer sur n'importe quel connecteur pour prévisualiser ou télécharger le CSV intermédiaire situé entre deux étapes.
2. Architecture Standardisée des Blocs (Norme Python)
Le cœur de la scalabilité du système repose sur une norme technique stricte : la "Boîte Noire Python".
 * Contrat d'Interface : Tout bloc du système, qu'il soit natif ou importé, fonctionne exclusivement selon la logique CSV Input -> Traitement -> CSV Output.
 * Standardisation CLI : Le moteur exécute les blocs de manière isolée (ex: conteneurs éphémères) via une commande universelle :
   python execute_block.py --input <path_to_input.csv> --output <path_to_output.csv> --config <json_parameters>
 * Cette norme permet une interopérabilité totale : l'orchestrateur n'a pas besoin de comprendre la logique interne du script, il ne gère que les flux de fichiers.
3. Le "Block Studio" : Création et Importation
Les utilisateurs ne sont pas limités aux algorithmes natifs. Ils peuvent enrichir leur bibliothèque de blocs de deux manières :
 * Génération par l'IA : L'utilisateur définit un site web cible et la donnée attendue en sortie. L'IA intégrée écrit le script Python (Playwright, API call, etc.) en respectant strictement la norme CSV-in/CSV-out, le teste, et l'ajoute au Canvas en tant que nouveau bloc visuel.
 * Import de Script Externe ("Bring Your Own Code") : Un ingénieur peut uploader son propre script Python. L'IA de la plateforme analyse le code, génère la description de l'outil, mappe les colonnes d'Input/Output, et encapsule le code dans le standard du système pour le rendre utilisable dans le Canvas par un non-développeur.
4. Moteur d'Exécution et Micro-Batching
Pour répondre aux contraintes des APIs (Rate Limits) et au besoin de retour visuel immédiat, le moteur propose plusieurs modes de "Run" :
 * Exécution Séquentielle (Bloc par Bloc) : Le système traite le CSV d'entrée entier (ex: 10 000 lignes) dans le Bloc 1, génère un CSV de 10 000 lignes, puis le passe au Bloc 2. Idéal pour le nettoyage de données ou la déduplication.
 * Exécution par Lot (Chunking / Ligne par Ligne) : L'utilisateur peut définir des "Chunks" (ex: 5 lignes). Le système prend les lignes 1 à 5, les fait traverser l'intégralité du pipeline (Bloc 1 -> Bloc 2 -> Bloc 3), livre les 5 premiers leads finis, puis recommence avec les 5 suivants. Cela permet d'obtenir des leads exploitables en quelques secondes, sans attendre la fin d'un Run de plusieurs heures.
 * Contrôle Manuel : Possibilité de mettre un Run en pause, d'isoler des lignes en erreur, et de relancer spécifiquement un seul bloc sur un CSV intermédiaire.
