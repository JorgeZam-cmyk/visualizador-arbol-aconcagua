import type { ExcelRow, TreeNode, TreeStats, Warning } from './types';

/**
 * Normaliza códigos: trim, mayúsculas, elimina filas vacías.
 */
function normalizeCode(raw: string): string {
  return raw.trim().toUpperCase();
}

export function normalizeRows(rows: ExcelRow[]): ExcelRow[] {
  const map = new Map<string, string>();
  const result: ExcelRow[] = [];
  for (const row of rows) {
    const code = normalizeCode(row.code);
    if (!code) continue;
    if (!map.has(code)) {
      map.set(code, row.description.trim());
      result.push({ code, description: row.description.trim() });
    }
  }
  return result;
}

/**
 * Cuenta guiones en un código.
 */
export function countHyphens(code: string): number {
  return (code.match(/-/g) || []).length;
}

/**
 * Determina el código padre según las reglas del negocio.
 */
export function findParentCode(
  code: string,
  codeSet: Set<string>
): string | null {
  const hyphens = countHyphens(code);

  if (hyphens >= 2) {
    // Buscar el padre existente más cercano.
    // Si existen varios prefijos posibles, elegir el más largo.
    const possibleParents = Array.from(codeSet)
      .filter((candidate) =>
        candidate !== code &&
        code.startsWith(candidate)
      )
      .sort((a, b) => b.length - a.length);

    if (possibleParents.length > 0) {
      return possibleParents[0];
    }

    const secondHyphenIndex = code.indexOf(
      '-',
      code.indexOf('-') + 1
    );

    if (secondHyphenIndex !== -1) {
      const parentBySecondHyphen =
        code.substring(0, secondHyphenIndex);

      if (codeSet.has(parentBySecondHyphen)) {
        return parentBySecondHyphen;
      }

      return reduceByTwoChars(parentBySecondHyphen, codeSet);
    }
  }

  if (hyphens === 1) {
    return reduceByTwoChars(code, codeSet);
  }

  return null;
}

/**
 * Reduce el lado derecho del código en bloques de 2 caracteres buscando padre existente.
 */
function reduceByTwoChars(code: string, codeSet: Set<string>): string | null {
  const hyphenIndex = code.indexOf('-');
  if (hyphenIndex === -1) return null;

  const left = code.substring(0, hyphenIndex + 1);
  let right = code.substring(hyphenIndex + 1);

  // Si el código original está en el set, tratamos de encontrar su padre
  // quitando bloques de 2 caracteres del lado derecho
  while (right.length > 0) {
    right = right.slice(0, -2);
    const candidate = left + right;
    if (candidate === left.substring(0, left.length - 1)) continue; // solo el prefijo con guión
    if (codeSet.has(candidate)) {
      return candidate;
    }
    // Si el candidato solo tiene el prefijo (ej: "CB-"), no seguir reduciendo
    if (right.length <= 2) break;
  }

  // Último intento: solo el prefijo (sin último carácter si termina en guión)
  const justPrefix = code.substring(0, hyphenIndex);
  if (codeSet.has(justPrefix)) {
    return justPrefix;
  }

  return null;
}

/**
 * Construye el árbol a partir de las filas normalizadas.
 */
export function buildTree(normalizedRows: ExcelRow[]): {
  tree: TreeNode[];
  stats: TreeStats;
  warnings: Warning[];
} {
  const warnings: Warning[] = [];
  const codeSet = new Set(normalizedRows.map((r) => r.code));
  const codeMap = new Map<string, ExcelRow>();
  for (const row of normalizedRows) {
    codeMap.set(row.code, row);
  }

  // Detectar duplicados (en los datos originales)
  const seen = new Map<string, number>();
  for (const row of normalizedRows) {
    seen.set(row.code, (seen.get(row.code) || 0) + 1);
  }
  for (const [code, count] of seen) {
    if (count > 1) {
      warnings.push({
        type: 'duplicate',
        code,
        message: `Código duplicado: ${code} (${count} ocurrencias)`,
      });
    }
  }

  // Detectar códigos sin descripción
  for (const row of normalizedRows) {
    if (!row.description) {
      warnings.push({
        type: 'noDescription',
        code: row.code,
        message: `Código sin descripción: ${row.code}`,
      });
    }
  }

  // Construir nodos
  const nodeMap = new Map<string, TreeNode>();
  const orphanCodes: string[] = [];

  // Primera pasada: crear todos los nodos
  for (const row of normalizedRows) {
    const hyphens = countHyphens(row.code);
    const parentCode = findParentCode(row.code, codeSet);
    const isSuffixChild = hyphens >= 2
      ? codeSet.has(row.code.slice(0, -3))
      : false;

    const node: TreeNode = {
      id: row.code,
      code: row.code,
      description: row.description,
      children: [],
      parentId: null,
      hyphenCount: hyphens,
      isSuffixChild,
      isRoot: false,
      isOrphan: false,
      depth: 0,
    };
    nodeMap.set(row.code, node);

    if (!parentCode) {
      orphanCodes.push(row.code);
    }
  }

  // Segunda pasada: establecer relaciones padre-hijo
  for (const row of normalizedRows) {
    const node = nodeMap.get(row.code)!;
    const parentCode = findParentCode(row.code, codeSet);

    if (parentCode && nodeMap.has(parentCode)) {
      const parent = nodeMap.get(parentCode)!;
      parent.children.push(node);
      node.parentId = parentCode;
    } else {
      node.isOrphan = true;
    }
  }

  // Calcular profundidades
  function setDepth(node: TreeNode, depth: number) {
    node.depth = depth;
    for (const child of node.children) {
      setDepth(child, depth + 1);
    }
  }

  // Raíz virtual
  const virtualRoot: TreeNode = {
    id: '__root__',
    code: 'Estructura cargada',
    description: 'Raíz virtual',
    children: [],
    parentId: null,
    hyphenCount: 0,
    isSuffixChild: false,
    isRoot: true,
    isOrphan: false,
    depth: 0,
  };

  // Colgar huérfanos bajo raíz virtual
  for (const code of orphanCodes) {
    const node = nodeMap.get(code)!;
    virtualRoot.children.push(node);
    node.parentId = '__root__';
    node.isOrphan = true;
    setDepth(node, 1);
  }

  // Colgar nodos no-huérfanos que son raíces (sin padre) bajo raíz virtual
  for (const row of normalizedRows) {
    const node = nodeMap.get(row.code)!;
    if (node.parentId === null && !node.isOrphan) {
      // No debería ocurrir con la lógica actual, pero por si acaso
    }
    if (node.parentId && nodeMap.has(node.parentId)) {
      // Ya asignado
    } else if (!node.isOrphan) {
      // No tiene padre pero tiene parentCode que no existe -> huérfano
      node.isOrphan = true;
      node.parentId = '__root__';
      virtualRoot.children.push(node);
      setDepth(node, 1);
    }
  }

  // Advertencia de nodos sin padre
  for (const code of orphanCodes) {
    warnings.push({
      type: 'noParent',
      code,
      message: `Código sin padre encontrado: ${code}`,
    });
  }

  // Calcular estadísticas
  const stats: TreeStats = {
    total: nodeMap.size,
    zeroHyphen: 0,
    oneHyphen: 0,
    twoHyphen: 0,
    suffixComponents: 0,
    duplicates: 0,
    orphans: orphanCodes.length,
    maxDepth: 0,
  };

  for (const node of nodeMap.values()) {
    if (node.hyphenCount === 0) stats.zeroHyphen++;
    else if (node.hyphenCount === 1) stats.oneHyphen++;
    else if (node.hyphenCount >= 2) stats.twoHyphen++;
    if (node.isSuffixChild) stats.suffixComponents++;
    if (node.depth > stats.maxDepth) stats.maxDepth = node.depth;
  }

  for (const [, count] of seen) {
    if (count > 1) stats.duplicates += count - 1;
  }

  return {
    tree: [virtualRoot],
    stats,
    warnings,
  };
}

/**
 * Busca nodos por código o descripción.
 */
export function searchTree(
  nodes: TreeNode[],
  term: string
): TreeNode[] {
  if (!term) return [];
  const lowerTerm = term.toLowerCase();
  const results: TreeNode[] = [];

  function traverse(node: TreeNode) {
    if (
      node.code.toLowerCase().includes(lowerTerm) ||
      node.description.toLowerCase().includes(lowerTerm)
    ) {
      results.push(node);
    }
    for (const child of node.children) {
      traverse(child);
    }
  }

  for (const node of nodes) {
    traverse(node);
  }

  return results;
}

/**
 * Obtiene el breadcrumb de un nodo.
 */
export function getBreadcrumb(
  nodeId: string,
  nodes: TreeNode[]
): TreeNode[] {
  const allNodes = new Map<string, TreeNode>();
  function collect(n: TreeNode) {
    allNodes.set(n.id, n);
    for (const c of n.children) collect(c);
  }
  for (const n of nodes) collect(n);

  const breadcrumb: TreeNode[] = [];
  let current = allNodes.get(nodeId);
  while (current) {
    breadcrumb.unshift(current);
    current = current.parentId ? allNodes.get(current.parentId) ?? null : null;
  }
  return breadcrumb;
}

/**
 * Exporta el árbol a JSON.
 */
export function exportToJSON(nodes: TreeNode[]): string {
  function serialize(node: TreeNode): any {
    return {
      code: node.code,
      description: node.description,
      hyphenCount: node.hyphenCount,
      isSuffixChild: node.isSuffixChild,
      isOrphan: node.isOrphan,
      isRoot: node.isRoot,
      children: node.children.map((c) => serialize(c)),
    };
  }
  return JSON.stringify(nodes.map((n) => serialize(n)), null, 2);
}
