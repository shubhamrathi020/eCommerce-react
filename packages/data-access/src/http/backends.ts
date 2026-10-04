/**
 * The backends the apps can talk to. Every real one serves the same API on the same databases, so choosing between them changes only
 * the address. VITE_API_BASE_URL overrides it.
 */
export const BACKENDS = {
  nest: { label: 'NestJS (eCommerce-api)', url: 'http://localhost:3333' },
  go: { label: 'Go (eCommerce-go)', url: 'http://localhost:3334' },
  node: { label: 'Node (eCommerce-node)', url: 'http://localhost:3335' },
  dotnet: { label: '.NET (eCommerce-dotnet)', url: 'http://localhost:3336' },
} as const;

export type BackendName = keyof typeof BACKENDS;

export interface ResolvedBackend {
  /** Whether a real API is used at all (anything but the in-browser mock). */
  real: boolean;
  /** The API address to use when VITE_API_BASE_URL is not set. */
  url: string;
}

/** Reads the VITE_BACKEND value: mock (the default, also for an unknown value) or one of {@link BACKENDS}. */
export function resolveBackend(name: string | undefined): ResolvedBackend {
  const known = name !== undefined && Object.prototype.hasOwnProperty.call(BACKENDS, name);
  return known ? { real: true, url: BACKENDS[name as BackendName].url } : { real: false, url: BACKENDS.nest.url };
}
