import { launch, goto, shot, bodyText, uptime, PHOTOS } from './lib.mjs';
const { ctx, page } = await launch(true, 'fresh'); await goto(page);
console.log('uptime', uptime());
await shot(page, '00-empty');
console.log((await bodyText(page)).split('\n').join(' | '));
await ctx.close();
