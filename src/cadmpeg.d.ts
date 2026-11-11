declare module 'cadmpeg.wasm' {
  type Loss = { severity: 'info' | 'warning' | 'error'; message: string };
  export function load(source?: URL | string | BufferSource | WebAssembly.Module): Promise<WebAssembly.Module>;
  export function convert(name: string, data: Uint8Array, to?: string, ...flags: string[]): Promise<{ data: Uint8Array; report: { decode_report: { losses: Loss[] }; export: { losses: Loss[] } }; log: string }>;
}
