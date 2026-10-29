import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertCp2Runtime } from './cp2-runtime-guard.mjs';

// Run via isolated CLI --suite=MOBILE. Reuse V20's entire mutable workflow,
// including controlled SIMULATED review, cleanup and fail-closed evidence.
await assertCp2Runtime();
const workflowUrl = new URL(
  './passenger-r1-full-workflow.mjs',
  import.meta.url,
);
const workflow = await readFile(workflowUrl, 'utf8');
const evidenceRoot = process.env.PRODUCT_ACCEPTANCE_EVIDENCE_DIR;
const results = [];

// V20 has top-level execution, not exported helpers. Adapt exact anchors in
// memory; refuse source drift rather than silently dropping coverage.
function replaceOnce(source, anchor, replacement) {
  assert.equal(source.split(anchor).length, 2, `V20 anchor changed: ${anchor}`);
  return source.replace(anchor, () => replacement);
}

async function viewportChecks(page, width, step) {
  const measurement = await page.evaluate(() => {
    const visible = (node) => node.getClientRects().length > 0;
    const dialogs = [
      ...document.querySelectorAll(
        'dialog[open], [role="dialog"], [role="alertdialog"]',
      ),
    ].filter(visible);
    return {
      width: innerWidth,
      touch: navigator.maxTouchPoints,
      overflow:
        Math.max(
          document.documentElement.scrollWidth,
          document.body.scrollWidth,
        ) - document.documentElement.clientWidth,
      controls: [
        ...document.querySelectorAll(
          'button, input:not([type="hidden"]), select, textarea, [role="option"]',
        ),
      ]
        .filter(visible)
        .map((node) => {
          const box = node.getBoundingClientRect();
          return {
            name:
              node.getAttribute('aria-label') ||
              node.textContent?.trim().slice(0, 70) ||
              node.id ||
              node.tagName,
            width: box.width,
            height: box.height,
            left: box.left,
            right: box.right,
          };
        }),
      dialogs: dialogs.map((node) => {
        const box = node.getBoundingClientRect();
        const labelledBy = node.getAttribute('aria-labelledby');
        return {
          name:
            node.getAttribute('aria-label') ||
            labelledBy
              ?.split(/\s+/)
              .map((id) => document.getElementById(id)?.textContent)
              .join(' ')
              .trim(),
          contained:
            box.left >= -1 &&
            box.right <= innerWidth + 1 &&
            box.top >= -1 &&
            box.bottom <= innerHeight + 1,
          focusInside: node.contains(document.activeElement),
        };
      }),
    };
  });
  assert.equal(
    measurement.width,
    width,
    `${step}: viewport metadata missing or wrong`,
  );
  assert.equal(
    measurement.touch > 0,
    width < 600,
    `${step}: touch emulation mismatch`,
  );
  assert.ok(
    measurement.overflow <= 1,
    `${step}: horizontal overflow ${measurement.overflow}px`,
  );
  assert.ok(measurement.controls.length > 0, `${step}: no visible controls`);
  for (const control of measurement.controls) {
    assert.ok(
      control.left >= -1 && control.right <= width + 1,
      `${step}: clipped control ${control.name}`,
    );
    if (width < 600)
      assert.ok(
        control.width >= 24 && control.height >= 24,
        `${step}: touch target below 24px ${control.name} (${control.width}×${control.height})`,
      );
  }
  for (const dialog of measurement.dialogs) {
    assert.ok(dialog.name, `${step}: unnamed dialog`);
    assert.ok(dialog.contained, `${step}: dialog outside viewport`);
    assert.ok(dialog.focusInside, `${step}: dialog focus escaped`);
  }
  return { step, ...measurement };
}

try {
  for (const width of [360, 390, 1280]) {
    const viewportEvidence = join(
      evidenceRoot ||
        fileURLToPath(
          new URL('../../../.release-evidence/V20-mobile', import.meta.url),
        ),
      String(width),
    );
    process.env.PRODUCT_ACCEPTANCE_EVIDENCE_DIR = viewportEvidence;
    let source = replaceOnce(
      workflow,
      "from 'playwright-core'",
      `from ${JSON.stringify(import.meta.resolve('playwright-core'))}`,
    );
    source = replaceOnce(
      source,
      "from './cp2-runtime-guard.mjs'",
      `from ${JSON.stringify(new URL('./cp2-runtime-guard.mjs', import.meta.url).href)}`,
    );
    source = source.replaceAll(
      'import.meta.url',
      JSON.stringify(workflowUrl.href),
    );
    source = replaceOnce(
      source,
      "suite: 'passenger-r1-full-workflow',",
      `suite: 'passenger-mobile-v20-${width}',\n  viewport_checks: [],`,
    );
    // Both owner contexts use identical device capabilities; original isolation
    // assertions and full V20 progression remain unchanged.
    const contextAnchor =
      'browser.newContext({ viewport: { width: 390, height: 844 } })';
    assert.equal(
      source.split(contextAnchor).length,
      3,
      'V20 context anchors changed',
    );
    source = source.replaceAll(
      contextAnchor,
      `browser.newContext({ viewport: { width: ${width}, height: ${width < 600 ? 844 : 900} }, hasTouch: ${width < 600}, isMobile: ${width < 600} })`,
    );
    source = replaceOnce(
      source,
      '    const result = await fn();',
      `    const result = await fn();\n    if (page && uiStep >= 2) evidence.viewport_checks.push(await viewportChecks(page, ${width}, name));`,
    );
    source = replaceOnce(
      source,
      '  page = await context.newPage();',
      `  page = await context.newPage();\n  page.on('dialog', async (dialog) => {\n    mark('unexpected-browser-dialog', 'FAIL', dialog.type());\n    await dialog.dismiss();\n  });`,
    );
    source += `\n${viewportChecks.toString()}\n`;
    process.exitCode = 0;
    await import(
      `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
    );
    assert.equal(
      process.exitCode,
      0,
      `${width}px V20 failed; inspect ${viewportEvidence}`,
    );
    const artifact = JSON.parse(
      await readFile(join(viewportEvidence, 'final.json'), 'utf8'),
    );
    assert.equal(artifact.evidence.persisted_completed?.status, 'COMPLETED');
    assert.equal(
      artifact.evidence.viewport_checks.length,
      19,
      'every UI step needs viewport evidence',
    );
    assert.equal(
      artifact.evidence.ui_steps.length,
      20,
      'full V20 workflow required',
    );
    assert.ok(
      artifact.completed_cases.every((item) => item.verdict === 'PASS'),
    );
    results.push({ width, touch: width < 600, evidence: viewportEvidence });
  }
  console.log(JSON.stringify({ status: 'PASS', suite: 'V20_MOBILE', results }));
} finally {
  if (evidenceRoot === undefined)
    delete process.env.PRODUCT_ACCEPTANCE_EVIDENCE_DIR;
  else process.env.PRODUCT_ACCEPTANCE_EVIDENCE_DIR = evidenceRoot;
}
