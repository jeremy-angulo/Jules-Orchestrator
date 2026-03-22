-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "entreprise" TEXT NOT NULL,
    "contact" TEXT NOT NULL,
    "intent_score" REAL NOT NULL,
    "status" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "MicroTask" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "status" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "AgentTrace" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "leadId" TEXT NOT NULL,
    "reasoning" TEXT NOT NULL,
    "data_source" TEXT NOT NULL,
    "confidence_score" REAL NOT NULL,
    CONSTRAINT "AgentTrace_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
