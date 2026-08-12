/* tslint:disable */
/* eslint-disable */

export function dispatch_frame(frame_json: string): Promise<void>;

export function init(): void;

/**
 * `entries` is a JS array of `[filename, jsonText]` pairs.
 */
export function init_game_data(entries: any): void;

/**
 * Runs the schema migrations through the driver. The worker calls this after
 * `set_sql_bridge` and before dispatching frames.
 */
export function run_migrations(): Promise<void>;

export function set_emit_callback(cb: Function): void;

/**
 * Lends the engine the worker's `ooz.wasm` Oodle codec, which wasm32 cannot
 * link for itself. `compress(Uint8Array) -> Uint8Array` and
 * `decompress(Uint8Array, uncompressedLength) -> Uint8Array`, both synchronous:
 * the engine calls them from inside a save encode, so the module behind them
 * must already be up.
 */
export function set_oodle_bridge(compress: Function, decompress: Function): void;

export function set_sql_bridge(exec: Function, query: Function): void;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly dispatch_frame: (a: number, b: number) => any;
    readonly init: () => void;
    readonly init_game_data: (a: any) => [number, number];
    readonly run_migrations: () => any;
    readonly set_oodle_bridge: (a: any, b: any) => void;
    readonly set_sql_bridge: (a: any, b: any) => void;
    readonly set_emit_callback: (a: any) => void;
    readonly wasm_bindgen_c6b3917c4fb8628e___convert__closures_____invoke___wasm_bindgen_c6b3917c4fb8628e___JsValue__core_9b3796e30d99ddb7___result__Result_____wasm_bindgen_c6b3917c4fb8628e___JsError___true_: (a: number, b: number, c: any) => [number, number];
    readonly wasm_bindgen_c6b3917c4fb8628e___convert__closures_____invoke___js_sys_2a224707bd42f6b7___Function_fn_wasm_bindgen_c6b3917c4fb8628e___JsValue_____wasm_bindgen_c6b3917c4fb8628e___sys__Undefined___js_sys_2a224707bd42f6b7___Function_fn_wasm_bindgen_c6b3917c4fb8628e___JsValue_____wasm_bindgen_c6b3917c4fb8628e___sys__Undefined_______true_: (a: number, b: number, c: any, d: any) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_destroy_closure: (a: number, b: number) => void;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
