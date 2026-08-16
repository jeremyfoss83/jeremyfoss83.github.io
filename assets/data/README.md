# COSMOS real-data snapshot

`cosmos-real-data.js` is a generated, browser-ready data snapshot for COSMOS LAB. It is a classic script rather than an ES module so it works when the portfolio is opened directly with a `file://` URL:

```html
<script src="assets/data/cosmos-real-data.js"></script>
<script>
  console.log(window.COSMOS_REAL_DATA);
</script>
```

Do not hand-edit the generated JavaScript. Rebuild it from the official APIs with Node.js 18 or newer:

```console
node tools/fetch-cosmos-data.mjs
```

The generator gathers every response in memory, verifies it, and writes the output only after all sources succeed. A network or validation failure leaves the existing snapshot untouched.

## Solar System ephemeris

The Solar System section contains geometric Cartesian state vectors from the official [NASA/JPL Horizons API](https://ssd-api.jpl.nasa.gov/doc/horizons.html):

- Targets: Sun, Mercury, Venus, Earth, Mars, Jupiter, Saturn, Uranus, and Neptune
- Center: Solar System barycenter, Horizons code `500@0`
- Ephemeris type: `VECTORS`
- Reference system: `ICRF`
- Reference plane: `ECLIPTIC`
- Vector correction: `NONE` (geometric states)
- Position units: astronomical units (`AU`)
- Velocity units: astronomical units per day (`AU/day`)
- Time scale: TDB
- Requested interval: `2026-01-01` through `2031-01-01`
- Fixed output step: `10 d`

`systems.solar.center` is the body ID `sun`, used by the interface for selection and Sun-relative readouts. `systems.solar.coordinateOrigin` separately records the actual coordinate origin: the Solar System barycenter (`500@0`). This distinction prevents the display reference body from being confused with the origin of the stored vectors.

Each body's exact encoded Horizons query URL is retained in `systems.solar.provenance.queries`. Horizons calendar text is normalized to ISO-8601 syntax without a trailing `Z`: the values are TDB labels, not UTC timestamps. The unmodified Julian dates in TDB are retained alongside those labels.

Physical radii and planet masses come from JPL's [Planetary Physical Parameters](https://ssd.jpl.nasa.gov/planets/phys_par.html). The Sun's mass and mean radius come from NASA NSSDCA's [Sun Fact Sheet](https://nssdc.gsfc.nasa.gov/planetary/factsheet/sunfact.html). `massSolar` is a derived mass ratio; it is not part of the Horizons vector response and is not used to alter the ephemeris.

The samples are a visualization-friendly subset of Horizons output. They are not a substitute for querying Horizons at the time resolution and settings required by a scientific or operational task.

## TRAPPIST-1 catalog parameters

The TRAPPIST-1 section comes from the official [NASA Exoplanet Archive TAP service](https://exoplanetarchive.ipac.caltech.edu/docs/TAP/usingTAP.html). The generator queries the Planetary Systems (`ps`) table for the seven `default_flag=1` rows and retains:

- Orbital period
- Semimajor axis
- Planet radius
- Best available planet mass and its provenance label
- Eccentricity
- Reported positive and negative uncertainties
- Row/reference metadata

The exact ADQL query and encoded source URL are stored under `systems.trappist1.provenance`. Column meanings are documented by the archive's [Planetary Systems column definitions](https://exoplanetarchive.ipac.caltech.edu/docs/API_PS_columns.html).

Missing archive values remain explicit `null` values. They are never guessed or imputed. The selected catalog fields do not provide a single common dynamical epoch or an observed orbital phase, so `epoch` is `null`. The `phase` values are evenly distributed visual starting positions and must not be presented as measured locations. A display built from these catalog parameters is an idealized Keplerian visualization, not an ephemeris.

## Field provenance

The generated object separates field semantics in `meta.fieldSemantics`:

- **Authoritative:** JPL state vectors and NASA Exoplanet Archive catalog values as returned by the cited queries.
- **Derived:** solar-mass ratios, normalized date strings, and the median stellar value when the same stellar field is repeated across default planet rows.
- **Curated visual-only:** IDs, colors, halo/ring rendering constants, object types used by the interface, and TRAPPIST-1 display phases.

Colors, glow, atmosphere, ring, and phase fields are presentation choices. They do not claim photorealistic appearance, observed color, physical scale, or measured orientation.

## Validation

Before writing the snapshot, the generator checks:

- Exactly nine Solar System bodies and seven TRAPPIST-1 planets
- Matching Solar System date and frame counts for every body
- Strictly increasing Horizons timestamps shared across all bodies
- Three finite position and three finite velocity components in every frame
- Unique body identifiers
- Positive finite required catalog values and explicit `null` for optional missing values
- Strictly increasing TRAPPIST-1 periods
- Complete source names, URLs, and retrieval timestamps

This dataset is for an educational portfolio visualization. It is not intended for navigation, mission design, precision ephemerides, or scientific inference.
