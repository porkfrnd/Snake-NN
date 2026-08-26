/* Browser verification: load app, exercise Play + Train, capture screenshots + console errors. */
import puppeteer from 'puppeteer-core';

const URL = 'http://localhost:8017/';
const shots = '/tmp/';

async function main() {
  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: '/usr/bin/google-chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 950 });

  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('requestfailed', (r) => errors.push('requestfailed: ' + r.url() + ' ' + (r.failure()?.errorText || '')));

  await page.goto(URL, { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 600));
  await page.screenshot({ path: shots + 'v_menu.png' });

  // --- Play: start, move, eat check via state ---
  await page.click('#menuPlayBtn');
  await new Promise((r) => setTimeout(r, 2300)); // countdown 3..GO
  await page.keyboard.press('ArrowUp');
  await new Promise((r) => setTimeout(r, 700));
  await page.keyboard.press('ArrowLeft');
  await new Promise((r) => setTimeout(r, 700));
  const play = await page.evaluate(() => {
    const s = window.__snake.ui.engine.snake;
    return {
      state: window.__snake.ui.engine.state,
      len: s.length,
      head: { ...s.head },
      score: document.getElementById('hudScore').textContent,
      segments: document.getElementById('snakeLayer').children.length,
      foodVisible: !!document.querySelector('#foodLayer circle'),
      overlayOpen: document.querySelector('.overlay.open')?.id || 'none',
    };
  });
  console.log('PLAY:', JSON.stringify(play));
  await page.screenshot({ path: shots + 'v_play.png' });

  // Pause/resume
  await page.keyboard.press('p');
  await new Promise((r) => setTimeout(r, 250));
  const paused = await page.evaluate(() => window.__snake.ui.engine.state);
  await page.keyboard.press('p');
  await new Promise((r) => setTimeout(r, 250));
  const resumed = await page.evaluate(() => window.__snake.ui.engine.state);
  console.log('PAUSE/RESUME:', paused, '->', resumed);

  // --- Train mode ---
  await page.click('#tabTrain');
  await new Promise((r) => setTimeout(r, 300));
  await page.click('#trainStart');
  // Let it run ~8s of generations at normal intensity
  await new Promise((r) => setTimeout(r, 8000));
  const train = await page.evaluate(() => ({
    generation: document.getElementById('statGeneration').textContent,
    population: document.getElementById('statPopulation').textContent,
    best: document.getElementById('statBest').textContent,
    gamesSec: document.getElementById('statGamesSec').textContent,
    stepsSec: document.getElementById('statStepsSec').textContent,
    params: document.getElementById('statParams').textContent,
    activations: document.getElementById('statActivations').textContent,
    graphPoints: document.querySelector('#trainGraph polyline')?.getAttribute('points')?.split(' ').length || 0,
    watchEnabled: !document.getElementById('trainWatch').disabled,
    note: document.getElementById('trainNote').textContent,
  }));
  console.log('TRAIN:', JSON.stringify(train, null, 1));
  await page.screenshot({ path: shots + 'v_train.png' });

  // Stop must fully stop the worker
  await page.click('#trainStop');
  await new Promise((r) => setTimeout(r, 500));
  const stopped = await page.evaluate(() => ({
    startEnabled: !document.getElementById('trainStart').disabled,
    stopDisabled: document.getElementById('trainStop').disabled,
  }));
  console.log('STOP:', JSON.stringify(stopped));

  // Watch champion replay (if a champion emerged)
  if (train.watchEnabled) {
    await page.click('#trainWatch');
    await new Promise((r) => setTimeout(r, 2600));
    const replay = await page.evaluate(() => ({
      playVisible: !document.getElementById('playScreen').hidden,
      chipHidden: document.getElementById('replayChip').hidden,
      chipMeta: document.getElementById('replayMeta').textContent,
      state: window.__snake.ui.engine.state,
      controllerAttached: !!window.__snake.ui.engine.controller,
    }));
    console.log('REPLAY:', JSON.stringify(replay));
    await page.screenshot({ path: shots + 'v_replay.png' });
  }

  // Long-run responsiveness: UI thread frame timing while training runs again
  await page.click('#tabTrain');
  if (stopped.startEnabled) {
    await page.click('#trainStart');
    await new Promise((r) => setTimeout(r, 500));
    const jank = await page.evaluate(() => new Promise((resolve) => {
      const frames = [];
      let last = performance.now();
      let n = 0;
      function tick(t) {
        frames.push(t - last); last = t;
        if (++n < 60) requestAnimationFrame(tick);
        else {
          frames.sort((a, b) => a - b);
          resolve({ median: +frames[30].toFixed(1), p95: +frames[56].toFixed(1), max: +frames[59].toFixed(1) });
        }
      }
      requestAnimationFrame(tick);
    }));
    console.log('FRAME TIMING while training (ms):', JSON.stringify(jank));
    await page.click('#trainStop');
  }

  console.log('\nERRORS (' + errors.length + '):');
  for (const e of errors) console.log('  ' + e);

  await browser.close();
  process.exit(errors.length ? 2 : 0);
}

main().catch((e) => { console.error('SCRIPT FAIL:', e); process.exit(1); });
