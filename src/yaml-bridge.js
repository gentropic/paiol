// paiol — JS value <-> @gcu/yaml bridge.
//
// @gcu/yaml is AST-based (parse -> AST, emit -> canonical string); it deliberately ships
// no JS-value convenience layer. paiol's at-rest format (§5) is one diffable YAML document,
// so we need plain-object <-> YAML. This is that thin, total bridge over the AST factories.
//
// The strict-YAML guarantees carry through: every scalar is explicitly typed, nothing is
// implicitly coerced, the output round-trips identically through vanilla YAML parsers.

import { parse, emit, scalar, mapNode, seqNode } from '../vendor/@gcu/yaml/index.js';

/**
 * Convert a JSON-like JS value into a @gcu/yaml AST node.
 * Supported: null/undefined, boolean, finite number, string, array, plain object.
 * Object properties whose value is `undefined` are omitted (matches optional fields).
 * @param {*} value
 * @returns {object} AST node
 */
export function toNode(value) {
  if (value === null || value === undefined) return scalar('null', null);
  const t = typeof value;
  if (t === 'boolean') return scalar('bool', value);
  if (t === 'number') {
    if (!Number.isFinite(value)) throw new YamlBridgeError(`numero nao-finito: ${value}`);
    return Number.isInteger(value) ? scalar('int', value) : scalar('float', value);
  }
  if (t === 'string') return scalar('string', value);
  if (Array.isArray(value)) return seqNode(value.map(toNode));
  if (t === 'object') {
    const entries = [];
    for (const [k, v] of Object.entries(value)) {
      if (v === undefined) continue;
      entries.push({ key: scalar('string', k), value: toNode(v) });
    }
    return mapNode(entries);
  }
  throw new YamlBridgeError(`tipo nao serializavel: ${t}`);
}

/**
 * Convert a @gcu/yaml AST node back into a plain JS value.
 * @param {object} node
 * @returns {*}
 */
export function fromNode(node) {
  switch (node.kind) {
    case 'scalar':
      return node.value; // parser already produced the typed JS primitive
    case 'seq':
      return node.items.map(fromNode);
    case 'map': {
      /** @type {Record<string, *>} */
      const obj = {};
      for (const e of node.entries) obj[e.key.value] = fromNode(e.value);
      return obj;
    }
    default:
      throw new YamlBridgeError(`no desconhecido: ${node.kind}`);
  }
}

/**
 * Serialize a JS value to canonical strict-YAML text.
 * @param {*} value
 * @returns {string}
 */
export function toYaml(value) {
  const out = emit(toNode(value));
  return typeof out === 'string' ? out : new TextDecoder().decode(out);
}

/**
 * Parse strict-YAML text into a JS value. Throws YamlParseError on malformed input.
 * @param {string} text
 * @returns {*}
 */
export function fromYaml(text) {
  return fromNode(parse(text));
}

export class YamlBridgeError extends Error {
  constructor(message) {
    super(message);
    this.name = 'YamlBridgeError';
  }
}
