# COSMOS OBSERVATORY — Architecture

## Product boundary

COSMOS OBSERVATORY is a browser-based astronomy data visualization, not a flight-dynamics product or an astronomical ephemeris service. It deliberately separates three kinds of state:

1. **Reference data** — versioned samples retrieved from authoritative archives.
2. **Local model** — simplified propagation used to explain divergence and numerical assumptions.
3. **Artistic rendering** — exaggerated radii, light, trails, and scale transitions used for legibility.

The original COSMOS LAB remains the dependency-free two-dimensional sandbox and accessible fallback.

## Data pipeline

```text
JPL Horizons + NASA Exoplanet Archive
                  │
                  ▼
       reproducible fetch script
                  │
                  ▼
 schema checks · finite-value checks · provenance
                  │
                  ▼
 versioned local browser dataset
                  │
        ┌─────────┴─────────┐
        ▼                   ▼
 reference rendering   local comparison model
        └─────────┬─────────┘
                  ▼
        inspector + residuals + 3D scene
```

The deployed page uses a local snapshot instead of making runtime archive calls. This makes reviews deterministic, avoids API availability becoming a rendering dependency, and preserves the exact source epoch and query parameters.

Horizons calendar labels are TDB, not local civil time. The browser parses their numeric components onto a timezone-neutral internal timeline so a viewer's locale cannot shift the date or interpolation window. Between the stored 10-day samples, the reference layer uses linear interpolation for display continuity and labels that behavior explicitly.

## Rendering architecture

- The authored observatory source is an ES module.
- Three.js and the source are bundled into a single classic browser script so GitHub Pages and local `file://` previews share the same artifact.
- The 3D renderer is isolated to the observatory page; the homepage and 2D labs do not download it.
- Bounded object counts and trails, adaptive device-pixel ratio, procedural assets, and visibility pausing keep GPU and memory cost controlled.
- Planet appearance is procedural. No texture is presented as spacecraft or telescope imagery.

## Interaction and access

Every canvas-only selection has a semantic HTML equivalent. Time, system, overlays, selected-object data, source information, and guided-story controls remain available outside the rendered pixels. Reduced-motion mode begins paused and suppresses automatic camera travel. The two-dimensional lab remains available when WebGL is unavailable or undesirable.

## Scientific interpretation

- Reference vectors retain their documented sample times, units, coordinate origin, reference system, and reference plane. The interface separately identifies the Sun as the selection and distance reference.
- The comparison layer is explicitly a simplified local model—not a replacement for JPL Horizons.
- Exoplanet paths derived from catalog period and semi-major-axis fields are idealized Keplerian illustrations.
- Body radii, atmosphere thickness, vector length, trail persistence, exposure, and illumination are visually exaggerated.
- Relativity, light-time, tidal deformation, detailed satellite perturbations, and uncertainty propagation are outside the model.

## Reproducibility

```powershell
npm install
npx playwright install chromium
node tools/fetch-cosmos-data.mjs
npm run build:observatory
npm run qa
```

Exact dependencies are pinned in `package-lock.json`; third-party notices and data provenance are committed with the generated assets.
