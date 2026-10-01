#!/usr/bin/env node

/**
 * Rebuild assets/data/cosmos-real-data.js from authoritative NASA/JPL APIs.
 *
 * Requirements: Node.js 18+ with network access. The output is written only
 * after every response has parsed and the complete dataset has passed the
 * validation checks at the bottom of this file.
 */

import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const OUTPUT_URL = new URL('../assets/data/cosmos-real-data.js', import.meta.url);
const OUTPUT_PATH = fileURLToPath(OUTPUT_URL);

const HORIZONS_ENDPOINT = 'https://ssd.jpl.nasa.gov/api/horizons.api';
const HORIZONS_DOCS = 'https://ssd-api.jpl.nasa.gov/doc/horizons.html';
const JPL_PHYSICAL_PARAMETERS = 'https://ssd.jpl.nasa.gov/planets/phys_par.html';
const NASA_SUN_FACT_SHEET = 'https://nssdc.gsfc.nasa.gov/planetary/factsheet/sunfact.html';
const EXOPLANET_TAP_ENDPOINT = 'https://exoplanetarchive.ipac.caltech.edu/TAP/sync';
const EXOPLANET_TAP_DOCS = 'https://exoplanetarchive.ipac.caltech.edu/docs/TAP/usingTAP.html';
const EXOPLANET_COLUMN_DOCS = 'https://exoplanetarchive.ipac.caltech.edu/docs/API_PS_columns.html';

const START_TIME = '2026-01-01';
const STOP_TIME = '2031-01-01';
const STEP_SIZE = '10 d';
const EXPECTED_SOLAR_BODY_COUNT = 9;
const EXPECTED_TRAPPIST_BODY_COUNT = 7;

// Physical metadata is distinct from ephemeris state vectors. Planet masses
// and mean radii are from JPL's Planetary Physical Parameters table; the Sun's
// mass and mean radius are from the NASA NSSDCA Sun Fact Sheet. massSolar is a
// derived ratio and is not used to modify the Horizons vectors.
const SUN_MASS_1E24_KG = 1_988_400;
const SOLAR_BODIES = [
  { id: 'sun', name: 'Sun', type: 'star', targetId: '10', mass1e24Kg: SUN_MASS_1E24_KG, radiusKm: 695_700 },
  { id: 'mercury', name: 'Mercury', type: 'planet', targetId: '199', mass1e24Kg: 0.330103, radiusKm: 2439.4 },
  { id: 'venus', name: 'Venus', type: 'planet', targetId: '299', mass1e24Kg: 4.86731, radiusKm: 6051.8 },
  { id: 'earth', name: 'Earth', type: 'planet', targetId: '399', mass1e24Kg: 5.97217, radiusKm: 6371.0084 },
  { id: 'mars', name: 'Mars', type: 'planet', targetId: '499', mass1e24Kg: 0.641691, radiusKm: 3389.5 },
  { id: 'jupiter', name: 'Jupiter', type: 'planet', targetId: '599', mass1e24Kg: 1898.125, radiusKm: 69911 },
  { id: 'saturn', name: 'Saturn', type: 'planet', targetId: '699', mass1e24Kg: 568.317, radiusKm: 58232 },
  { id: 'uranus', name: 'Uranus', type: 'planet', targetId: '799', mass1e24Kg: 86.8099, radiusKm: 25362 },
  { id: 'neptune', name: 'Neptune', type: 'planet', targetId: '899', mass1e24Kg: 102.4092, radiusKm: 24622 },
];

// These constants are curated presentation choices, not measurements. They are
// copied into the output separately from API-sourced and derived fields.
const SOLAR_VISUALS = {
  sun: { color: '#fff1bd', atmosphere: { color: '#78a9ff', haloScale: 2.8, visualOnly: true } },
  mercury: { color: '#b8ada2' },
  venus: { color: '#e8c27a', atmosphere: { color: '#e9b86f', haloScale: 1.16, visualOnly: true } },
  earth: { color: '#62a8ff', atmosphere: { color: '#8bdcff', haloScale: 1.13, visualOnly: true } },
  mars: { color: '#d77952', atmosphere: { color: '#d9977b', haloScale: 1.05, visualOnly: true } },
  jupiter: { color: '#d8b08c', atmosphere: { color: '#d9c0a4', haloScale: 1.04, visualOnly: true } },
  saturn: {
    color: '#e7d39a',
    atmosphere: { color: '#eadcad', haloScale: 1.04, visualOnly: true },
    rings: { color: '#d8c79a', innerRadiusScale: 1.35, outerRadiusScale: 2.15, opacity: 0.55, visualOnly: true },
  },
  uranus: { color: '#8bdde7', atmosphere: { color: '#a3e9ee', haloScale: 1.06, visualOnly: true } },
  neptune: { color: '#5f7cff', atmosphere: { color: '#7898ff', haloScale: 1.08, visualOnly: true } },
};

const TRAPPIST_VISUALS = [
  '#ffb45f', '#f48f62', '#df786f', '#c97fb9', '#a589ee', '#79a6f6', '#70d8dc',
];

const TAP_COLUMNS = [
  'pl_name', 'hostname', 'pl_letter', 'default_flag',
  'pl_orbper', 'pl_orbpererr1', 'pl_orbpererr2',
  'pl_orbsmax', 'pl_orbsmaxerr1', 'pl_orbsmaxerr2',
  'pl_rade', 'pl_radeerr1', 'pl_radeerr2',
  'pl_bmasse', 'pl_bmasseerr1', 'pl_bmasseerr2', 'pl_bmassprov',
  'pl_orbeccen', 'pl_orbeccenerr1', 'pl_orbeccenerr2',
  'st_mass', 'st_masserr1', 'st_masserr2',
  'st_rad', 'st_raderr1', 'st_raderr2',
  'st_teff', 'st_tefferr1', 'st_tefferr2',
  'pl_refname', 'releasedate', 'rowupdate',
];

const TAP_QUERY = `select ${TAP_COLUMNS.join(',')} from ps where hostname='TRAPPIST-1' and default_flag=1 order by pl_orbper`;

function quoted(value) {
  return `'${value}'`;
}

function makeHorizonsUrl(targetId) {
  const params = new URLSearchParams({
    format: 'json',
    COMMAND: quoted(targetId),
    OBJ_DATA: quoted('NO'),
    MAKE_EPHEM: quoted('YES'),
    EPHEM_TYPE: quoted('VECTORS'),
    CENTER: quoted('500@0'),
    START_TIME: quoted(START_TIME),
    STOP_TIME: quoted(STOP_TIME),
    STEP_SIZE: quoted(STEP_SIZE),
    REF_SYSTEM: quoted('ICRF'),
    REF_PLANE: quoted('ECLIPTIC'),
    OUT_UNITS: quoted('AU-D'),
    VEC_TABLE: quoted('2'),
    VEC_CORR: quoted('NONE'),
    CAL_TYPE: quoted('GREGORIAN'),
    CSV_FORMAT: quoted('YES'),
    VEC_LABELS: quoted('NO'),
    VEC_DELTA_T: quoted('NO'),
  });
  return `${HORIZONS_ENDPOINT}?${params.toString()}`;
}

function makeTapUrl() {
  const params = new URLSearchParams({ query: TAP_QUERY, format: 'json' });
  return `${EXOPLANET_TAP_ENDPOINT}?${params.toString()}`;
}

async function fetchJson(url, label) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45_000);
    try {
      const response = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'Jeremy-Foss-Cosmos-Portfolio-Data/1.0',
        },
        signal: controller.signal,
      });
      const text = await response.text();
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 300)}`);
      try {
        return JSON.parse(text);
      } catch (error) {
        throw new Error(`Response was not JSON: ${text.slice(0, 300)}`, { cause: error });
      }
    } catch (error) {
      lastError = error;
      if (attempt < 3) await delay(500 * 2 ** (attempt - 1));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error(`${label} failed after 3 attempts: ${lastError?.message || lastError}`, { cause: lastError });
}

function parseHorizonsCalendar(raw) {
  const cleaned = String(raw).replace(/^\s*A\.D\.\s*/, '').replace(/^"|"$/g, '').trim();
  const match = cleaned.match(/^(\d{4})-([A-Za-z]{3})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?$/);
  if (!match) throw new Error(`Unrecognized Horizons calendar value: ${raw}`);
  const month = {
    Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
    Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
  }[match[2]];
  if (!month) throw new Error(`Unrecognized Horizons month: ${match[2]}`);
  const fraction = match[7] ? `.${match[7].slice(0, 3).padEnd(3, '0')}` : '';
  return `${match[1]}-${month}-${match[3]}T${match[4]}:${match[5]}:${match[6]}${fraction}`;
}

function parseHorizonsPayload(payload, body) {
  if (payload?.error) throw new Error(`Horizons error for ${body.name}: ${payload.error}`);
  if (typeof payload?.result !== 'string') throw new Error(`Horizons returned no result text for ${body.name}`);
  const start = payload.result.indexOf('$$SOE');
  const stop = payload.result.indexOf('$$EOE');
  if (start < 0 || stop < 0 || stop <= start) throw new Error(`Horizons markers missing for ${body.name}`);

  const lines = payload.result.slice(start + 5, stop).split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const samples = lines.map((line, index) => {
    const fields = line.split(',').map(value => value.trim());
    if (fields.length < 8) throw new Error(`Horizons row ${index + 1} for ${body.name} has ${fields.length} fields`);
    const jdTdb = Number(fields[0]);
    const state = fields.slice(2, 8).map(Number);
    if (!Number.isFinite(jdTdb) || state.some(value => !Number.isFinite(value))) {
      throw new Error(`Non-finite Horizons value for ${body.name} at row ${index + 1}`);
    }
    return {
      date: parseHorizonsCalendar(fields[1]),
      jdTdb,
      frame: { p: state.slice(0, 3), v: state.slice(3, 6) },
    };
  });
  if (samples.length < 2) throw new Error(`Horizons returned too few samples for ${body.name}`);
  return { samples, signature: payload.signature || null };
}

function nullableNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function uncertainty(row, prefix) {
  return {
    plus: nullableNumber(row[`${prefix}err1`]),
    minus: nullableNumber(row[`${prefix}err2`]),
  };
}

function medianFinite(rows, key) {
  const values = rows.map(row => nullableNumber(row[key])).filter(Number.isFinite).sort((a, b) => a - b);
  if (!values.length) return null;
  const middle = Math.floor(values.length / 2);
  return values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
}

function stripReferenceHtml(value) {
  if (!value) return null;
  return String(value)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim() || null;
}

function extractReferenceUrl(value) {
  if (!value) return null;
  const match = String(value).match(/href\s*=\s*["']([^"']+)["']/i);
  return match?.[1] || null;
}

function round(value, digits = 12) {
  return Number(Number(value).toFixed(digits));
}

function transformTrappistRows(rows) {
  if (!Array.isArray(rows)) throw new Error('NASA Exoplanet Archive response was not a JSON row array');
  if (rows.length !== EXPECTED_TRAPPIST_BODY_COUNT) {
    throw new Error(`Expected ${EXPECTED_TRAPPIST_BODY_COUNT} default TRAPPIST-1 rows, received ${rows.length}`);
  }

  const sorted = [...rows].sort((a, b) => Number(a.pl_orbper) - Number(b.pl_orbper));
  const bodies = sorted.map((row, index) => ({
    id: String(row.pl_name || `TRAPPIST-1 ${row.pl_letter || index + 1}`).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
    name: String(row.pl_name || `TRAPPIST-1 ${row.pl_letter || index + 1}`),
    type: 'planet',
    massEarth: nullableNumber(row.pl_bmasse),
    radiusEarth: nullableNumber(row.pl_rade),
    semimajorAxisAU: nullableNumber(row.pl_orbsmax),
    periodDays: nullableNumber(row.pl_orbper),
    eccentricity: nullableNumber(row.pl_orbeccen),
    phase: round(index * Math.PI * 2 / sorted.length),
    color: TRAPPIST_VISUALS[index % TRAPPIST_VISUALS.length],
    uncertainty: {
      massEarth: uncertainty(row, 'pl_bmasse'),
      radiusEarth: uncertainty(row, 'pl_rade'),
      semimajorAxisAU: uncertainty(row, 'pl_orbsmax'),
      periodDays: uncertainty(row, 'pl_orbper'),
      eccentricity: uncertainty(row, 'pl_orbeccen'),
    },
    massProvenance: row.pl_bmassprov || null,
    catalogReference: stripReferenceHtml(row.pl_refname),
    catalogReferenceUrl: extractReferenceUrl(row.pl_refname),
    catalogReleaseDate: row.releasedate || null,
    catalogRowUpdate: row.rowupdate || null,
  }));

  return {
    bodies,
    star: {
      id: 'trappist-1',
      name: 'TRAPPIST-1',
      type: 'star',
      massSolar: medianFinite(sorted, 'st_mass'),
      radiusSolar: medianFinite(sorted, 'st_rad'),
      effectiveTemperatureK: medianFinite(sorted, 'st_teff'),
      color: '#ff9b63',
      aggregation: 'Median of finite stellar values in the seven returned default planet rows; color is curated for display.',
    },
  };
}

function assert(condition, message) {
  if (!condition) throw new Error(`Validation failed: ${message}`);
}

function validateDataset(data) {
  assert(data?.systems?.solar?.bodies?.length === EXPECTED_SOLAR_BODY_COUNT, `solar body count must be ${EXPECTED_SOLAR_BODY_COUNT}`);
  const solar = data.systems.solar;
  assert(solar.bodies.some(body => body.id === solar.center), 'solar center must reference a body ID');
  assert(typeof solar.coordinateOrigin === 'string' && solar.coordinateOrigin.includes('500@0'), 'solar coordinate origin must document Horizons center 500@0');
  assert(solar.dates.length > 2, 'solar dates must contain samples');
  assert(solar.julianDatesTdb.length === solar.dates.length, 'Julian-date count must equal calendar-date count');
  for (let index = 1; index < solar.julianDatesTdb.length; index += 1) {
    assert(solar.julianDatesTdb[index] > solar.julianDatesTdb[index - 1], `solar timestamps must increase at index ${index}`);
  }
  assert(new Set(solar.bodies.map(body => body.id)).size === solar.bodies.length, 'solar body IDs must be unique');
  solar.bodies.forEach(body => {
    assert(body.frames.length === solar.dates.length, `${body.id} frame count must match dates`);
    assert(Number.isFinite(body.massSolar) && body.massSolar > 0, `${body.id} massSolar must be positive and finite`);
    assert(Number.isFinite(body.radiusKm) && body.radiusKm > 0, `${body.id} radiusKm must be positive and finite`);
    body.frames.forEach((frame, frameIndex) => {
      assert(Array.isArray(frame.p) && frame.p.length === 3, `${body.id} frame ${frameIndex} must have 3-position components`);
      assert(Array.isArray(frame.v) && frame.v.length === 3, `${body.id} frame ${frameIndex} must have 3-velocity components`);
      assert([...frame.p, ...frame.v].every(Number.isFinite), `${body.id} frame ${frameIndex} must be finite`);
    });
  });

  const trappist = data.systems.trappist1;
  assert(trappist.bodies.length === EXPECTED_TRAPPIST_BODY_COUNT, `TRAPPIST-1 body count must be ${EXPECTED_TRAPPIST_BODY_COUNT}`);
  assert(new Set(trappist.bodies.map(body => body.id)).size === trappist.bodies.length, 'TRAPPIST-1 body IDs must be unique');
  trappist.bodies.forEach((body, index) => {
    assert(Number.isFinite(body.periodDays) && body.periodDays > 0, `${body.id} periodDays must be positive and finite`);
    assert(Number.isFinite(body.semimajorAxisAU) && body.semimajorAxisAU > 0, `${body.id} semimajorAxisAU must be positive and finite`);
    ['massEarth', 'radiusEarth', 'eccentricity'].forEach(field => {
      assert(body[field] === null || Number.isFinite(body[field]), `${body.id} ${field} must be finite or null`);
    });
    if (index > 0) assert(body.periodDays > trappist.bodies[index - 1].periodDays, 'TRAPPIST-1 periods must be strictly increasing');
  });
  assert(data.meta.sources.every(source => source.name && source.url && source.retrievedAt), 'all sources need name, URL, and retrieval time');
}

async function main() {
  const retrievalStartedAt = new Date().toISOString();
  const solarResults = [];

  for (const body of SOLAR_BODIES) {
    const url = makeHorizonsUrl(body.targetId);
    process.stdout.write(`Fetching JPL Horizons: ${body.name}... `);
    const payload = await fetchJson(url, `JPL Horizons (${body.name})`);
    const parsed = parseHorizonsPayload(payload, body);
    solarResults.push({ body, url, ...parsed });
    process.stdout.write(`${parsed.samples.length} frames\n`);
  }

  const tapUrl = makeTapUrl();
  process.stdout.write('Fetching NASA Exoplanet Archive: TRAPPIST-1... ');
  const trappistRows = await fetchJson(tapUrl, 'NASA Exoplanet Archive TAP (TRAPPIST-1)');
  const trappist = transformTrappistRows(trappistRows);
  process.stdout.write(`${trappist.bodies.length} planets\n`);

  const canonicalSamples = solarResults[0].samples;
  solarResults.slice(1).forEach(({ body, samples }) => {
    assert(samples.length === canonicalSamples.length, `${body.name} sample count differs from Sun`);
    samples.forEach((sample, index) => {
      assert(Math.abs(sample.jdTdb - canonicalSamples[index].jdTdb) < 1e-9, `${body.name} Julian date differs at frame ${index}`);
      assert(sample.date === canonicalSamples[index].date, `${body.name} calendar date differs at frame ${index}`);
    });
  });

  const generatedAt = new Date().toISOString();
  const sources = [
    { name: 'JPL Horizons API — barycentric ecliptic state vectors', url: HORIZONS_ENDPOINT, retrievedAt: retrievalStartedAt },
    { name: 'JPL Horizons API documentation', url: HORIZONS_DOCS, retrievedAt: retrievalStartedAt },
    { name: 'JPL Planetary Physical Parameters', url: JPL_PHYSICAL_PARAMETERS, retrievedAt: retrievalStartedAt },
    { name: 'NASA NSSDCA Sun Fact Sheet', url: NASA_SUN_FACT_SHEET, retrievedAt: retrievalStartedAt },
    { name: 'NASA Exoplanet Archive TAP — exact TRAPPIST-1 query', url: tapUrl, retrievedAt: retrievalStartedAt },
    { name: 'NASA Exoplanet Archive TAP documentation', url: EXOPLANET_TAP_DOCS, retrievedAt: retrievalStartedAt },
    { name: 'NASA Exoplanet Archive PS column definitions', url: EXOPLANET_COLUMN_DOCS, retrievedAt: retrievalStartedAt },
  ];

  const data = {
    meta: {
      generatedAt,
      sources,
      fieldSemantics: {
        authoritative: [
          'systems.solar.dates', 'systems.solar.julianDatesTdb', 'systems.solar.bodies[].frames',
          'systems.trappist1.bodies[].periodDays', 'semimajorAxisAU', 'radiusEarth', 'massEarth', 'eccentricity',
          'systems.trappist1.bodies[].uncertainty',
        ],
        derived: [
          'systems.solar.bodies[].massSolar (planet mass divided by Sun mass from the cited physical tables)',
          'systems.trappist1.star (median of finite stellar values repeated across returned default planet rows)',
          'Horizons calendar text normalized to ISO-8601 syntax without a timezone suffix because the time scale is TDB',
        ],
        curatedVisualOnly: [
          'id', 'type', 'color', 'atmosphere', 'rings',
          'systems.trappist1.bodies[].phase (evenly distributed display phase; not an observed orbital phase)',
        ],
      },
      warning: 'Educational visualization data. Not for navigation, mission design, precision ephemerides, or claims of photorealistic appearance.',
    },
    systems: {
      solar: {
        id: 'solar',
        name: 'Solar System',
        type: 'ephemeris',
        center: 'sun',
        coordinateOrigin: 'Solar System Barycenter (Horizons center code 500@0)',
        referenceFrame: 'ICRF',
        referencePlane: 'ECLIPTIC',
        timeScale: 'TDB',
        epoch: { start: START_TIME, stop: STOP_TIME, step: STEP_SIZE },
        units: { position: 'AU', velocity: 'AU/day' },
        dates: canonicalSamples.map(sample => sample.date),
        julianDatesTdb: canonicalSamples.map(sample => sample.jdTdb),
        bodies: solarResults.map(({ body, samples }) => ({
          id: body.id,
          name: body.name,
          type: body.type,
          massSolar: body.mass1e24Kg / SUN_MASS_1E24_KG,
          radiusKm: body.radiusKm,
          ...SOLAR_VISUALS[body.id],
          frames: samples.map(sample => sample.frame),
        })),
        provenance: {
          provider: 'NASA/JPL Solar System Dynamics — Horizons',
          retrievedAt: retrievalStartedAt,
          apiSignature: solarResults[0].signature,
          query: {
            endpoint: HORIZONS_ENDPOINT,
            commandTargets: Object.fromEntries(SOLAR_BODIES.map(body => [body.id, body.targetId])),
            makeEphemeris: true,
            ephemerisType: 'VECTORS',
            center: '500@0',
            startTime: START_TIME,
            stopTime: STOP_TIME,
            stepSize: STEP_SIZE,
            referenceSystem: 'ICRF',
            referencePlane: 'ECLIPTIC',
            outputUnits: 'AU-D',
            vectorTable: 2,
            vectorCorrections: 'NONE',
            calendarType: 'GREGORIAN',
            csvFormat: true,
            vectorLabels: false,
            vectorDeltaT: false,
          },
          queries: solarResults.map(({ body, url, signature }) => ({ bodyId: body.id, targetId: body.targetId, url, signature })),
          physicalMetadata: {
            planetMassesAndMeanRadii: JPL_PHYSICAL_PARAMETERS,
            sunMassAndMeanRadius: NASA_SUN_FACT_SHEET,
            note: 'massSolar is derived from cited tabulated masses. Physical radii are not used as rendered scale.',
          },
        },
      },
      trappist1: {
        id: 'trappist1',
        name: 'TRAPPIST-1',
        type: 'catalog-keplerian',
        epoch: null,
        units: {
          mass: 'Earth mass',
          radius: 'Earth radius',
          semimajorAxis: 'AU',
          period: 'day',
          eccentricity: 'dimensionless',
          phase: 'radian (curated display only)',
        },
        star: trappist.star,
        bodies: trappist.bodies,
        provenance: {
          provider: 'NASA Exoplanet Archive',
          service: 'Table Access Protocol (TAP) synchronous query',
          table: 'ps',
          retrievedAt: retrievalStartedAt,
          query: TAP_QUERY,
          url: tapUrl,
          columnDocumentation: EXOPLANET_COLUMN_DOCS,
          missingValuePolicy: 'Missing catalog values are preserved as null; they are not imputed.',
          epochNote: 'The selected catalog columns do not define one shared orbital epoch or observed phase. epoch is null and phase is curated only for display.',
          modelNote: 'Catalog parameters are not Cartesian ephemerides. Any animation derived from them is an idealized Keplerian visualization, not a propagated observation.',
        },
      },
    },
  };

  validateDataset(data);
  const banner = [
    '/*',
    ' * GENERATED FILE — do not hand-edit.',
    ' * Rebuild with: node tools/fetch-cosmos-data.mjs',
    ` * Generated: ${generatedAt}`,
    ' */',
  ].join('\n');
  const output = `${banner}\nwindow.COSMOS_REAL_DATA = ${JSON.stringify(data)};\n`;
  await writeFile(OUTPUT_PATH, output, 'utf8');
  process.stdout.write(`Validated and wrote ${OUTPUT_PATH}\n`);
}

main().catch(error => {
  console.error('\nCOSMOS data fetch failed. Existing output was not replaced.');
  console.error(error?.stack || error);
  process.exitCode = 1;
});
