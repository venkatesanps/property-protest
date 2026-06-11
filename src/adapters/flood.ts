/**
 * FEMA National Flood Hazard Layer (NFHL) adapter
 *
 * Uses FEMA's public ArcGIS REST service — no API key, CORS-enabled for
 * browser fetch (tested: access-control-allow-origin is returned).
 *
 * Flood zone affects market value and can support a §41.43(a) protest:
 * properties in SFHA (Zone AE/A/AH/AO) must carry flood insurance and
 * typically sell 5–15% below comparable non-flood homes.
 *
 * Source: https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28
 */

export interface FloodZoneResult {
  zone: string;          // e.g. "AE", "X", "AH"
  sfha: boolean;         // Special Flood Hazard Area (high risk)
  description: string;   // human-readable label
  firmPanelUrl: string;  // deep link to FEMA's interactive FIRM map
}

const FEMA_URL =
  'https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query';

const ZONE_DESCRIPTIONS: Record<string, string> = {
  A:   'High risk - Special Flood Hazard Area (no base flood elevation)',
  AE:  'High risk - Special Flood Hazard Area (base flood elevation mapped)',
  AH:  'High risk - Shallow flooding with ponding (1-3 ft depth)',
  AO:  'High risk - Shallow flooding with sheet flow (1-3 ft depth)',
  AR:  'High risk - Temporarily reduced flood risk (levee under construction)',
  'A99': 'High risk - Protected by federal flood control project',
  X:   'Minimal to moderate flood hazard',
  D:   'Undetermined flood hazard',
};

function describeZone(zone: string, subty: string | null): string {
  if (ZONE_DESCRIPTIONS[zone]) return ZONE_DESCRIPTIONS[zone];
  if (zone.startsWith('A')) return 'High risk - Special Flood Hazard Area';
  if (subty?.includes('MINIMAL')) return 'Minimal flood hazard';
  if (subty?.includes('MODERATE')) return 'Moderate flood hazard (0.2% annual chance)';
  return `Flood zone ${zone}`;
}

export async function fetchFloodZone(
  lat: number,
  lng: number
): Promise<FloodZoneResult | null> {
  if (!lat || !lng) return null;
  try {
    const url = new URL(FEMA_URL);
    url.searchParams.set('geometry', `${lng},${lat}`);
    url.searchParams.set('geometryType', 'esriGeometryPoint');
    url.searchParams.set('spatialRel', 'esriSpatialRelIntersects');
    url.searchParams.set('outFields', 'FLD_ZONE,SFHA_TF,ZONE_SUBTY');
    url.searchParams.set('returnGeometry', 'false');
    url.searchParams.set('f', 'json');

    const resp = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
    if (!resp.ok) return null;

    const data = (await resp.json()) as {
      features?: { attributes: { FLD_ZONE: string; SFHA_TF: string; ZONE_SUBTY: string } }[];
    };

    const attrs = data.features?.[0]?.attributes;
    if (!attrs) return null;

    const zone = (attrs.FLD_ZONE ?? 'X').trim();
    const sfha = attrs.SFHA_TF === 'T';
    const subty = attrs.ZONE_SUBTY ?? null;

    return {
      zone,
      sfha,
      description: describeZone(zone, subty),
      firmPanelUrl: `https://msc.fema.gov/portal/search#searchresultsanchor?addressQueryString=${lat},${lng}`,
    };
  } catch {
    return null;
  }
}
