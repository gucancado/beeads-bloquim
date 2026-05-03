# Criar função global de busca de tarefas

## Objetivo

Permitir que o usuário busque tarefas a partir de termos presentes no título ou na descrição, usando uma busca global acessível em todo o sistema.

---

## 1) Escopo da busca

A busca deve considerar tarefas que contenham o termo pesquisado em:

- título
- descrição

A busca deve ser case-insensitive:

- buscar "cliente" deve encontrar "Cliente", "CLIENTE" e variações equivalentes

---

## 2) Acesso à busca

- adicionar um botão com ícone de lupa no topo da tela
- o botão deve ficar no canto superior direito da interface
- o botão deve funcionar em todo o sistema, independentemente da página atual

### Comportamento do botão

- ao clicar no botão de lupa:
  - exibir o campo de busca
  - focar automaticamente no campo para o usuário começar a digitar

- ao fechar ou limpar a busca:
  - retornar ao estado inicial com apenas o botão de lupa visível

---

## 3) Atalho de teclado

- implementar o atalho `Ctrl + F`
- o atalho deve ter o mesmo efeito de clicar no botão de lupa:
  - abrir o campo de busca
  - focar automaticamente no campo para digitação

### Regras do atalho

- o atalho deve funcionar globalmente no sistema
- ao pressionar `Ctrl + F`, impedir o comportamento padrão do navegador de abrir a busca da página
- se o campo de busca já estiver aberto:
  - apenas focar novamente no campo
- não interferir em campos de texto quando o usuário estiver digitando, exceto se for uma decisão consciente manter o atalho global

---

## 4) Campo de busca

- o campo de busca deve aparecer após o clique no botão de lupa ou uso do atalho `Ctrl + F`
- a busca deve acontecer automaticamente enquanto o usuário digita
- não deve ser necessário:
  - pressionar Enter
  - clicar em botão de buscar

### Regras

- usar debounce para evitar requisições excessivas
- não buscar com termo vazio
- opcionalmente definir mínimo de caracteres, por exemplo:
  - iniciar busca a partir de 2 caracteres

---

## 5) Exibição dos resultados

- os resultados devem aparecer em um menu dropdown abaixo do campo de busca
- o dropdown deve abrir automaticamente quando houver busca ativa

### Cada resultado deve exibir

- título da tarefa
- trecho resumido da descrição, se houver
- status
- responsável
- prioridade
- prazo, se houver
- espaço de trabalho, se houver
- plano, se houver

### Interação

- ao clicar em um resultado:
  - abrir a tela/modal de edição da tarefa correspondente
  - fechar o dropdown de busca

---

## 6) Estados do dropdown

### Digitando / carregando

- mostrar indicador de carregamento discreto

### Sem resultados

Exibir mensagem:

```txt
Nenhuma tarefa encontrada.
```

### Erro

Exibir mensagem amigável:

```txt
Não foi possível realizar a busca.
```

### Campo vazio

- não mostrar resultados
- dropdown pode permanecer fechado

---

## 7) Regras de permissão

- buscar apenas tarefas que o usuário autenticado tem permissão para visualizar
- não retornar tarefas de outros usuários ou espaços de trabalho sem permissão
- respeitar as regras de acesso já existentes no sistema

---

## 8) Backend

Criar ou adaptar endpoint para busca de tarefas.

Sugestão:

```txt
GET /api/tasks/search?q=termo
```

### Regras do endpoint

- receber parâmetro `q`
- validar termo vazio
- buscar em:
  - title
  - description
- realizar busca case-insensitive
- retornar apenas tarefas acessíveis ao usuário autenticado
- limitar quantidade de resultados para evitar impacto de performance
- ordenar resultados por:
  - relevância simples
  - ou data de atualização, caso relevância não exista

---

## 9) Frontend

Implementar um componente global de busca.

### Requisitos

- disponível em todo o sistema
- botão de lupa no canto superior direito
- campo aparece ao clicar no botão ou ao usar `Ctrl + F`
- campo recebe foco automático
- busca ocorre enquanto o usuário digita
- resultados aparecem em dropdown abaixo do campo
- debounce nas requisições
- opção para limpar/fechar busca
- ao selecionar resultado:
  - abrir tarefa
  - fechar dropdown

---

## 10) Performance

- usar debounce no frontend
- limitar resultados no backend
- evitar requisições a cada tecla sem controle
- considerar índice adequado no banco para título e descrição, se necessário

---

## 11) Validação manual

Validar:

- botão de lupa aparece no canto superior direito
- botão funciona em diferentes páginas do sistema
- campo aparece ao clicar na lupa
- `Ctrl + F` abre o campo de busca e foca o campo
- `Ctrl + F` não abre a busca padrão do navegador dentro do sistema
- campo recebe foco automaticamente
- busca acontece enquanto digita
- não precisa pressionar Enter
- resultados aparecem em dropdown abaixo do campo
- busca encontra termos no título
- busca encontra termos na descrição
- busca ignora maiúsculas/minúsculas
- busca vazia não exibe resultados
- estado sem resultados aparece corretamente
- erro aparece corretamente
- clicar em resultado abre a tarefa correta
- dropdown fecha após seleção
- usuário só vê tarefas que tem permissão para acessar

---

## 12) Fora de escopo

- busca em comentários
- busca em subtarefas
- busca em anexos
- busca semântica com IA
- ranking avançado de relevância
