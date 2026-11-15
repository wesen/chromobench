// @chromobench/values: the builder core (CHB-035 design §30, §24, §26). A dependency-free leaf: immutable values
// and canonical JSON, modifiers, explain and call-site provenance, the collection idiom, the four mutations over a
// JSON document with id-addressed paths, and transactions. It knows nothing about images or interfaces.
export { VALUE_ERROR_CODES, ValueError, type ValueDiag, type ValueErrorCode } from './errors.ts';
export {
  assertJson, canonicalJSON, deepFreeze, equal, isDeepFrozen, isJson, isPlainObject, jsonProblem,
  type Frozen, type Json, type JsonObject,
} from './json.ts';
export { captureSites, libraryRoot, site, where, type CallSite } from './site.ts';
export { EXPLAIN, explain, isExplainable, type Explainable } from './explain.ts';
export { apply, assign, compose, field, identity, isModifier, modifier, toModifier, type Modifier, type With } from './modifier.ts';
export {
  dataOf, defineValue, isValue,
  type Methods, type TrailStep, type Value, type ValueKind, type ValueOf, type ValueOptions,
} from './value.ts';
export { Coll, isId, type Id } from './coll.ts';
export {
  DocIndex, canonicalPath, document, freshId, getPath, indexOf, resolvePath,
  type Location, type Resolved, type Seg,
} from './doc.ts';
export {
  MUTATION_OPS, applyMutation, insert, move, remove, set, unset,
  type Applied, type ApplyOptions, type Change, type Mutation, type Validator,
} from './mutations.ts';
export {
  applyTransaction, invertTransaction, revertTransaction, transaction, tryTransaction,
  type Author, type Transaction, type TransactionInit, type TxApplied, type TxOptions, type TxResult, type TxStatus,
} from './transactions.ts';
