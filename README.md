# Jeremy Foss — Portfolio

Personal portfolio for Jeremy Foss, a University of South Florida Information Science student concentrating in Data Science and Analytics.

## Live site

[jeremyfoss83.github.io](https://jeremyfoss83.github.io)

## What this repository contains

- A responsive, recruiter-focused homepage
- Evidence-bounded project case studies
- Accessible keyboard navigation and reduced-motion support
- Open Graph, structured-data, sitemap, and search metadata
- A custom favicon and social sharing image
- An original responsive 2D canvas game with keyboard and touch controls
- COSMOS OBSERVATORY: the flagship 3D astronomy data experience, using curated JPL Horizons and NASA Exoplanet Archive reference data
- COSMOS 2D SANDBOX: a dependency-free companion experiment with a procedural starfield and interactive orbital physics

## Project structure

```text
.
├── index.html
├── 404.html
├── projects/
│   ├── brain-drain-model.html
│   ├── crypto-fraud-osint.html
│   ├── portfolio-database.html
│   └── office-network.html
├── lab/
│   ├── signal-sweep.html
│   ├── cosmos-observatory.html
│   └── cosmos-lab.html
├── assets/
│   ├── css/
│   ├── data/
│   ├── images/
│   └── js/
├── docs/
│   └── COSMOS-OBSERVATORY-ARCHITECTURE.md
├── tools/
│   └── fetch-cosmos-data.mjs
├── qa.mjs
├── package.json
├── package-lock.json
├── robots.txt
└── sitemap.xml
```

## Development notes

Most of the site uses semantic HTML, CSS, and dependency-free JavaScript. The flagship 3D observatory is bundled from a documented ES module source with pinned Three.js and esbuild versions; the committed browser bundle still deploys directly through GitHub Pages. Its companion 2D sandbox remains dependency-free and available when a lighter-weight experiment is preferred.

```powershell
npm install
npx playwright install chromium
npm run build:observatory
npm run qa
```

The astronomy dataset is a versioned local snapshot so the experience remains deterministic and reviewable. Its provenance, retrieval queries, units, reference frame, missing values, and modeling boundaries are documented under `assets/data/`.

The implementation and copy were developed with AI assistance under Jeremy's direction. Project claims were reconciled against a verified career evidence bank and intentionally preserve stated evidence boundaries.

## September 2026 update

The recruiter homepage now includes six projects, category filters, a mobile menu,
current Home Depot experience, a concise introduction, and `resume.html` with print
styles. New case studies cover the R air-quality coursework and the AI-assisted
Life OS prototype. The three interactive labs are preserved. COSMOS now gives a
clear, accessible route to the 2D sandbox when WebGL is unavailable.

Local preview: `npm run dev -- --host 0.0.0.0 --port 4173`.
See `design-qa.md` for the review scope and the WebGL/native-print test limitations.
