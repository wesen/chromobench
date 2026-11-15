// simple: three steps for the photographer, one at a time, big targets (guide §8.3). Pick with P and X, print with
// four nudges and the ring-around ("which one is better?"), save. The agent's suggestion sits under the print.
export default {
  id: 'simple',
  label: 'Three steps',
  description: 'Pick, Print, Save',
  // new recipes print normalised: the grey card at the aim, no time or aperture to set (CHB-031)
  enlarger: 'normalised',
  build: (ck, cb) =>
    cb
      .studio('Chromobench')
      .theme('craftkit')
      .menus(...cb.menus.standard())
      .module(
        ck
          .module('main', { label: 'Chromobench' })
          .top(cb.bar.steps(['pick', 'print', 'save'], { pick: '① Pick', print: '② Print', save: '③ Save' }))
          .center(
            ck.match(
              s => s.view.step,
              {
                pick: cb.view.grid({ id: 'pick-grid', size: 'large', keys: { P: 'frame.pick', X: 'frame.reject', Enter: ['step.go', 'print'] } }),
                print: ck.row(
                  { grow: 1 },
                  cb.viewer(s => cb.frame(s)?.print() ?? null, { id: 'main', tools: ['ring-around'] }),
                  ck.column(
                    { width: 320, class: 'cb-simple-side' },
                    cb.nudge('print.enlarger.time_s', { labels: ['Lighter', 'Darker'], step: '1/3 st' }),
                    cb.nudge('print.lights.logH', { labels: ['Warmer', 'Cooler'], axis: 'yellow-blue', step: '2 pt' }),
                    cb.nudge('print.lights.logH', { labels: ['Greener', 'More magenta'], axis: 'magenta-green', step: '2 pt' }),
                    cb.nudge('print.grade', { labels: ['Softer', 'Harder'], step: 0.5 }),
                    ck.ui.command('tool.ring-around', { text: 'Which looks best?', primary: true }),
                    cb.approvals({ compact: true }),
                  ),
                ),
                save: cb.panel.output({ simple: true }),
              },
              { of: ['pick', 'print', 'save'] },
            ),
          ),
      ),
};
