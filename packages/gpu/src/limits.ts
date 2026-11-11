// Limits and feature negotiation (guide §5.2). Ask for what the engine benefits from, capped by what
// the adapter reports: requesting more than the adapter offers rejects the whole device
// (WebGPU §4.3), and the device gets only the *default* limits unless we ask.

export const WANT_LIMITS = Object.freeze({
  maxTextureDimension2D: 16384,
  maxBufferSize: 2 ** 30,                 // 1 GiB
  maxStorageBufferBindingSize: 2 ** 30,
  maxComputeWorkgroupStorageSize: 16384,
});

export const OPTIONAL_FEATURES = ['float32-filterable', 'shader-f16', 'timestamp-query'] as const;

/** Spec default limits (WebGPU §3.6.2), used when an adapter does not report a value. */
export const DEFAULT_LIMITS = Object.freeze({
  maxTextureDimension2D: 8192,
  maxTextureDimension3D: 2048,
  maxBufferSize: 268435456,
  maxStorageBufferBindingSize: 134217728,
  maxComputeWorkgroupStorageSize: 16384,
  maxComputeInvocationsPerWorkgroup: 256,
  maxComputeWorkgroupsPerDimension: 65535,
  maxUniformBufferBindingSize: 65536,
});

export interface AdapterLike {
  limits: Record<string, number> | GPUSupportedLimits;
  features: ReadonlySet<string> | GPUSupportedFeatures;
}

export interface Negotiated {
  requiredLimits: Record<string, number>;
  requiredFeatures: GPUFeatureName[];
}

export function negotiate(adapter: AdapterLike, want: Record<string, number> = WANT_LIMITS): Negotiated {
  const requiredLimits: Record<string, number> = {};
  const lim = adapter.limits as unknown as Record<string, number | undefined>;
  for (const [k, v] of Object.entries(want)) {
    const have = lim[k];
    if (typeof have !== 'number') continue; // never ask for a limit the adapter did not report
    requiredLimits[k] = Math.min(v, have);
  }
  const requiredFeatures = OPTIONAL_FEATURES.filter((f) => adapter.features.has(f)) as GPUFeatureName[];
  return { requiredLimits, requiredFeatures };
}
