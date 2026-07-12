(function () {
  const vscode = acquireVsCodeApi();
  const root = document.getElementById('calendar-root');

  let state = null; // último monthData recibido

  function render(data) {
    state = data;
    root.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'cal-header';

    const prevBtn = document.createElement('button');
    prevBtn.textContent = '◀';
    prevBtn.title = 'Mes anterior';
    prevBtn.addEventListener('click', () => requestMonth(shiftMonth(data.year, data.month, -1)));

    const label = document.createElement('span');
    label.className = 'cal-month-label';
    label.textContent = `${data.monthLabel} ${data.year}`;
    label.title = 'Ir a un mes concreto';
    label.addEventListener('click', () => showMonthPicker(data));

    const nextBtn = document.createElement('button');
    nextBtn.textContent = '▶';
    nextBtn.title = 'Mes siguiente';
    nextBtn.addEventListener('click', () => requestMonth(shiftMonth(data.year, data.month, 1)));

    header.appendChild(prevBtn);
    header.appendChild(label);
    header.appendChild(nextBtn);
    root.appendChild(header);

    const table = document.createElement('table');
    table.className = 'cal-grid';

    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    const weekTh = document.createElement('th');
    weekTh.className = 'cal-week-col';
    headRow.appendChild(weekTh);
    for (const label of data.weekdayLabels) {
      const th = document.createElement('th');
      th.textContent = label;
      headRow.appendChild(th);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    for (const week of data.weeks) {
      const tr = document.createElement('tr');

      const weekTd = document.createElement('td');
      weekTd.className = 'cal-week-num';
      weekTd.textContent = String(week.isoWeek);
      weekTd.title = `Nota semanal ${week.isoYear}-W${String(week.isoWeek).padStart(2, '0')}`;
      weekTd.appendChild(makeDots(week.dots));
      weekTd.addEventListener('click', () =>
        vscode.postMessage({ type: 'openWeekly', isoYear: week.isoYear, isoWeek: week.isoWeek })
      );
      tr.appendChild(weekTd);

      for (const day of week.days) {
        const td = document.createElement('td');
        td.className = 'cal-cell' + (day.inMonth ? '' : ' out-of-month') + (day.isToday ? ' is-today' : '');
        td.title = day.isoDate;

        const num = document.createElement('span');
        num.className = 'cal-day-num';
        num.textContent = String(day.dayOfMonth);
        td.appendChild(num);
        td.appendChild(makeDots(day.dots));

        td.addEventListener('click', () => vscode.postMessage({ type: 'openDaily', isoDate: day.isoDate }));
        tr.appendChild(td);
      }

      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    root.appendChild(table);
  }

  function makeDots(count) {
    const wrap = document.createElement('div');
    wrap.className = 'cal-dots';
    for (let i = 0; i < count; i++) {
      const dot = document.createElement('span');
      dot.className = 'cal-dot';
      wrap.appendChild(dot);
    }
    return wrap;
  }

  function shiftMonth(year, month, delta) {
    const d = new Date(year, month + delta, 1);
    return { year: d.getFullYear(), month: d.getMonth() };
  }

  function requestMonth({ year, month }) {
    vscode.postMessage({ type: 'requestMonth', year, month });
  }

  function showMonthPicker(data) {
    root.innerHTML = '';
    const input = document.createElement('input');
    input.type = 'month';
    input.className = 'cal-month-picker';
    input.value = `${data.year}-${String(data.month + 1).padStart(2, '0')}`;
    input.addEventListener('change', () => {
      const [y, m] = input.value.split('-').map(Number);
      if (y && m) {
        requestMonth({ year: y, month: m - 1 });
      }
    });
    input.addEventListener('blur', () => render(state));
    root.appendChild(input);
    input.focus();
    input.showPicker?.();
  }

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (message.type === 'monthData') {
      render(message);
    } else if (message.type === 'emptyState') {
      root.innerHTML = `<div class="cal-empty-state">${message.text}</div>`;
    }
  });

  vscode.postMessage({ type: 'ready' });
})();
