# Padronizar títulos e breadcrumbs das páginas

## Objetivo

Limpar visualmente as telas do Bloquim, removendo os títulos grandes das páginas e usando apenas uma linha discreta de navegação no topo, no mesmo padrão visual do texto atual:

```txt
espaços de trabalho / geral
```

A ideia é deixar a interface mais leve, com menos redundância visual e mais foco no conteúdo principal.

---

## 1) Regra geral de layout

- Remover os títulos grandes das páginas
- Manter apenas um título/breadcrumb pequeno no topo
- O breadcrumb deve usar o mesmo padrão visual atualmente usado em:

```txt
espaços de trabalho / geral
```

### Estilo esperado

- fonte menor
- peso visual leve
- cor discreta
- espaçamento consistente
- separador `/`
- sem destaque excessivo
- sem duplicação com título grande abaixo

---

## 2) Páginas que devem seguir o novo padrão

Aplicar a padronização nas seguintes telas:

- `tarefas`
- `espaços de trabalho`
- `espaços de trabalho / nome do espaço de trabalho`
- `espaços de trabalho / nome do espaço de trabalho / membros`
- `espaços de trabalho / nome do espaço de trabalho / tarefas`
- `espaços de trabalho / nome do espaço de trabalho / planos`
- `nome do espaço de trabalho / nome do plano`
- `perfil`
- `modelos de tarefas`
- `integrações`

---

## 3) Remoção dos títulos grandes

Remover ou ocultar os títulos grandes atualmente exibidos nas páginas, como por exemplo:

- título grande do espaço de trabalho
- título grande da página de tarefas
- título grande de subpáginas
- título grande da página de perfil
- título grande da página de modelos de tarefas
- título grande da página de integrações

### Regra

- não deve haver duplicação entre:
  - breadcrumb pequeno no topo
  - título grande da página

Se a informação já aparece no breadcrumb, não deve aparecer novamente como título grande.

---

## 4) Breadcrumbs esperados por página

### Página de tarefas

Exibir:

```txt
tarefas
```

---

### Página geral de espaços de trabalho

Exibir:

```txt
espaços de trabalho
```

---

### Página de um espaço de trabalho

Exibir:

```txt
espaços de trabalho / nome do espaço de trabalho
```

---

### Página de membros de um espaço de trabalho

Exibir:

```txt
espaços de trabalho / nome do espaço de trabalho / membros
```

---

### Página de tarefas de um espaço de trabalho

Exibir:

```txt
espaços de trabalho / nome do espaço de trabalho / tarefas
```

---

### Página de planos de um espaço de trabalho

Exibir:

```txt
espaços de trabalho / nome do espaço de trabalho / planos
```

---

### Página de um plano

Exibir:

```txt
nome do espaço de trabalho / nome do plano
```

---

### Página de perfil

Exibir:

```txt
perfil
```

---

### Página de modelos de tarefas

Exibir:

```txt
modelos de tarefas
```

---

### Página de integrações

Exibir:

```txt
integrações
```

---

## 5) Comportamento do botão de configurações

Não criar uma página geral de configurações neste momento.

### Comportamento esperado

- ao clicar no botão de configurações:
  - abrir um menu dropdown
  - não navegar para uma página de configurações

### Opções do dropdown

O menu deve conter as opções:

- `perfil`
- `modelos de tarefas`
- `integrações`

### Comportamento das opções

- ao clicar em `perfil`:
  - navegar para a página de perfil

- ao clicar em `modelos de tarefas`:
  - navegar para a página de modelos de tarefas

- ao clicar em `integrações`:
  - navegar para a página de integrações

### Regras visuais

- manter o padrão visual do sistema
- dropdown deve aparecer próximo ao botão de configurações
- dropdown deve fechar ao:
  - clicar em uma opção
  - clicar fora do menu
  - pressionar `ESC`

---

## 6) Comportamento dos itens do breadcrumb

- quando fizer sentido, os itens anteriores do breadcrumb devem ser clicáveis
- exemplo:

```txt
espaços de trabalho / geral / membros
```

- `espaços de trabalho` deve levar para a lista de espaços
- `geral` deve levar para a página principal do espaço
- `membros` é o item atual e não precisa ser clicável

### Regras

- item atual:
  - não clicável
  - visualmente um pouco mais destacado

- itens anteriores:
  - clicáveis
  - com hover discreto

---

## 7) Consistência visual

Criar ou reutilizar um componente padrão de breadcrumb/título de página, se já existir.

Sugestão de componente:

```txt
PageBreadcrumb
```

Esse componente deve receber uma lista de itens:

```txt
[
  { label: "espaços de trabalho", href: "/workspaces" },
  { label: "geral" }
]
```

### Benefícios

- evita duplicação de código
- mantém padrão visual em todas as páginas
- facilita ajustes futuros de design

---

## 8) Responsividade

- em telas menores, evitar quebra visual excessiva
- se o breadcrumb ficar muito longo:
  - permitir truncamento do item intermediário
  - manter o item atual legível

Exemplo:

```txt
espaços de trabalho / ... / membros
```

---

## 9) Validação manual

Validar que:

- os títulos grandes foram removidos das páginas indicadas
- cada página mostra apenas o breadcrumb pequeno no topo
- a fonte e estilo seguem o padrão de `espaços de trabalho / geral`
- não há duplicação de informação
- os breadcrumbs mostram a hierarquia correta
- links dos breadcrumbs funcionam quando aplicável
- layout ficou mais limpo e sem espaços vazios desnecessários
- páginas continuam responsivas
- botão de configurações abre dropdown em vez de navegar para página de configurações
- dropdown contém `perfil`, `modelos de tarefas` e `integrações`
- dropdown fecha ao clicar fora, selecionar opção ou pressionar `ESC`

---

## 10) Fora de escopo

- não alterar menu lateral além do comportamento do botão de configurações
- não criar página geral de configurações
- não alterar estrutura de permissões
- não redesenhar cards, listas ou tabs
- não alterar funcionalidades internas das páginas

A alteração deve focar apenas na padronização de títulos/breadcrumbs, remoção dos títulos grandes e ajuste do botão de configurações para abrir um dropdown.
