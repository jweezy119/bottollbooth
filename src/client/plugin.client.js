'use strict';

/* ------------------------------------------------------------------ *
 * BotTollbooth — CLIENT HALF (the `code.client` plugin function body)
 * ------------------------------------------------------------------ *
 * Plain-JS function body passed to `cordis_define` under `code.client`.
 * Runs in the browser page inside the DSH Cordis client runner.
 *
 *   - Injects the UI seats we depend on: `slots`, `theme`, `host`.
 *   - Registers a business view into the Package-owned slot
 *     `tool.view.cordis` with `key: 'self'` (the Guard binds that key to
 *     the current Plugin+Package automatically).
 *   - Renders the dashboard with React.createElement — NO JSX, NO import,
 *     NO window/document — per runner constraints.
 *   - Reaches the host half over JSON-RPC with `host.call` and applies
 *     the theme service (`ctx.theme.palette`) instead of hard-coding colors.
 * ------------------------------------------------------------------ */

function client() {
  const PERIODS = ['7d', '30d', '90d', '365d'];

  return {
    inject: ['slots', 'theme', 'host'],

    apply(ctx) {
      const { palette } = ctx.theme;

      const style = {
        root: {
          border: `1px solid ${palette.border}`,
          borderRadius: '10px',
          padding: '16px',
          background: palette.background,
          color: palette.text,
          fontFamily: 'inherit',
        },
        title: { fontSize: '1.05em', fontWeight: 600, margin: '0 0 12px' },
        row: { display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '12px' },
        card: {
          flex: '1 1 140px', padding: '12px', borderRadius: '8px',
          background: palette.card, border: `1px solid ${palette.border}`,
        },
        value: { fontSize: '1.4em', fontWeight: 700, margin: '0' },
        label: { fontSize: '0.78em', opacity: 0.75, margin: '2px 0 0' },
        pill: {
          display: 'inline-block', padding: '2px 8px', borderRadius: '999px',
          background: palette.accent, color: palette.accentText, fontSize: '0.74em',
        },
        button: {
          padding: '8px 14px', borderRadius: '6px', border: 'none', cursor: 'pointer',
          background: palette.accent, color: palette.accentText, fontWeight: 600,
        },
      };

      ctx.slots.inject('tool.view.cordis', () => ctx.slots.register(
        { name: 'tool.view.cordis', key: 'self' },
        () => {
          const [period, setPeriod] = React.useState('30d');
          const [data, setData] = React.useState(null);
          const [comparing, setComparing] = React.useState(false);

          React.useEffect(() => {
            let alive = true;
            ctx.host.call('botDetection.summary', { period }).then((res) => {
              if (alive) setData(res);
            });
            return () => { alive = false; };
          }, [period]);

          const toggleCompare = () => setComparing((v) => !v);

          const elements = [
            React.createElement('div', { key: 'title', style: style.title },
              '🤖 Bot Traffic Impact Dashboard'),

            React.createElement('div', { key: 'period', style: style.row },
              PERIODS.map((p) =>
                React.createElement('button', {
                  key: p,
                  onClick: () => setPeriod(p),
                  style: { ...style.button, opacity: period === p ? 1 : 0.55 },
                }, p)),
              React.createElement('label', { key: 'cmp', style: { alignSelf: 'center' } },
                React.createElement('input', {
                  type: 'checkbox',
                  checked: comparing,
                  onChange: toggleCompare,
                }),
                ' Compare with previous period')),

            React.createElement('div', { key: 'metrics', style: style.row },
              React.createElement('div', { key: 'bot', style: style.card },
                React.createElement('p', { style: style.value },
                  data ? `${Math.round(data.summary.botRate * 100)}%` : '—'),
                React.createElement('p', { style: style.label }, 'Bot Rate')),
              React.createElement('div', { key: 'human', style: style.card },
                React.createElement('p', { style: style.value },
                  data ? `${Math.round((1 - data.summary.botRate) * 100)}%` : '—'),
                React.createElement('p', { style: style.label }, 'Human Rate')),
              React.createElement('div', { key: 'rev', style: style.card },
                React.createElement('p', { style: style.value },
                  data ? `$${data.impact.recoveredMonthly.toFixed(2)}` : '—'),
                React.createElement('p', { style: style.label }, 'Recoverable Rev./mo')),
              React.createElement('div', { key: 'visitors', style: style.card },
                React.createElement('p', { style: style.value },
                  data ? data.impact.monthlyVisitors.toLocaleString() : '—'),
                React.createElement('p', { style: style.label }, 'Sampled Visits'))),
          ];

          elements.push(React.createElement('div', { key: 'footer', style: { marginTop: '10px' } },
            React.createElement('a', {
              href: 'https://www.cloudflare.com/pricing/',
              target: '_blank',
              rel: 'noreferrer',
              style: style.button,
            }, 'Protect Traffic →')));

          return React.createElement('div', { style: style.root }, ...elements);
        },
      ));
    },
  };
}

module.exports = client;