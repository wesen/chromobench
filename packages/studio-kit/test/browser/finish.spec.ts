// CHB-022 smoke in Chromium (studio-kit dev host, MockEngine): the Finish module of the 'finish' variant —
// crop with a handle, straighten by dragging outside the crop, a spot by a click, undo three times.
import { expect, test, type Page } from '@playwright/test';

const errors: string[] = [];
test.beforeEach(({ page }) => {
  errors.length = 0;
  page.on('pageerror', e => errors.push(e.message));
});
test.afterEach(() => {
  expect(errors).toEqual([]);
});

const hook = <T>(page: Page, f: string): Promise<T> => page.evaluate(`(() => { const cb = window.chromobench; return ${f}; })()`) as Promise<T>;

for (const variant of ['finish', 'classic']) {
  test(`${variant}: crop, straighten, remove a spot, undo three times`, async ({ page }) => {
    await page.goto(`/demo/?variant=${variant}&fresh`);
    await page.waitForFunction(() => document.body.dataset['ready'] === '1');
    await page.keyboard.press('f');
    const vp = page.locator('.ck-vp[data-rendered]').first();
    await expect(vp).toBeVisible();
    // crop: the tool shows the whole frame and the crop frame with handles
    await page.keyboard.press('r');
    await expect(page.locator('.cb-crop-frame')).toHaveCount(1);
    const h = page.locator('[data-handle="1,1"]');
    const hb = (await h.boundingBox())!;
    await page.mouse.move(hb.x + 4, hb.y + 4);
    await page.mouse.down();
    await page.mouse.move(hb.x - 40, hb.y - 30, { steps: 4 });
    await page.mouse.up();
    const crop = await hook<{ w: number; h: number } | null>(page, 'cb.log().committed.view.frame.crop');
    expect(crop).not.toBeNull();
    expect(crop!.w).toBeLessThan(96);
    // straighten: drag outside the crop, around its centre
    const fb = (await page.locator('.cb-crop-frame').boundingBox())!;
    const cx = fb.x + fb.width / 2, cy = fb.y + fb.height / 2;
    await page.mouse.move(cx, fb.y + fb.height + 25);
    await page.mouse.down();
    await page.mouse.move(cx - 30, fb.y + fb.height + 20, { steps: 5 });
    await page.mouse.up();
    const fr = await hook<{ angle_deg: number; crop: { w: number } }>(page, 'cb.log().committed.view.frame');
    expect(fr.angle_deg).not.toBe(0);
    expect(fr.crop.w).toBeLessThanOrEqual(crop!.w);
    // a spot on the finished print
    await page.keyboard.press('q');
    await expect(page.locator('.ck-vp[data-tool="spot"]')).toHaveCount(1);
    const vb = (await vp.boundingBox())!;
    await page.mouse.click(vb.x + vb.width / 2, vb.y + vb.height / 2);
    const spots = await hook<Record<string, { src: { x: number } }>>(page, 'cb.log().committed.retouch.spots');
    expect(Object.keys(spots)).toEqual(['s1']);
    await expect(page.locator('.cb-spot-target')).toHaveCount(1);
    expect(await hook<string[]>(page, 'cb.log().units.map(u => u.label ?? "")')).toHaveLength(3);
    for (let i = 0; i < 3; i++) await page.keyboard.press('Control+z');
    expect(await hook<unknown>(page, 'cb.log().committed.view.frame')).toEqual({ orientation: 'none', angle_deg: 0, crop: null });
    expect(await hook<object>(page, 'cb.log().committed.retouch.spots')).toEqual({});
  });
}
