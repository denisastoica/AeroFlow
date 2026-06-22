export const LEGACY_DEMO_PHOTO_URL = "https://images.unsplash.com/photo-1510519133417-2ad0cbea7c75?q=80&w=400";

export const DEMO_PROOF_PHOTO_URL = "/demo/pod-demo.png";

export const FALLBACK_PROOF_PHOTO_URL = `data:image/svg+xml;utf8,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 650">
  <rect width="900" height="650" fill="#0f172a"/>
  <rect x="110" y="105" width="680" height="440" rx="28" fill="#111827" stroke="#334155" stroke-width="3"/>
  <path d="M220 450l118-124 106 98 82-78 154 180H220z" fill="#475569"/>
  <circle cx="580" cy="250" r="42" fill="#94a3b8"/>
  <text x="450" y="570" text-anchor="middle" font-size="30" font-family="Segoe UI, Arial, sans-serif" fill="#e2e8f0">Image unavailable</text>
</svg>
`)}`;

export function resolveProofPhotoUrl(url) {
  if (!url || url === LEGACY_DEMO_PHOTO_URL) {
    return DEMO_PROOF_PHOTO_URL;
  }
  return url;
}