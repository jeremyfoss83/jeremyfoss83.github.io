import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const root = resolve(process.cwd());
const output = resolve(root, '_qa');
await mkdir(output, { recursive: true });
const browserCandidates = process.platform === 'win32'
  ? [
      'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
      'C:/Program Files/Microsoft/Edge/Application/msedge.exe'
    ]
  : [];
const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH || browserCandidates.find(existsSync);
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
const pages = [
  ['home', 'index.html'],
  ['model', 'projects/brain-drain-model.html'],
  ['osint', 'projects/crypto-fraud-osint.html'],
  ['database', 'projects/portfolio-database.html'],
  ['network', 'projects/office-network.html'],
  ['game', 'lab/signal-sweep.html'],
  ['cosmos', 'lab/cosmos-lab.html'],
  ['observatory', 'lab/cosmos-observatory.html'],
];
const results = [];
for (const [name, file] of pages) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(pathToFileURL(resolve(root, file)).href, { waitUntil: 'networkidle' });
  await page.screenshot({ path: resolve(output, `${name}-desktop.png`), fullPage: true });
  const links = await page.locator('a').evaluateAll(anchors => anchors.map(a => ({ href: a.href, text: a.textContent.trim() })));
  results.push({ name, title: await page.title(), h1: await page.locator('h1').count(), errors, localLinks: links.filter(link => link.href.startsWith('file:')).length });
  await page.close();
}
const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
await mobile.goto(pathToFileURL(resolve(root, 'index.html')).href, { waitUntil: 'networkidle' });
await mobile.screenshot({ path: resolve(output, 'home-mobile.png'), fullPage: true });
results.push({ name: 'home-mobile', horizontalOverflow: await mobile.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth) });
const mid = await browser.newPage({ viewport: { width: 760, height: 900 }, deviceScaleFactor: 1 });
await mid.goto(pathToFileURL(resolve(root, 'index.html')).href, { waitUntil: 'networkidle' });
await mid.locator('#experience').scrollIntoViewIfNeeded();
await mid.screenshot({ path: resolve(output, 'home-mid-headers.png'), fullPage: false });
results.push({ name: 'home-mid', horizontalOverflow: await mid.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth) });
const game = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
const gameErrors = [];
game.on('console', message => { if (message.type() === 'error') gameErrors.push(message.text()); });
game.on('pageerror', error => gameErrors.push(error.message));
await game.goto(pathToFileURL(resolve(root, 'lab/signal-sweep.html')).href, { waitUntil: 'networkidle' });
await game.locator('#startButton').click();
await game.keyboard.down('ArrowRight');
await game.waitForTimeout(600);
await game.keyboard.up('ArrowRight');
await game.keyboard.press('Space');
results.push({ name: 'game-interaction', state: await game.locator('#statusText').textContent(), overlayVisible: await game.locator('#gameOverlay').isVisible(), errors: gameErrors });
await game.screenshot({ path: resolve(output, 'game-running.png'), fullPage: true });
const gameMobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
const mobileGameErrors = [];
gameMobile.on('pageerror', error => mobileGameErrors.push(error.message));
await gameMobile.goto(pathToFileURL(resolve(root, 'lab/signal-sweep.html')).href, { waitUntil: 'networkidle' });
await gameMobile.locator('#startButton').click();
await gameMobile.locator('[data-control="right"]').dispatchEvent('pointerdown');
await gameMobile.waitForTimeout(350);
await gameMobile.locator('[data-control="right"]').dispatchEvent('pointerup');
await gameMobile.screenshot({ path: resolve(output, 'game-mobile.png'), fullPage: true });
results.push({ name: 'game-mobile', horizontalOverflow: await gameMobile.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), touchControlsVisible: await gameMobile.locator('.touch-controls').isVisible(), errors: mobileGameErrors });
const cosmos = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
const cosmosErrors = [];
cosmos.on('console', message => { if (message.type() === 'error') cosmosErrors.push(message.text()); });
cosmos.on('pageerror', error => cosmosErrors.push(error.message));
await cosmos.goto(pathToFileURL(resolve(root, 'lab/cosmos-lab.html')).href, { waitUntil: 'networkidle' });
await cosmos.waitForTimeout(800);
const initialBodies = Number(await cosmos.locator('#cosmosBodyCount').textContent());
await cosmos.locator('[data-cosmos-action="next-body"]').click();
const selectedByButton = await cosmos.locator('#cosmosSelectedName').textContent();
await cosmos.locator('#cosmosCanvas').focus();
await cosmos.keyboard.press(']');
const selectedByKeyboard = await cosmos.locator('#cosmosSelectedName').textContent();
await cosmos.locator('[data-cosmos-speed="4"]').click();
const speedPresetPressed = await cosmos.locator('[data-cosmos-speed="4"]').getAttribute('aria-pressed');
await cosmos.locator('[data-cosmos-action="pause"]').click();
await cosmos.locator('[data-cosmos-action="step"]').click();
const stepStatus = await cosmos.locator('#cosmosStatus').textContent();
await cosmos.locator('[data-cosmos-action="pause"]').click();
await cosmos.locator('#cosmosGravityToggle').check();
await cosmos.locator('#cosmosGravityToggle').focus();
const switchFocusOutline = await cosmos.locator('#cosmosGravityToggle + i').evaluate(element => getComputedStyle(element).outlineStyle);
await cosmos.locator('#cosmosVelocityToggle').check();
await cosmos.locator('[data-cosmos-action="reverse"]').click();
await cosmos.locator('[data-cosmos-action="resonance"]').click();
await cosmos.locator('#cosmosCanvas').hover({ position: { x: 520, y: 300 } });
await cosmos.mouse.wheel(0, -450);
const bodiesBeforeLaunch = Number(await cosmos.locator('#cosmosBodyCount').textContent());
await cosmos.locator('#cosmosBodyName').fill('Codex');
await cosmos.locator('#cosmosAddForm').evaluate(form => form.requestSubmit());
await cosmos.waitForTimeout(600);
const finalBodies = Number(await cosmos.locator('#cosmosBodyCount').textContent());
await cosmos.screenshot({ path: resolve(output, 'cosmos-interactive.png'), fullPage: true });
results.push({ name: 'cosmos-interaction', status: await cosmos.locator('#cosmosStatus').textContent(), stepStatus, selectedByButton, selectedByKeyboard, speedPresetPressed, switchFocusOutline, initialBodies, bodiesBeforeLaunch, finalBodies, bodyAdded: finalBodies === bodiesBeforeLaunch + 1, zoom: await cosmos.locator('#cosmosZoomValue').textContent(), energyDrift: await cosmos.locator('#cosmosEnergyDrift').textContent(), errors: cosmosErrors });
const cosmosMobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
const cosmosMobileErrors = [];
cosmosMobile.on('pageerror', error => cosmosMobileErrors.push(error.message));
await cosmosMobile.goto(pathToFileURL(resolve(root, 'lab/cosmos-lab.html')).href, { waitUntil: 'networkidle' });
await cosmosMobile.waitForTimeout(500);
await cosmosMobile.screenshot({ path: resolve(output, 'cosmos-mobile.png'), fullPage: true });
results.push({
  name: 'cosmos-mobile',
  horizontalOverflow: await cosmosMobile.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth),
  overflowElements: await cosmosMobile.evaluate(() => [...document.querySelectorAll('body *')].flatMap(element => {
    const rect = element.getBoundingClientRect();
    return rect.right > document.documentElement.clientWidth + 1 || rect.left < -1
      ? [{ tag: element.tagName, className: String(element.className), id: element.id, left: Math.round(rect.left), right: Math.round(rect.right), width: Math.round(rect.width) }]
      : [];
  }).slice(0, 12)),
  canvasFocusable: await cosmosMobile.locator('#cosmosCanvas').getAttribute('tabindex'),
  errors: cosmosMobileErrors,
});
const cosmosReduced = await browser.newPage({ viewport: { width: 1000, height: 800 }, reducedMotion: 'reduce' });
await cosmosReduced.goto(pathToFileURL(resolve(root, 'lab/cosmos-lab.html')).href, { waitUntil: 'networkidle' });
await cosmosReduced.waitForTimeout(250);
results.push({ name: 'cosmos-reduced-motion', status: await cosmosReduced.locator('#cosmosStatus').textContent(), pauseLabel: await cosmosReduced.locator('[data-cosmos-action="pause"]').textContent() });

const observatory = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
const observatoryErrors = [];
observatory.on('console', message => { if (message.type() === 'error') observatoryErrors.push(message.text()); });
observatory.on('pageerror', error => observatoryErrors.push(error.message));
await observatory.goto(pathToFileURL(resolve(root, 'lab/cosmos-observatory.html')).href, { waitUntil: 'networkidle' });
await observatory.waitForFunction(() => document.querySelector('#obsStatus')?.textContent.trim() !== 'INITIALIZING', null, { timeout: 15000 });
const initialBodyButtons = await observatory.locator('#obsBodyList button').count();
const initialPlayLabel = (await observatory.locator('[data-obs-action="play"]').textContent()).trim();
if (initialBodyButtons > 1) await observatory.locator('#obsBodyList button').nth(1).click();
const selectedFromList = await observatory.locator('#obsSelectedName').textContent();
await observatory.locator('#obsCompareToggle').check();
await observatory.locator('#obsFabricToggle').check();
await observatory.locator('[data-obs-action="guided-tour"]').click();
const tourOpened = await observatory.locator('#obsTour').isVisible();
const tourRole = await observatory.locator('#obsTour').getAttribute('role');
const tourFocusInside = await observatory.evaluate(() => document.querySelector('#obsTour')?.contains(document.activeElement));
await observatory.locator('[data-tour-action="next"]').click();
await observatory.locator('[data-tour-action="exit"]').click();
const tourFocusReturned = await observatory.evaluate(() => document.activeElement?.matches('[data-obs-action="guided-tour"]'));
await observatory.evaluate(() => window.CosmosObservatory.pause());
const beforeStep = Date.parse((await observatory.evaluate(() => window.CosmosObservatory.getState())).date);
await observatory.locator('[data-obs-action="step"]').click();
const afterStep = Date.parse((await observatory.evaluate(() => window.CosmosObservatory.getState())).date);
const stepDays = (afterStep - beforeStep) / 86400000;
await observatory.locator('[data-obs-action="reverse"]').click();
await observatory.locator('#observatoryCanvas').focus();
await observatory.keyboard.press(']');
const selectedAfterKeyboard = await observatory.locator('#obsSelectedName').textContent();
const solarCompareEnabled = await observatory.locator('#obsCompareToggle').isChecked();
await observatory.screenshot({ path: resolve(output, 'observatory-interactive.png'), fullPage: true });
await observatory.locator('#obsSystemSelect').selectOption('trappist1');
await observatory.waitForFunction(() => document.querySelectorAll('#obsBodyList button').length === 8);
await observatory.locator('#obsBodyList button').nth(1).click();
await observatory.locator('#obsScaleToggle').check();
await observatory.locator('#obsScaleToggle').focus();
const observatorySwitchFocus = await observatory.locator('#obsScaleToggle + i').evaluate(element => getComputedStyle(element).outlineStyle);
await observatory.screenshot({ path: resolve(output, 'observatory-trappist.png'), fullPage: false });
results.push({
  name: 'observatory-interaction',
  status: await observatory.locator('#obsStatus').textContent(),
  date: await observatory.locator('#obsDate').textContent(),
  selectedFromList,
  selectedAfterKeyboard,
  initialPlayLabel,
  stepDays,
  initialBodyButtons,
  tourOpened,
  tourRole,
  tourFocusInside,
  tourFocusReturned,
  solarCompareEnabled,
  trappistCompareDisabled: await observatory.locator('#obsCompareToggle').isDisabled(),
  fabricEnabled: await observatory.locator('#obsFabricToggle').isChecked(),
  trappistBodyButtons: await observatory.locator('#obsBodyList button').count(),
  trappistEpoch: await observatory.locator('#obsEpoch').textContent(),
  trappistSource: await observatory.locator('#obsSelectedSource').textContent(),
  trappistScale: await observatory.locator('#obsScaleMode').textContent(),
  switchFocusOutline: observatorySwitchFocus,
  loadingFallbackHidden: await observatory.locator('#obsFallback').isHidden(),
  errors: observatoryErrors,
});

const observatoryMobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
const observatoryMobileErrors = [];
observatoryMobile.on('pageerror', error => observatoryMobileErrors.push(error.message));
await observatoryMobile.goto(pathToFileURL(resolve(root, 'lab/cosmos-observatory.html')).href, { waitUntil: 'networkidle' });
await observatoryMobile.waitForTimeout(900);
await observatoryMobile.screenshot({ path: resolve(output, 'observatory-mobile.png'), fullPage: true });
results.push({
  name: 'observatory-mobile',
  horizontalOverflow: await observatoryMobile.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth),
  canvasFocusable: await observatoryMobile.locator('#observatoryCanvas').getAttribute('tabindex'),
  errors: observatoryMobileErrors,
});

const observatoryReduced = await browser.newPage({ viewport: { width: 1000, height: 800 }, reducedMotion: 'reduce' });
await observatoryReduced.goto(pathToFileURL(resolve(root, 'lab/cosmos-observatory.html')).href, { waitUntil: 'networkidle' });
await observatoryReduced.waitForTimeout(600);
results.push({ name: 'observatory-reduced-motion', status: await observatoryReduced.locator('#obsStatus').textContent(), playLabel: await observatoryReduced.locator('[data-obs-action="play"]').textContent() });
const observatoryTdb = await browser.newPage({ viewport: { width: 1000, height: 800 }, timezoneId: 'Pacific/Auckland' });
await observatoryTdb.goto(pathToFileURL(resolve(root, 'lab/cosmos-observatory.html')).href, { waitUntil: 'networkidle' });
await observatoryTdb.waitForFunction(() => Boolean(window.CosmosObservatory));
await observatoryTdb.evaluate(() => {
  window.CosmosObservatory.pause();
  const slider = document.querySelector('#obsDateSlider');
  slider.value = '0';
  slider.dispatchEvent(new Event('input', { bubbles: true }));
});
results.push({ name: 'observatory-tdb-timezone', timezone: 'Pacific/Auckland', firstSampleDate: await observatoryTdb.locator('#obsDate').textContent() });
await browser.close();
console.log(JSON.stringify(results, null, 2));
