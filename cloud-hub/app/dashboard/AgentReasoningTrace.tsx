"use client";

import { X, CheckCircle2, ShieldAlert, Cpu, FileText, Activity, AlertTriangle, MessageSquare, ArrowRight, CornerDownRight } from 'lucide-react';
import { useEffect, useState } from 'react';

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

interface AgentReasoningTraceProps {
  lead: Lead | null;
  isOpen: boolean;
  onClose: () => void;
}

export default function AgentReasoningTrace({ lead, isOpen, onClose }: AgentReasoningTraceProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-40 transition-opacity duration-300 ease-in-out ${isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={onClose}
      />

      {/* Slide-over panel */}
      <div
        className={`fixed inset-y-0 right-0 z-50 w-full max-w-md bg-white shadow-2xl transform transition-transform duration-300 ease-in-out border-l border-slate-200 flex flex-col ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 rounded-lg text-blue-600">
              <Cpu className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900 leading-tight">Agent Trace</h2>
              <p className="text-xs text-slate-500 font-medium">Analyse de décision IA</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-200 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-8 custom-scrollbar">
          {lead ? (
            <>
              {/* Lead Context */}
              <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm relative overflow-hidden group">
                <div className="absolute top-0 right-0 w-24 h-24 bg-blue-50 rounded-full -mr-12 -mt-12 transition-transform group-hover:scale-110" />
                <div className="relative z-10 flex flex-col gap-1">
                  <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Cible Analysée</div>
                  <div className="text-xl font-bold text-slate-900 flex items-center gap-2">
                    {lead.entreprise}
                    {lead.intent_score >= 80 && <CheckCircle2 className="w-5 h-5 text-green-500" />}
                  </div>
                  <div className="text-sm text-slate-600 font-medium flex items-center gap-1.5 mt-1">
                    <FileText className="w-4 h-4 text-slate-400" />
                    {lead.contact}
                  </div>
                  <div className="mt-4 pt-4 border-t border-slate-100 flex items-center justify-between">
                    <span className="text-sm font-medium text-slate-600">Score d'intention global :</span>
                    <span className={`text-lg font-bold ${lead.intent_score >= 80 ? 'text-green-600' : lead.intent_score >= 50 ? 'text-yellow-600' : 'text-red-600'}`}>
                      {lead.intent_score}%
                    </span>
                  </div>
                </div>
              </div>

              {/* Reasoning Tree Visualizer */}
              <div className="space-y-4">
                <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider border-b border-slate-200 pb-2 mb-4 flex items-center gap-2">
                  <Activity className="w-4 h-4 text-slate-400" />
                  Arbre de Décision
                </h3>

                {lead.traces.length > 0 ? (
                  <div className="space-y-6 relative before:absolute before:inset-0 before:ml-4 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-blue-200 before:to-slate-200">
                    {lead.traces.map((trace, index) => (
                      <div key={trace.id} className="relative flex items-start gap-4 z-10">
                        {/* Node Connector Icon */}
                        <div className="flex flex-col items-center">
                          <div className={`w-8 h-8 rounded-full border-2 flex items-center justify-center bg-white shadow-sm z-10
                            ${trace.confidence_score >= 80 ? 'border-green-500 text-green-500' :
                              trace.confidence_score >= 50 ? 'border-yellow-500 text-yellow-500' : 'border-red-500 text-red-500'}`}
                          >
                            {trace.confidence_score >= 80 ? <CheckCircle2 className="w-4 h-4" /> :
                             trace.confidence_score >= 50 ? <AlertTriangle className="w-4 h-4" /> : <ShieldAlert className="w-4 h-4" />}
                          </div>
                          {index !== lead.traces.length - 1 && (
                            <div className="h-full w-0.5 bg-slate-200 my-1 z-0 absolute top-8 bottom-[-24px]"></div>
                          )}
                        </div>

                        {/* Trace Card */}
                        <div className="flex-1 bg-white border border-slate-200 rounded-xl p-4 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden group">
                          {/* Data Source Badge */}
                          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-100 border border-slate-200 text-xs font-semibold text-slate-600 mb-3 group-hover:bg-blue-50 group-hover:border-blue-100 group-hover:text-blue-700 transition-colors">
                            <Activity className="w-3.5 h-3.5" />
                            Source : {trace.data_source}
                          </div>

                          <div className="flex items-start gap-2 mb-3">
                            <CornerDownRight className="w-4 h-4 text-slate-300 mt-0.5" />
                            <p className="text-sm text-slate-800 leading-relaxed font-medium">
                              "{trace.reasoning}"
                            </p>
                          </div>

                          <div className="flex items-center justify-between mt-4 pt-3 border-t border-slate-100">
                            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1">
                              Indice de Confiance
                            </span>
                            <span className={`text-sm font-bold bg-slate-50 px-2 py-0.5 rounded border
                              ${trace.confidence_score >= 80 ? 'text-green-700 border-green-200' :
                                trace.confidence_score >= 50 ? 'text-yellow-700 border-yellow-200' : 'text-red-700 border-red-200'}`}>
                              {trace.confidence_score}%
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-8 text-center bg-slate-50 border border-slate-200 border-dashed rounded-xl">
                    <MessageSquare className="w-8 h-8 text-slate-300 mx-auto mb-3" />
                    <p className="text-sm font-medium text-slate-500">Aucune trace de raisonnement disponible pour ce lead.</p>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex items-center justify-center h-full text-slate-400">
              <p>Sélectionnez un lead pour voir l'analyse.</p>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-5 border-t border-slate-200 bg-white space-y-3 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]">
          <p className="text-xs text-slate-500 font-medium text-center mb-4 flex items-center justify-center gap-1.5">
            <ShieldAlert className="w-3.5 h-3.5" />
            L'IA s'apprête à valider ce profil.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <button className="flex items-center justify-center gap-2 px-4 py-2.5 bg-white border-2 border-slate-200 hover:border-red-300 hover:bg-red-50 text-slate-700 hover:text-red-700 rounded-lg text-sm font-bold transition-all shadow-sm">
              <ShieldAlert className="w-4 h-4" />
              Override
            </button>
            <button className="flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-bold transition-all shadow-sm hover:shadow-md group">
              Approuver
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
