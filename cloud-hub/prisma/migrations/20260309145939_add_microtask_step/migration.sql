/*
  Warnings:

  - Added the required column `step` to the `MicroTask` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_MicroTask" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "step" TEXT NOT NULL,
    "status" TEXT NOT NULL
);
INSERT INTO "new_MicroTask" ("id", "status") SELECT "id", "status" FROM "MicroTask";
DROP TABLE "MicroTask";
ALTER TABLE "new_MicroTask" RENAME TO "MicroTask";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
