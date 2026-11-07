/** Above this many faces a body has no exact data (the mesh stands in); above `EXACT_BOXED` no tight box and face areas, for speed. Here alone: the main thread reads them without loading the kernel. */
export const EXACT_MOST = 20000;
export const EXACT_BOXED = 1000;
