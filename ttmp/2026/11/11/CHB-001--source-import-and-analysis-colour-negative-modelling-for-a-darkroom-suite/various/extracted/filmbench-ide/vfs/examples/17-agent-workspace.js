// 17 · The agent works the workspace
// The agent uses the same verbs, marked by:'agent'. The mode decides when they land:
//   auto       at once      ask       queued in wb.pending until you approve      read-only   refused
// Tiles the agent attaches are ephemeral until you keep them. The Agent view shows the queue; so does History.

const wb = bench('agent');
wb.pipe('default').scene('still').film('kodak_portra_400').enlarger().paper('kodak_portra_endura').scan();
const { ws } = wb;
ws.tile('print').render('out');

wb.agent({ mode: 'ask' });
wb.apply({ op: 'param.set', path: 'camera.ev', value: 1 }, 'agent');       // what the agent's lab.set does
ws.attach('shadow check', (w) => w.hist('out', { bins: 32 }));               // what lab's tile helpers do
log('pending:', wb.pending.map((q) => q.id + ' ' + q.desc).join('  ·  '));

wb.approveAll();                                                             // the buttons in History and in the Agent view do this
log('ev now', wb.params.effective('camera.ev'), '· tiles', [...ws.tiles.keys()].join(', '));
log('ephemeral:', ws.tiles.get('shadow check').ephemeral);                   // dropped on the next agent run unless kept
ws.keep('shadow check');

wb.agent({ mode: 'read-only' });
try { wb.apply({ op: 'param.set', path: 'camera.ev', value: 2 }, 'agent'); } catch (e) { warn(e.message); }
wb.agent({ mode: 'ask' });
use(wb);       // now ask the agent to "add a mosaic of the papers": its tile appears in the Workspace as a pending change
