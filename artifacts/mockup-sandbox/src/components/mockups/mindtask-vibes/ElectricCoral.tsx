import React from "react";
import { Compass, Home, CheckSquare, Search, Plus, Bell, MoreHorizontal, Calendar, AlertCircle, Clock, CheckCircle2 } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "../../ui/avatar";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";

const tasks = [
  { title: "Revisar proposta comercial", status: "in_progress", assignee: "LC", priority: "high", due: "Amanhã" },
  { title: "Preparar apresentação Q2", status: "pending", assignee: "AR", priority: "medium", due: "Sex" },
  { title: "Atualizar documentação da API", status: "completed", assignee: "LC", priority: "low", due: "Concluído" },
  { title: "Reunião de alinhamento", status: "overdue", assignee: "MF", priority: "critical", due: "Atrasado" },
  { title: "Relatório de performance", status: "pending", assignee: "AR", priority: "medium", due: "Dom" },
];

const statusConfig = {
  pending: { label: "Pendente", color: "bg-blue-500 text-white", icon: Clock },
  in_progress: { label: "Em Andamento", color: "bg-amber-500 text-white", icon: AlertCircle },
  completed: { label: "Concluído", color: "bg-green-500 text-white", icon: CheckCircle2 },
  overdue: { label: "Atrasado", color: "bg-red-500 text-white", icon: AlertCircle },
};

const priorityConfig = {
  low: { label: "Baixa", color: "bg-gray-100 text-gray-600" },
  medium: { label: "Média", color: "bg-amber-100 text-amber-700" },
  high: { label: "Alta", color: "bg-orange-100 text-orange-700" },
  critical: { label: "Crítica", color: "bg-red-100 text-red-700" },
};

const wsDotColor = (i: number) => i === 0 ? 'bg-[#FF4D6D]' : i === 1 ? 'bg-amber-400' : 'bg-emerald-400';

export function ElectricCoral() {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: `
        @import url('https://fonts.googleapis.com/css2?family=Lexend:wght@400;500;600;700&family=Nunito:wght@400;500;600;700&display=swap');
        .font-lexend { font-family: 'Lexend', sans-serif; }
        .font-nunito { font-family: 'Nunito', sans-serif; }
        .shadow-coral { box-shadow: 0 10px 25px -5px rgba(255, 77, 109, 0.15), 0 8px 10px -6px rgba(255, 77, 109, 0.1); }
        .shadow-soft { box-shadow: 0 4px 20px -2px rgba(0, 0, 0, 0.05); }
      ` }} />

      <div className="flex h-screen bg-[#FAFAF8] font-nunito text-slate-800 overflow-hidden">
        {/* Sidebar */}
        <div className="w-64 flex flex-col justify-between text-white bg-gradient-to-b from-[#1E1048] to-[#6C3FC0] p-6 shadow-xl z-10 relative">
          <div className="absolute top-0 right-0 w-32 h-32 bg-white opacity-5 rounded-full -mr-16 -mt-16 blur-2xl"></div>
          
          <div className="relative z-10">
            <div className="flex items-center gap-3 mb-10 pl-2">
              <div className="w-10 h-10 rounded-[20px] bg-gradient-to-br from-[#FF4D6D] to-[#FF758F] flex items-center justify-center shadow-lg shadow-[#FF4D6D]/40">
                <Compass className="w-6 h-6 text-white" />
              </div>
              <span className="text-2xl font-bold font-lexend tracking-tight">Bloquim</span>
            </div>

            <nav className="space-y-2">
              <div className="flex items-center gap-3 px-4 py-3 rounded-[24px] hover:bg-white/10 transition-colors cursor-pointer text-white/80 hover:text-white font-medium">
                <Home className="w-5 h-5" />
                <span>Workspaces</span>
              </div>
              <div className="flex items-center gap-3 px-4 py-3 rounded-[24px] bg-white/20 text-white font-semibold backdrop-blur-sm cursor-pointer shadow-sm">
                <CheckSquare className="w-5 h-5 text-[#FF758F]" />
                <span>Minhas Tarefas</span>
                <span className="ml-auto bg-[#FF4D6D] text-white text-xs font-bold px-2.5 py-0.5 rounded-full">12</span>
              </div>
            </nav>

            <div className="mt-10">
              <div className="px-4 text-xs font-bold text-white/50 uppercase tracking-wider mb-4 font-lexend">
                Workspaces
              </div>
              <div className="space-y-2">
                {["Design Team", "Marketing", "Engineering"].map((ws, i) => (
                  <div key={ws} className="flex items-center gap-3 px-4 py-2.5 rounded-[24px] hover:bg-white/10 transition-colors cursor-pointer group">
                    <div className={"w-3 h-3 rounded-full " + wsDotColor(i)}></div>
                    <span className="text-white/80 group-hover:text-white font-medium">{ws}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="relative z-10 mt-auto pt-6 border-t border-white/10">
            <div className="flex items-center gap-3 px-2 cursor-pointer group">
              <Avatar className="w-10 h-10 border-2 border-white/20 group-hover:border-[#FF4D6D] transition-colors rounded-[20px]">
                <AvatarImage src="https://i.pravatar.cc/150?u=a042581f4e29026024d" />
                <AvatarFallback className="bg-indigo-900 text-white">AM</AvatarFallback>
              </Avatar>
              <div>
                <div className="text-sm font-bold font-lexend">Ana Martins</div>
                <div className="text-xs text-white/60">Configurações</div>
              </div>
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 flex flex-col relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-64 bg-gradient-to-br from-[#FF4D6D]/5 to-transparent pointer-events-none"></div>
          
          {/* Header */}
          <header className="px-10 py-8 flex items-center justify-between relative z-10">
            <div>
              <h1 className="text-4xl font-black font-lexend text-slate-800 tracking-tight mb-2">Minhas Tarefas</h1>
              <p className="text-slate-500 font-medium text-lg">Você tem <span className="text-[#FF4D6D] font-bold">5 tarefas</span> para hoje. Vamos lá!</p>
            </div>
            
            <div className="flex items-center gap-4">
              <div className="relative">
                <Search className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                <input 
                  type="text" 
                  placeholder="Buscar tarefas..." 
                  className="pl-11 pr-4 py-3 bg-white rounded-[24px] shadow-sm border-none focus:ring-2 focus:ring-[#FF4D6D]/20 outline-none w-64 text-slate-700 font-medium placeholder:text-slate-400"
                />
              </div>
              <Button size="icon" variant="ghost" className="rounded-full w-12 h-12 bg-white shadow-sm text-slate-400 hover:text-[#FF4D6D] hover:bg-[#FF4D6D]/10">
                <Bell className="w-5 h-5" />
              </Button>
              <Button className="rounded-[24px] bg-gradient-to-r from-[#FF4D6D] to-[#FF758F] hover:from-[#E63E5C] hover:to-[#FF5C7A] text-white px-6 py-6 h-auto shadow-coral font-bold text-base transition-transform hover:-translate-y-0.5 border-none">
                <Plus className="w-5 h-5 mr-2" />
                Nova Tarefa
              </Button>
            </div>
          </header>

          {/* Content */}
          <div className="flex-1 overflow-auto px-10 pb-10 relative z-10">
            <div className="bg-white rounded-[32px] p-8 shadow-soft border border-slate-100">
              <div className="flex items-center justify-between mb-8 pb-4 border-b border-slate-100">
                <div className="flex gap-6">
                  <div className="font-bold text-[#FF4D6D] border-b-2 border-[#FF4D6D] pb-4 -mb-[18px]">Todas as Tarefas</div>
                  <div className="font-medium text-slate-400 hover:text-slate-600 cursor-pointer pb-4 -mb-[18px]">Esta Semana</div>
                  <div className="font-medium text-slate-400 hover:text-slate-600 cursor-pointer pb-4 -mb-[18px]">Concluídas</div>
                </div>
                <div className="text-sm font-bold text-slate-400">Ordenar por: <span className="text-slate-700 cursor-pointer">Prioridade</span></div>
              </div>

              <div className="space-y-4">
                {tasks.map((task, i) => {
                  const status = statusConfig[task.status as keyof typeof statusConfig];
                  const priority = priorityConfig[task.priority as keyof typeof priorityConfig];
                  const StatusIcon = status.icon;
                  const isCompleted = task.status === 'completed';
                  const isOverdue = task.status === 'overdue';
                  
                  return (
                    <div 
                      key={i} 
                      className="group flex items-center justify-between p-5 rounded-[24px] bg-white border border-slate-100 hover:border-[#FF4D6D]/30 hover:shadow-coral transition-all duration-200 cursor-pointer"
                    >
                      <div className="flex items-center gap-5 flex-1">
                        <div className="w-6 h-6 rounded-full border-2 border-slate-200 group-hover:border-[#FF4D6D] flex items-center justify-center transition-colors">
                           {isCompleted && <CheckCircle2 className="w-4 h-4 text-green-500" />}
                        </div>
                        
                        <div className="flex-1">
                          <h3 className={"text-lg font-bold font-lexend " + (isCompleted ? 'text-slate-400 line-through' : 'text-slate-800')}>
                            {task.title}
                          </h3>
                        </div>
                      </div>

                      <div className="flex items-center gap-6">
                        <Badge variant="outline" className={"px-3 py-1 rounded-[16px] border-none font-bold text-xs " + priority.color}>
                          {priority.label}
                        </Badge>
                        
                        <div className="flex items-center gap-2 text-slate-500 w-24">
                          <Calendar className="w-4 h-4" />
                          <span className={"text-sm font-semibold " + (isOverdue ? 'text-red-500' : '')}>{task.due}</span>
                        </div>

                        <Avatar className="w-8 h-8 rounded-[12px] border-2 border-white shadow-sm">
                          <AvatarFallback className="bg-indigo-100 text-indigo-700 font-bold text-xs">
                            {task.assignee}
                          </AvatarFallback>
                        </Avatar>

                        <div className={"flex items-center gap-1.5 px-3 py-1.5 rounded-[16px] text-xs font-bold w-32 justify-center shadow-sm " + status.color}>
                          <StatusIcon className="w-3.5 h-3.5" />
                          {status.label}
                        </div>

                        <Button variant="ghost" size="icon" className="text-slate-400 hover:text-slate-700 rounded-full hover:bg-slate-100">
                          <MoreHorizontal className="w-5 h-5" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
