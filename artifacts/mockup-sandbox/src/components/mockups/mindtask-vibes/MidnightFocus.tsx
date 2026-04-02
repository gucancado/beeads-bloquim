import React from "react";
import { 
  Compass, 
  LayoutGrid, 
  CheckCircle2, 
  Settings, 
  Plus, 
  Search,
  Bell,
  MoreHorizontal,
  Circle,
  Clock,
  CheckCircle,
  AlertCircle
} from "lucide-react";

export function MidnightFocus() {
  const tasks = [
    { id: 1, title: "Revisar proposta comercial", status: "in_progress", assignee: "LC", priority: "high", due: "Amanhã" },
    { id: 2, title: "Preparar apresentação Q2", status: "pending", assignee: "AR", priority: "medium", due: "Sex" },
    { id: 3, title: "Atualizar documentação da API", status: "completed", assignee: "LC", priority: "low", due: "Concluído" },
    { id: 4, title: "Reunião de alinhamento", status: "overdue", assignee: "MF", priority: "critical", due: "Atrasado" },
    { id: 5, title: "Relatório de performance", status: "pending", assignee: "AR", priority: "medium", due: "Dom" },
  ];

  const getStatusDisplay = (status: string) => {
    switch (status) {
      case "pending":
        return { 
          label: "Pendente", 
          icon: <Circle className="w-3.5 h-3.5 mr-1.5" />, 
          colors: "bg-[#1C2333] text-[#7B96D4] border-[#2A3449]" 
        };
      case "in_progress":
        return { 
          label: "Em andamento", 
          icon: <Clock className="w-3.5 h-3.5 mr-1.5" />, 
          colors: "bg-[#2D2114] text-[#D49E7B] border-[#42311E]" 
        };
      case "completed":
        return { 
          label: "Concluído", 
          icon: <CheckCircle className="w-3.5 h-3.5 mr-1.5" />, 
          colors: "bg-[#142D1C] text-[#7BD495] border-[#1E422A]" 
        };
      case "overdue":
        return { 
          label: "Atrasado", 
          icon: <AlertCircle className="w-3.5 h-3.5 mr-1.5" />, 
          colors: "bg-[#2D1414] text-[#D47B7B] border-[#421E1E]" 
        };
      default:
        return { label: status, icon: null, colors: "" };
    }
  };

  const getPriorityDisplay = (priority: string) => {
    switch (priority) {
      case "low": return { label: "Baixa", colors: "text-[#8B7CF6]/60 bg-transparent border-[#8B7CF6]/20" };
      case "medium": return { label: "Média", colors: "text-[#8B7CF6]/80 bg-transparent border-[#8B7CF6]/40" };
      case "high": return { label: "Alta", colors: "text-[#0E0E12] bg-[#8B7CF6]/90 border-transparent" };
      case "critical": return { label: "Crítica", colors: "text-[#0E0E12] bg-[#8B7CF6] border-transparent" };
      default: return { label: priority, colors: "" };
    }
  };

  return (
    <div className="flex h-screen w-full bg-[#0E0E12] text-white overflow-hidden" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
      <style dangerouslySetInnerHTML={{ __html: `
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600&display=swap');
        
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.1); border-radius: 4px; }
        ::-webkit-scrollbar-thumb:hover { background: rgba(255, 255, 255, 0.2); }
      ` }} />

      {/* Sidebar */}
      <div className="w-60 flex-shrink-0 bg-[#08080C] border-r border-white/[0.06] flex flex-col">
        {/* Logo */}
        <div className="h-16 flex items-center px-6 border-b border-white/[0.06]">
          <Compass className="w-5 h-5 text-[#8B7CF6] mr-3" />
          <span className="font-semibold tracking-wide text-sm">Bloquim</span>
        </div>

        {/* Nav */}
        <div className="flex-1 py-6 px-4 space-y-8 overflow-y-auto">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-white/40 mb-3 px-2 font-medium">Menu Principal</div>
            <div className="space-y-1">
              <button className="w-full flex items-center px-2 py-2 text-xs text-white/60 hover:text-white hover:bg-white/[0.04] rounded transition-colors group">
                <LayoutGrid className="w-4 h-4 mr-3 text-white/40 group-hover:text-white/80 transition-colors" />
                Workspaces
              </button>
              <button className="w-full flex items-center px-2 py-2 text-xs text-white bg-white/[0.06] rounded transition-colors group">
                <CheckCircle2 className="w-4 h-4 mr-3 text-[#8B7CF6]" />
                Minhas Tarefas
              </button>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-white/40 mb-3 px-2 font-medium">
              <span>Workspaces</span>
              <button className="hover:text-white"><Plus className="w-3.5 h-3.5" /></button>
            </div>
            <div className="space-y-1">
              <button className="w-full flex items-center px-2 py-2 text-xs text-white/60 hover:text-white hover:bg-white/[0.04] rounded transition-colors">
                <div className="w-4 h-4 mr-3 rounded-sm bg-[#1C1C24] border border-white/[0.1] flex items-center justify-center text-[8px] text-[#8B7CF6]">E</div>
                Equipe Design
              </button>
              <button className="w-full flex items-center px-2 py-2 text-xs text-white/60 hover:text-white hover:bg-white/[0.04] rounded transition-colors">
                <div className="w-4 h-4 mr-3 rounded-sm bg-[#1C1C24] border border-white/[0.1] flex items-center justify-center text-[8px] text-[#8B7CF6]">M</div>
                Marketing Q3
              </button>
              <button className="w-full flex items-center px-2 py-2 text-xs text-white/60 hover:text-white hover:bg-white/[0.04] rounded transition-colors">
                <div className="w-4 h-4 mr-3 rounded-sm bg-[#1C1C24] border border-white/[0.1] flex items-center justify-center text-[8px] text-[#8B7CF6]">E</div>
                Engenharia
              </button>
            </div>
          </div>
        </div>

        {/* User */}
        <div className="p-4 border-t border-white/[0.06]">
          <button className="w-full flex items-center p-2 rounded hover:bg-white/[0.04] transition-colors">
            <div className="w-7 h-7 rounded bg-[#1C1C24] border border-white/[0.1] flex items-center justify-center text-xs text-[#8B7CF6] mr-3">
              JD
            </div>
            <div className="flex-1 text-left">
              <div className="text-xs font-medium text-white/90">João Doe</div>
              <div className="text-[10px] text-white/40">Plano Pro</div>
            </div>
            <Settings className="w-3.5 h-3.5 text-white/40" />
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 bg-[#16161D]">
        {/* Header */}
        <header className="h-16 flex items-center justify-between px-8 border-b border-white/[0.06] bg-[#16161D]">
          <div className="flex items-center text-sm">
            <span className="text-white/40">Minhas Tarefas</span>
            <span className="mx-2 text-white/20">/</span>
            <span className="font-medium text-white/90">Esta Semana</span>
          </div>

          <div className="flex items-center space-x-4">
            <div className="relative">
              <Search className="w-4 h-4 text-white/40 absolute left-3 top-1/2 -translate-y-1/2" />
              <input 
                type="text" 
                placeholder="Buscar..." 
                className="w-48 bg-[#1C1C24] border border-white/[0.06] rounded text-xs py-1.5 pl-9 pr-3 text-white placeholder:text-white/30 focus:outline-none focus:border-[#8B7CF6]/50 transition-colors"
              />
            </div>
            <button className="relative p-1.5 text-white/40 hover:text-white transition-colors rounded hover:bg-white/[0.04]">
              <Bell className="w-4 h-4" />
              <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 bg-[#8B7CF6] rounded-full"></span>
            </button>
            <button className="bg-[#8B7CF6] hover:bg-[#7a6ce0] text-[#0E0E12] px-4 py-1.5 rounded text-xs font-medium transition-colors flex items-center">
              <Plus className="w-3.5 h-3.5 mr-1.5" />
              Nova Tarefa
            </button>
          </div>
        </header>

        {/* Task List */}
        <div className="flex-1 overflow-y-auto p-8">
          <div className="max-w-5xl mx-auto">
            
            {/* Toolbar */}
            <div className="flex justify-between items-center mb-6">
              <div className="flex space-x-1">
                <button className="px-3 py-1.5 text-xs font-medium bg-white/[0.06] text-white rounded">Todas</button>
                <button className="px-3 py-1.5 text-xs font-medium text-white/50 hover:text-white hover:bg-white/[0.02] rounded transition-colors">Pendentes</button>
                <button className="px-3 py-1.5 text-xs font-medium text-white/50 hover:text-white hover:bg-white/[0.02] rounded transition-colors">Concluídas</button>
              </div>
              <div className="flex items-center space-x-2 text-xs text-white/40">
                <button className="flex items-center hover:text-white transition-colors">Filtrar</button>
                <span>•</span>
                <button className="flex items-center hover:text-white transition-colors">Ordenar</button>
              </div>
            </div>

            {/* List */}
            <div className="bg-[#1C1C24] border border-white/[0.06] rounded">
              
              {/* Table Header */}
              <div className="grid grid-cols-[1fr_120px_100px_120px_40px] gap-4 px-5 py-3 border-b border-white/[0.06] text-[10px] uppercase tracking-wider text-white/40 font-medium bg-[#16161D]/50">
                <div>Tarefa</div>
                <div>Status</div>
                <div>Prioridade</div>
                <div>Prazo</div>
                <div></div>
              </div>

              {/* Rows */}
              <div className="divide-y divide-white/[0.04]">
                {tasks.map(task => {
                  const status = getStatusDisplay(task.status);
                  const priority = getPriorityDisplay(task.priority);
                  
                  return (
                    <div key={task.id} className="grid grid-cols-[1fr_120px_100px_120px_40px] gap-4 px-5 py-3.5 items-center hover:bg-white/[0.02] transition-colors group">
                      <div className="flex items-center min-w-0">
                        <div className="w-6 h-6 rounded bg-[#16161D] border border-white/[0.06] flex items-center justify-center text-[9px] text-white/60 mr-3 flex-shrink-0">
                          {task.assignee}
                        </div>
                        <span className="text-xs text-white/90 truncate font-medium group-hover:text-[#8B7CF6] transition-colors cursor-pointer">
                          {task.title}
                        </span>
                      </div>
                      
                      <div>
                        <div className={"inline-flex items-center px-2 py-1 rounded border text-[10px] font-medium " + status.colors}>
                          {status.icon}
                          {status.label}
                        </div>
                      </div>

                      <div>
                        <div className={"inline-flex items-center px-2 py-0.5 rounded border text-[10px] " + priority.colors}>
                          {priority.label}
                        </div>
                      </div>

                      <div className="text-xs text-white/50 flex items-center">
                        <Clock className="w-3 h-3 mr-1.5 opacity-50" />
                        {task.due}
                      </div>

                      <div className="flex justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                        <button className="p-1 text-white/40 hover:text-white hover:bg-white/[0.06] rounded">
                          <MoreHorizontal className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            
          </div>
        </div>
      </div>
    </div>
  );
}
