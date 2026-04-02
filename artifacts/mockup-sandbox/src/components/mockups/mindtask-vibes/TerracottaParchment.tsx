import React from "react";
import {
  Compass,
  LayoutGrid,
  CheckSquare,
  ChevronDown,
  MoreHorizontal,
  Plus,
  Search,
  Calendar,
  Clock,
  CircleDashed,
  Circle,
  CheckCircle2,
  AlertCircle
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

export function TerracottaParchment() {
  return (
    <>
      <style dangerouslySetInnerHTML={{__html: `
        @import url('https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400;0,500;0,600;0,700;1,400&family=Inter:wght@400;500;600&display=swap');
        
        .font-serif {
          font-family: 'Lora', serif;
        }
        .font-sans {
          font-family: 'Inter', sans-serif;
        }
      `}} />
      
      <div className="flex h-screen w-full font-sans text-[#3A2015] bg-[#FAF3EA] overflow-hidden">
        
        {/* Sidebar */}
        <div className="w-64 bg-[#2C1A12] text-[#E8DFD5] flex flex-col flex-shrink-0">
          <div className="p-6 flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-[#C45C38] flex items-center justify-center text-white shadow-sm">
              <Compass className="w-5 h-5" />
            </div>
            <span className="font-serif font-semibold text-xl tracking-wide text-[#FAF3EA]">Bloquim</span>
          </div>

          <div className="px-4 py-2 flex flex-col gap-1">
            <button className="flex items-center gap-3 px-3 py-2 rounded-lg text-[#E8DFD5] hover:bg-[#3A2015] hover:text-[#FAF3EA] transition-colors w-full text-left text-sm font-medium">
              <LayoutGrid className="w-4 h-4 opacity-70" />
              Workspaces
            </button>
            <button className="flex items-center gap-3 px-3 py-2 rounded-lg bg-[#3A2015] text-[#FAF3EA] transition-colors w-full text-left text-sm font-medium border border-[#4A2D1F]">
              <CheckSquare className="w-4 h-4 text-[#C45C38]" />
              Minhas Tarefas
            </button>
          </div>

          <div className="px-7 pt-6 pb-2 text-xs font-semibold text-[#8C6B5D] uppercase tracking-wider">
            Workspaces
          </div>
          
          <div className="px-4 flex flex-col gap-1 flex-1 overflow-y-auto">
            {['Design Team', 'Marketing Q3', 'Engenharia'].map((ws) => (
              <button key={ws} className="flex items-center justify-between px-3 py-2 rounded-lg text-[#D4C3B3] hover:bg-[#3A2015] transition-colors w-full text-left text-sm">
                <div className="flex items-center gap-3">
                  <div className="w-2 h-2 rounded-full bg-[#8C6B5D]" />
                  {ws}
                </div>
              </button>
            ))}
          </div>

          <div className="p-4 mt-auto">
            <div className="flex items-center gap-3 p-3 rounded-lg hover:bg-[#3A2015] transition-colors cursor-pointer border border-transparent hover:border-[#4A2D1F]">
              <Avatar className="w-8 h-8 rounded-lg border border-[#4A2D1F]">
                <AvatarFallback className="bg-[#4A2D1F] text-[#D4C3B3] rounded-lg">JD</AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-[#FAF3EA] truncate">João Silva</div>
                <div className="text-xs text-[#8C6B5D] truncate">joao@mindtask.com</div>
              </div>
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 flex flex-col h-full overflow-hidden">
          {/* Header */}
          <header className="px-8 py-6 flex items-center justify-between border-b border-[#E8DFD5] bg-[#FDFBF7]">
            <div>
              <h1 className="font-serif text-3xl font-semibold text-[#2C1A12]">Minhas Tarefas</h1>
              <p className="text-sm text-[#8C6B5D] mt-1">Quinta-feira, 24 de Outubro</p>
            </div>
            
            <div className="flex items-center gap-4">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#8C6B5D]" />
                <input 
                  type="text" 
                  placeholder="Buscar tarefas..." 
                  className="pl-9 pr-4 py-2 rounded-lg border border-[#E8DFD5] bg-[#FAF3EA] text-sm focus:outline-none focus:ring-1 focus:ring-[#C45C38] focus:border-[#C45C38] w-64 placeholder:text-[#8C6B5D]"
                />
              </div>
              <button className="bg-[#C45C38] hover:bg-[#A84A2A] text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 shadow-sm transition-colors">
                <Plus className="w-4 h-4" />
                Nova Tarefa
              </button>
            </div>
          </header>

          {/* Task List Area */}
          <main className="flex-1 overflow-y-auto p-8">
            <div className="max-w-4xl mx-auto">
              
              {/* Filter Tabs */}
              <div className="flex items-center gap-6 border-b border-[#E8DFD5] mb-6">
                <button className="pb-3 border-b-2 border-[#C45C38] text-[#C45C38] font-medium text-sm">
                  Todas
                </button>
                <button className="pb-3 border-b-2 border-transparent text-[#8C6B5D] hover:text-[#3A2015] font-medium text-sm transition-colors">
                  Hoje
                </button>
                <button className="pb-3 border-b-2 border-transparent text-[#8C6B5D] hover:text-[#3A2015] font-medium text-sm transition-colors">
                  Próximas
                </button>
              </div>

              {/* Tasks List */}
              <div className="space-y-3">
                
                {/* Task 1 */}
                <div className="group flex items-center justify-between p-4 rounded-lg bg-[#FDFBF7] border border-[#E8DFD5] hover:border-[#D4C3B3] hover:shadow-sm transition-all">
                  <div className="flex items-center gap-4 flex-1">
                    <CircleDashed className="w-5 h-5 text-[#C89F65]" />
                    <div>
                      <h3 className="text-[15px] font-medium text-[#2C1A12] group-hover:text-[#C45C38] transition-colors">Revisar proposta comercial</h3>
                      <div className="flex items-center gap-3 mt-1.5 text-xs text-[#8C6B5D]">
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3.5 h-3.5" /> Amanhã
                        </span>
                        <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#FAF3EA] border border-[#E8DFD5] text-[#8C6B5D] font-medium">
                          Alta prioridade
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="px-2.5 py-1 rounded-md text-xs font-medium bg-[#FDF0E1] text-[#B87A3D] border border-[#F5E2C6]">
                      Em andamento
                    </div>
                    <Avatar className="w-7 h-7 rounded border border-[#E8DFD5]">
                      <AvatarFallback className="bg-[#FAF3EA] text-[#3A2015] text-xs">LC</AvatarFallback>
                    </Avatar>
                    <button className="text-[#8C6B5D] hover:text-[#3A2015] opacity-0 group-hover:opacity-100 transition-opacity">
                      <MoreHorizontal className="w-5 h-5" />
                    </button>
                  </div>
                </div>

                {/* Task 2 */}
                <div className="group flex items-center justify-between p-4 rounded-lg bg-[#FDFBF7] border border-[#E8DFD5] hover:border-[#D4C3B3] hover:shadow-sm transition-all">
                  <div className="flex items-center gap-4 flex-1">
                    <Circle className="w-5 h-5 text-[#738C9B]" />
                    <div>
                      <h3 className="text-[15px] font-medium text-[#2C1A12] group-hover:text-[#C45C38] transition-colors">Preparar apresentação Q2</h3>
                      <div className="flex items-center gap-3 mt-1.5 text-xs text-[#8C6B5D]">
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3.5 h-3.5" /> Sex
                        </span>
                        <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#FAF3EA] border border-[#E8DFD5] text-[#8C6B5D] font-medium">
                          Média
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="px-2.5 py-1 rounded-md text-xs font-medium bg-[#EBF0F2] text-[#5A7385] border border-[#DCE4E8]">
                      Pendente
                    </div>
                    <Avatar className="w-7 h-7 rounded border border-[#E8DFD5]">
                      <AvatarFallback className="bg-[#FAF3EA] text-[#3A2015] text-xs">AR</AvatarFallback>
                    </Avatar>
                    <button className="text-[#8C6B5D] hover:text-[#3A2015] opacity-0 group-hover:opacity-100 transition-opacity">
                      <MoreHorizontal className="w-5 h-5" />
                    </button>
                  </div>
                </div>

                {/* Task 3 */}
                <div className="group flex items-center justify-between p-4 rounded-lg bg-[#FAF3EA] border border-[#E8DFD5] opacity-70 hover:opacity-100 transition-all">
                  <div className="flex items-center gap-4 flex-1">
                    <CheckCircle2 className="w-5 h-5 text-[#6B8E7B]" />
                    <div>
                      <h3 className="text-[15px] font-medium text-[#8C6B5D] line-through">Atualizar documentação da API</h3>
                      <div className="flex items-center gap-3 mt-1.5 text-xs text-[#8C6B5D]">
                        <span className="flex items-center gap-1">
                          <CheckSquare className="w-3.5 h-3.5" /> Concluído
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="px-2.5 py-1 rounded-md text-xs font-medium bg-[#EDF3EF] text-[#557A66] border border-[#DCE8DF]">
                      Concluído
                    </div>
                    <Avatar className="w-7 h-7 rounded border border-[#E8DFD5]">
                      <AvatarFallback className="bg-[#FDFBF7] text-[#8C6B5D] text-xs">LC</AvatarFallback>
                    </Avatar>
                    <button className="text-[#8C6B5D] hover:text-[#3A2015] opacity-0 group-hover:opacity-100 transition-opacity">
                      <MoreHorizontal className="w-5 h-5" />
                    </button>
                  </div>
                </div>

                {/* Task 4 */}
                <div className="group flex items-center justify-between p-4 rounded-lg bg-[#FFF9F9] border border-[#F2D0D0] hover:shadow-sm transition-all relative overflow-hidden">
                  <div className="absolute left-0 top-0 bottom-0 w-1 bg-[#B85C5C]" />
                  <div className="flex items-center gap-4 flex-1 pl-2">
                    <AlertCircle className="w-5 h-5 text-[#B85C5C]" />
                    <div>
                      <h3 className="text-[15px] font-medium text-[#2C1A12] group-hover:text-[#B85C5C] transition-colors">Reunião de alinhamento</h3>
                      <div className="flex items-center gap-3 mt-1.5 text-xs text-[#B85C5C]">
                        <span className="flex items-center gap-1 font-medium">
                          <Clock className="w-3.5 h-3.5" /> Atrasado
                        </span>
                        <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#FDEAEA] border border-[#F2D0D0] text-[#B85C5C] font-semibold">
                          Crítica
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="px-2.5 py-1 rounded-md text-xs font-medium bg-[#FDEAEA] text-[#B85C5C] border border-[#F2D0D0]">
                      Atrasado
                    </div>
                    <Avatar className="w-7 h-7 rounded border border-[#F2D0D0]">
                      <AvatarFallback className="bg-[#FDFBF7] text-[#B85C5C] text-xs">MF</AvatarFallback>
                    </Avatar>
                    <button className="text-[#8C6B5D] hover:text-[#3A2015] opacity-0 group-hover:opacity-100 transition-opacity">
                      <MoreHorizontal className="w-5 h-5" />
                    </button>
                  </div>
                </div>

                {/* Task 5 */}
                <div className="group flex items-center justify-between p-4 rounded-lg bg-[#FDFBF7] border border-[#E8DFD5] hover:border-[#D4C3B3] hover:shadow-sm transition-all">
                  <div className="flex items-center gap-4 flex-1">
                    <Circle className="w-5 h-5 text-[#738C9B]" />
                    <div>
                      <h3 className="text-[15px] font-medium text-[#2C1A12] group-hover:text-[#C45C38] transition-colors">Relatório de performance</h3>
                      <div className="flex items-center gap-3 mt-1.5 text-xs text-[#8C6B5D]">
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3.5 h-3.5" /> Dom
                        </span>
                        <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#FAF3EA] border border-[#E8DFD5] text-[#8C6B5D] font-medium">
                          Média
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="px-2.5 py-1 rounded-md text-xs font-medium bg-[#EBF0F2] text-[#5A7385] border border-[#DCE4E8]">
                      Pendente
                    </div>
                    <Avatar className="w-7 h-7 rounded border border-[#E8DFD5]">
                      <AvatarFallback className="bg-[#FAF3EA] text-[#3A2015] text-xs">AR</AvatarFallback>
                    </Avatar>
                    <button className="text-[#8C6B5D] hover:text-[#3A2015] opacity-0 group-hover:opacity-100 transition-opacity">
                      <MoreHorizontal className="w-5 h-5" />
                    </button>
                  </div>
                </div>

              </div>
            </div>
          </main>
        </div>
      </div>
    </>
  );
}
