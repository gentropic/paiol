// paiol — units & conversions (§3).
//
// Two layers:
//   1. Built-in dimensions (mass, volume, count) with fixed ratios. Pure arithmetic.
//   2. Per-ingredient overrides that BRIDGE dimensions (`1 ovo = 50 g`,
//      `1 xicara = 120 g`). These are the first-class detail naive tools miss.
//
// We deliberately do NOT lean on @gcu/units here: it covers the built-in dimensions
// (and a lot of geoscience we don't need) but not the per-ingredient bridge, which is
// the actual hard part and is paiol-specific. Keeping the engine dependency-free keeps
// it trivially testable. Revisit if we ever want @gcu/units' breadth.

/**
 * Built-in unit ratios, expressed as "how many base units in one of this unit",
 * where the base unit of each dimension is the first listed (g, ml, un).
 * @type {Record<string, Record<string, number>>}
 */
const DIMENSIONS = {
  mass:   { g: 1, mg: 0.001, kg: 1000 },
  volume: { ml: 1, l: 1000 },
  count:  { un: 1 },
};

/** unit → its dimension name, for built-in units. */
const UNIT_DIMENSION = (() => {
  /** @type {Record<string, string>} */
  const m = {};
  for (const [dim, units] of Object.entries(DIMENSIONS)) {
    for (const u of Object.keys(units)) m[u] = dim;
  }
  return m;
})();

/** @returns {boolean} whether `u` is a known built-in unit. */
export function isBuiltinUnit(u) {
  return Object.prototype.hasOwnProperty.call(UNIT_DIMENSION, u);
}

/**
 * Build the adjacency for an ingredient's conversion graph: built-in within-dimension
 * edges plus the ingredient's overrides, all bidirectional. Edge weight is the
 * multiplicative factor to apply when going from node A to node B (qty_B = qty_A * w).
 *
 * @param {import('./domain.js').Conversion[]} [overrides]
 * @returns {Map<string, Array<{ to: string, factor: number }>>}
 */
function buildGraph(overrides = []) {
  /** @type {Map<string, Array<{ to: string, factor: number }>>} */
  const adj = new Map();
  const addEdge = (from, to, factor) => {
    if (!adj.has(from)) adj.set(from, []);
    adj.get(from).push({ to, factor });
  };

  // Built-in edges: within each dimension, link every unit to the base and back.
  // 1 unit = ratio base-units, so going unit→base multiplies by ratio.
  for (const units of Object.values(DIMENSIONS)) {
    const entries = Object.entries(units);
    const [base] = entries[0]; // base has ratio 1
    for (const [u, ratio] of entries) {
      if (u === base) continue;
      addEdge(u, base, ratio);
      addEdge(base, u, 1 / ratio);
    }
  }

  // Override edges: `1 from = factor to` → from→to multiplies by factor.
  for (const c of overrides) {
    if (!c || c.factor === 0 || !isFinite(c.factor)) continue;
    addEdge(c.from, c.to, c.factor);
    addEdge(c.to, c.from, 1 / c.factor);
  }

  return adj;
}

/**
 * Convert `qty` from unit `from` to unit `to`, using built-in dimensions plus any
 * per-ingredient `overrides`. Finds a path through the conversion graph (BFS — shortest
 * hop count, which is also the least-surprising bridge). Throws if no path exists.
 *
 * @param {number} qty
 * @param {import('./domain.js').Unit} from
 * @param {import('./domain.js').Unit} to
 * @param {import('./domain.js').Conversion[]} [overrides]
 * @returns {number}
 */
export function convert(qty, from, to, overrides = []) {
  if (from === to) return qty;

  const adj = buildGraph(overrides);
  // BFS from `from`, accumulating the multiplicative factor along the path.
  /** @type {Array<{ node: string, factor: number }>} */
  const queue = [{ node: from, factor: 1 }];
  const seen = new Set([from]);

  while (queue.length) {
    const { node, factor } = queue.shift();
    if (node === to) return qty * factor;
    for (const edge of adj.get(node) || []) {
      if (seen.has(edge.to)) continue;
      seen.add(edge.to);
      queue.push({ node: edge.to, factor: factor * edge.factor });
    }
  }

  throw new ConversionError(from, to);
}

export class ConversionError extends Error {
  /** @param {string} from @param {string} to */
  constructor(from, to) {
    super(
      `Sem conversao de "${from}" para "${to}". ` +
      `Defina uma conversao no insumo (ex.: 1 ${from} = X ${to}).`,
    );
    this.name = 'ConversionError';
    this.from = from;
    this.to = to;
  }
}
