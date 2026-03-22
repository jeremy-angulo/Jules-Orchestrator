import { PrismaClient } from '../../src/generated/prisma/index.js';
import DashboardClient from './DashboardClient';

const prisma = new PrismaClient();

export default async function DashboardPage() {
  const leads = await prisma.lead.findMany({
    include: {
      traces: true,
    },
    orderBy: {
      intent_score: 'desc',
    },
  });

  return (
    <div className="min-h-screen bg-slate-50 p-8 font-sans">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">Leads Intelligence</h1>
          <p className="text-slate-500 mt-2">Pilotage des leads qualifiés et des raisonnements de l'agent AI.</p>
        </div>

        <DashboardClient initialLeads={leads} />
      </div>
    </div>
  );
}
