"use client";

import { useState } from 'react';
import AgentReasoningTrace from './AgentReasoningTrace';
import { ShieldAlert, CheckCircle2, Search, MoreHorizontal, User, Mail, Activity, Eye } from 'lucide-react';

interface Trace {
  id: string;
  leadId: string;
  reasoning: string;
  data_source: string;
  confidence_score: number;
}

interface Lead {
  id: string;
  entreprise: string;
  contact: string;
  intent_score: number;
  status: string;
  traces: Trace[];
}

export default function DashboardClient({ initialLeads }: { initialLeads: Lead[] }) {
  const [leads, setLeads] = useState<Lead[]>(initialLeads);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [searchTerm, setSearchTerm] = useState("");

  const filteredLeads = leads.filter(lead =>
    lead.entreprise.toLowerCase().includes(searchTerm.toLowerCase()) ||
    lead.contact.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const getStatusBadge = (status: string) => {
    if (status === 'qualified') return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800"><CheckCircle2 className="w-3 h-3" /> Qualified</span>;
    if (status === 'pending') return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800"><Activity className="w-3 h-3" /> Pending</span>;
    if (status === 'rejected') return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800"><ShieldAlert className="w-3 h-3" /> Rejected</span>;
    return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-800">{status}</span>;
  };

  const getScoreColor = (score: number) => {
    if (score >= 80) return "text-green-600 font-semibold";
    if (score >= 50) return "text-yellow-600 font-semibold";
    return "text-red-600 font-semibold";
  };

  return (
    <>
      {/* Search and Filters */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div className="relative w-full sm:max-w-md">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <Search className="h-4 w-4 text-slate-400" />
          </div>
          <input
            type="text"
            className="block w-full pl-10 pr-3 py-2 border border-slate-200 rounded-lg leading-5 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 sm:text-sm transition-all"
            placeholder="Rechercher une entreprise, un contact..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      {/* Main Table Card */}
      <div className="bg-white shadow-sm border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50">
              <tr>
                <th scope="col" className="px-6 py-4 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                  Entreprise
                </th>
                <th scope="col" className="px-6 py-4 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                  Contact
                </th>
                <th scope="col" className="px-6 py-4 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                  Intent Score
                </th>
                <th scope="col" className="px-6 py-4 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                  Status
                </th>
                <th scope="col" className="px-6 py-4 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                  Agent Reasoning
                </th>
                <th scope="col" className="relative px-6 py-4">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-slate-200">
              {filteredLeads.map((lead) => (
                <tr
                  key={lead.id}
                  className="hover:bg-slate-50 transition-colors cursor-pointer group"
                  onClick={() => setSelectedLead(lead)}
                >
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      <div className="h-10 w-10 flex-shrink-0 flex items-center justify-center rounded-lg bg-blue-100 text-blue-600 font-bold text-lg border border-blue-200">
                        {lead.entreprise.charAt(0)}
                      </div>
                      <div className="ml-4">
                        <div className="text-sm font-semibold text-slate-900">{lead.entreprise}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center text-sm text-slate-500 gap-1.5">
                      <Mail className="w-3.5 h-3.5" />
                      {lead.contact}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <div className={`text-sm ${getScoreColor(lead.intent_score)}`}>
                        {lead.intent_score}%
                      </div>
                      <div className="w-16 h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full ${lead.intent_score >= 80 ? 'bg-green-500' : lead.intent_score >= 50 ? 'bg-yellow-500' : 'bg-red-500'}`}
                          style={{ width: `${lead.intent_score}%` }}
                        />
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {getStatusBadge(lead.status)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center text-sm text-slate-500">
                      {lead.traces.length > 0 ? (
                        <span className="flex items-center gap-1.5 text-blue-600 bg-blue-50 px-2 py-1 rounded-md border border-blue-100 group-hover:bg-blue-100 transition-colors">
                          <Eye className="w-4 h-4" />
                          View Trace ({lead.traces.length})
                        </span>
                      ) : (
                        <span className="text-slate-400 italic">No trace</span>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <button className="text-slate-400 hover:text-slate-600 transition-colors p-1.5 hover:bg-slate-100 rounded-md">
                      <MoreHorizontal className="w-5 h-5" />
                    </button>
                  </td>
                </tr>
              ))}
              {filteredLeads.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-slate-500 bg-slate-50/50">
                    <div className="flex flex-col items-center gap-2">
                      <Search className="w-8 h-8 text-slate-300" />
                      <p>Aucun lead trouvé.</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 text-xs text-slate-500 flex justify-between items-center">
          <span>Affichage de <span className="font-semibold text-slate-700">{filteredLeads.length}</span> leads</span>
          <span className="flex items-center gap-1"><Activity className="w-3.5 h-3.5" /> Données mises à jour en temps réel</span>
        </div>
      </div>

      <AgentReasoningTrace
        lead={selectedLead}
        isOpen={!!selectedLead}
        onClose={() => setSelectedLead(null)}
      />
    </>
  );
}
