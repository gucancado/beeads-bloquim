import { eq } from "drizzle-orm";
import { maps } from "@workspace/db/schema";

/**
 * Gap #5 — guarda por escopo default. Toda listagem de `maps` filtra
 * kind='action' por padrão; o canvas strategy só é acessível pela rota
 * dedicada (/strategy). Adicione esta condição ao `and(...)` de cada query
 * de listagem de maps. Vira "opte por enxergar strategy" em vez de "lembre
 * de filtrar" — features futuras de maps ficam seguras por construção (§5.2/§12.1).
 */
export const actionMapsScope = eq(maps.kind, "action");
