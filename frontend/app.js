/**
 * Packfolio — Telegram Mini App
 * Чистый JS, без фреймворков. Hash-based роутинг.
 */

// ──────────────────────────────────────────────
// Конфигурация
// ──────────────────────────────────────────────

const CONFIG = {
  // В разработке меняйте на http://localhost:8000
  API_BASE: window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:8000'
    : '',
};

// ──────────────────────────────────────────────
// Состояние приложения
// ──────────────────────────────────────────────

const State = {
  token: null,
  user: null,
  currentTab: 'trips',
  trips: [],
  tags: [],
  documents: [],
  // Фильтры для документов
  docFilters: { q: '', doc_type: '', trip_id: '', tag_id: '' },
  // Выбранный месяц для календаря (YYYY-MM)
  calMonth: (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  })(),
  calSelectedDay: null,
  calEvents: [],
};

// ──────────────────────────────────────────────
// Telegram WebApp
// ──────────────────────────────────────────────

const TG = window.Telegram?.WebApp;

function tgInit() {
  if (TG) {
    TG.ready();
    TG.expand();
    TG.setHeaderColor('bg_color');
    TG.setBottomBarColor('bg_color');
  }
}

function getInitData() {
  if (TG && TG.initData) return TG.initData;
  // Dev fallback: передаём JSON пользователя напрямую
  return 'user={"id":1,"first_name":"Dev","last_name":"User","username":"devuser"}&auth_date=9999999999&hash=dev';
}

// ──────────────────────────────────────────────
// API клиент
// ──────────────────────────────────────────────

const API = {
  async request(method, path, body, isForm = false) {
    const headers = {};
    if (State.token) headers['Authorization'] = `Bearer ${State.token}`;
    if (!isForm) headers['Content-Type'] = 'application/json';

    const opts = { method, headers };
    if (body) opts.body = isForm ? body : JSON.stringify(body);

    const res = await fetch(CONFIG.API_BASE + path, opts);

    if (res.status === 401) {
      showToast('Сессия истекла, перезапустите приложение');
      return null;
    }

    if (res.status === 204) return null;

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
    return data;
  },

  get:    (path)        => API.request('GET',    path),
  post:   (path, body)  => API.request('POST',   path, body),
  put:    (path, body)  => API.request('PUT',    path, body),
  delete: (path)        => API.request('DELETE', path),
  postForm: (path, fd)  => API.request('POST',   path, fd, true),
  putForm:  (path, fd)  => API.request('PUT',    path, fd, true),
};

// ──────────────────────────────────────────────
// Утилиты
// ──────────────────────────────────────────────

function qs(sel, root = document) { return root.querySelector(sel); }
function qsa(sel, root = document) { return [...root.querySelectorAll(sel)]; }
function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

function showToast(msg, duration = 2500) {
  const t = qs('#toast');
  t.textContent = msg;
  t.classList.add('visible');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('visible'), duration);
}

function calcNights(checkIn, checkOut) {
  if (!checkIn || !checkOut) return null;
  // Accept YYYY-MM-DD or dd.mm.yy
  const parse = (s) => {
    const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (iso) return new Date(s);
    const dmy = s.match(/^(\d{2})\.(\d{2})\.(\d{2})$/);
    if (dmy) return new Date(`20${dmy[3]}-${dmy[2]}-${dmy[1]}`);
    return new Date(s);
  };
  const d1 = parse(checkIn), d2 = parse(checkOut);
  if (isNaN(d1) || isNaN(d2)) return null;
  const n = Math.round((d2 - d1) / 86400000);
  return n > 0 ? n : null;
}

function formatDate(str) {
  if (!str) return '—';
  // Handle ISO date string without timezone shift
  const m = String(str).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    return `${m[3]}.${m[2]}.${m[1].slice(-2)}`;
  }
  const d = new Date(str);
  if (isNaN(d)) return str;
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(-2);
  return `${dd}.${mm}.${yy}`;
}

function formatDateShort(str) {
  return formatDate(str);
}

// Иконки и названия типов документов
const DOC_TYPES = {
  PASSPORT:          { icon: '🛂', label: 'Паспорт',          color: 'type-PASSPORT' },
  TRANSFER:          { icon: '🎟', label: 'Трансфер',         color: 'type-TRANSFER' },
  // Билеты хранятся с конкретным типом, но отображаются как «Трансфер»
  FLIGHT_TICKET:     { icon: '✈️', label: 'Трансфер',         color: 'type-TRANSFER' },
  TRAIN_TICKET:      { icon: '🚆', label: 'Трансфер',         color: 'type-TRANSFER' },
  BUS_TICKET:        { icon: '🚌', label: 'Трансфер',         color: 'type-TRANSFER' },
  HOTEL_BOOKING:     { icon: '🏨', label: 'Отель',            color: 'type-HOTEL_BOOKING' },
  CAR_RENTAL:        { icon: '🚗', label: 'Аренда авто',      color: 'type-CAR_RENTAL' },
  MEDICAL_INSURANCE: { icon: '🏥', label: 'Страховка',        color: 'type-MEDICAL_INSURANCE' },
  UNKNOWN:           { icon: '📄', label: 'Неизвестно',       color: 'type-UNKNOWN' },
};

// Типы в фильтр-чипах (Трансфер объединяет три билетных типа)
const FILTER_TYPES = [
  { val: '',                  label: 'Все' },
  { val: 'TRANSFER',          label: '🎟 Трансфер' },
  { val: 'PASSPORT',          label: '🛂 Паспорт' },
  { val: 'HOTEL_BOOKING',     label: '🏨 Отель' },
  { val: 'CAR_RENTAL',        label: '🚗 Аренда авто' },
  { val: 'MEDICAL_INSURANCE', label: '🏥 Страховка' },
  { val: 'UNKNOWN',           label: '📄 Неизвестно' },
];

// Типы для ручного выбора (в загрузке и на карточке UNKNOWN)
const SELECT_TYPES = [
  { val: 'FLIGHT_TICKET',     label: '✈️ Авиабилет' },
  { val: 'TRAIN_TICKET',      label: '🚆 Ж/д билет' },
  { val: 'BUS_TICKET',        label: '🚌 Автобус' },
  { val: 'HOTEL_BOOKING',     label: '🏨 Отель' },
  { val: 'CAR_RENTAL',        label: '🚗 Аренда авто' },
  { val: 'MEDICAL_INSURANCE', label: '🏥 Страховка' },
  { val: 'PASSPORT',          label: '🛂 Паспорт' },
  { val: 'UNKNOWN',           label: '📄 Неизвестно' },
];

const TRANSFER_TYPES = new Set(['FLIGHT_TICKET', 'TRAIN_TICKET', 'BUS_TICKET']);

// Человекочитаемые названия полей виджета
const WIDGET_LABELS = {
  hotel_name:        'Название',
  address:           'Адрес',
  check_in:          'Заезд',
  check_out:         'Выезд',
  nights:            'Ночей',
  room_type:         'Тип номера',
  guests:            'Гостей',
  flight_number:     'Номер рейса',
  pnr:               'PNR / Бронь',
  seat:              'Место',
  departure_place:   'Откуда',
  arrival_place:     'Куда',
  departure_date:    'Отправление',
  departure_time:    'Время вылета',
  arrival_date:      'Прибытие',
  arrival_time:      'Время прибытия',
  baggage:           'Багаж',
  tariff:            'Тариф / класс',
  passengers:        'Пассажиров',
  car_model:         'Марка авто',
  plate:             'Номер авто',
  pickup_date:       'Дата выдачи',
  pickup_time:       'Время выдачи',
  dropoff_date:      'Дата возврата',
  dropoff_time:      'Время возврата',
  coverage_amount:   'Сумма покрытия',
  days:              'Дней',
  start_date:        'Начало',
  end_date:          'Конец',
  surname:           'Фамилия',
  given_names:       'Имя',
  nationality:       'Гражданство',
  date_of_birth:     'Дата рождения',
  expiry_date:       'Действует до',
};

// Типы полей для форматирования
const DATE_FIELDS = new Set([
  'check_in','check_out',
  'pickup_date','dropoff_date','start_date','end_date',
  'date_of_birth','expiry_date',
]);
const TIME_FIELDS = new Set([
  'departure_time','arrival_time','pickup_time','dropoff_time',
]);
// departure_date / arrival_date хранят дату и время вместе
const DATETIME_FIELDS_MAP = {
  departure_date: 'departure_time',
  arrival_date:   'arrival_time',
};
const DATETIME_FIELDS = new Set(Object.keys(DATETIME_FIELDS_MAP));

// "YYYY-MM-DD[ HH:MM]" → "dd.mm.yy hh:mm" (время опционально)
function formatDatetime(dateStr, timeStr) {
  if (!dateStr) return null;
  const d = formatDate(dateStr);
  if (!d || d === '—') return null;
  // время может быть внутри dateStr ("YYYY-MM-DD HH:MM") или отдельно
  const inlineTime = String(dateStr).match(/[T ](\d{2}:\d{2})/)?.[1];
  const t = inlineTime || timeStr || null;
  return t ? `${d} ${t}` : d;
}

// "dd.mm.yy hh:mm" → ["YYYY-MM-DD", "HH:MM"] (время может быть null)
function parseIsoDatetime(str) {
  if (!str) return [null, null];
  const s = str.trim();
  const m2 = s.match(/^(\d{2})\.(\d{2})\.(\d{2})\s+(\d{2}):(\d{2})$/);
  if (m2) return [`20${m2[3]}-${m2[2]}-${m2[1]}`, `${m2[4]}:${m2[5]}`];
  const m4 = s.match(/^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})$/);
  if (m4) return [`${m4[3]}-${m4[2]}-${m4[1]}`, `${m4[4]}:${m4[5]}`];
  return [toIsoDate(s), null];
}

// Отображение значения поля с учётом типа
// allData — опционально, для DATETIME_FIELDS (достать время из соседнего поля)
function displayFieldValue(key, val, allData) {
  if (val === null || val === undefined || val === '') {
    // datetime: может быть пусто само поле, но есть время
    if (DATETIME_FIELDS.has(key)) return null;
    return null;
  }
  const s = String(val);
  if (DATETIME_FIELDS.has(key)) {
    const timeKey = DATETIME_FIELDS_MAP[key];
    return formatDatetime(s, allData?.[timeKey]);
  }
  if (DATE_FIELDS.has(key)) return formatDate(s);
  return s;
}

// Конвертация dd.mm.yy(yy) → YYYY-MM-DD для хранения
function toIsoDate(str) {
  if (!str) return str;
  const s = str.trim();
  // dd.mm.yy
  const m2 = s.match(/^(\d{2})\.(\d{2})\.(\d{2})$/);
  if (m2) return `20${m2[3]}-${m2[2]}-${m2[1]}`;
  // dd.mm.yyyy
  const m4 = s.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (m4) return `${m4[3]}-${m4[2]}-${m4[1]}`;
  return s;
}

// ── Всплывающий пикер дат ──────────────────────

const DP_MONTHS = ['Январь','Февраль','Март','Апрель','Май','Июнь',
  'Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
const DP_DAYS = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];

function createDatePicker(anchorEl, onSelect) {
  const isoInit = toIsoDate(anchorEl.value);
  const today = new Date();
  let selDate = (isoInit && isoInit.match(/^\d{4}-\d{2}-\d{2}/)) ? isoInit.slice(0, 10) : null;
  let viewYear  = selDate ? +selDate.slice(0, 4) : today.getFullYear();
  let viewMonth = selDate ? +selDate.slice(5, 7) - 1 : today.getMonth();

  const popup = el('div', 'datepicker-popup');
  // Prevent any click inside popup from blurring the input
  popup.addEventListener('mousedown', e => e.preventDefault());
  popup.addEventListener('touchstart', e => e.preventDefault(), { passive: false });

  const render = () => {
    popup.innerHTML = '';

    // Header
    const header = el('div', 'dp-header');
    const prevBtn = el('button', 'dp-nav', '&#8249;');
    prevBtn.type = 'button';
    prevBtn.addEventListener('mousedown', e => {
      e.preventDefault();
      if (--viewMonth < 0) { viewMonth = 11; viewYear--; }
      render();
    });
    const nextBtn = el('button', 'dp-nav', '&#8250;');
    nextBtn.type = 'button';
    nextBtn.addEventListener('mousedown', e => {
      e.preventDefault();
      if (++viewMonth > 11) { viewMonth = 0; viewYear++; }
      render();
    });
    const title = el('div', 'dp-title', `${DP_MONTHS[viewMonth]} ${viewYear}`);
    header.appendChild(prevBtn);
    header.appendChild(title);
    header.appendChild(nextBtn);
    popup.appendChild(header);

    // Weekday names
    const weekdays = el('div', 'dp-weekdays');
    DP_DAYS.forEach(d => weekdays.appendChild(el('div', 'dp-weekday', d)));
    popup.appendChild(weekdays);

    // Days grid
    const grid = el('div', 'dp-grid');
    const firstDow = new Date(viewYear, viewMonth, 1).getDay();
    const offset = (firstDow + 6) % 7; // Monday-start
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

    for (let i = 0; i < offset; i++) grid.appendChild(el('div', 'dp-cell dp-empty'));

    for (let d = 1; d <= daysInMonth; d++) {
      const iso = `${viewYear}-${String(viewMonth + 1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const cell = el('div', 'dp-cell', String(d));
      if (iso === selDate) cell.classList.add('dp-selected');
      if (viewYear === today.getFullYear() && viewMonth === today.getMonth() && d === today.getDate())
        cell.classList.add('dp-today');

      cell.addEventListener('mousedown', e => {
        e.preventDefault();
        selDate = iso;
        onSelect(iso);   // caller sets input.value and calls input.blur()
        destroy();
      });
      // Touch support
      cell.addEventListener('touchend', e => {
        e.preventDefault();
        selDate = iso;
        onSelect(iso);
        destroy();
      });
      grid.appendChild(cell);
    }

    // Всегда 6 строк (42 ячейки) — фиксированный размер на любой месяц
    const total = offset + daysInMonth;
    for (let i = total; i < 42; i++) grid.appendChild(el('div', 'dp-cell dp-empty'));

    popup.appendChild(grid);
  };

  const position = () => {
    const r = anchorEl.getBoundingClientRect();
    popup.style.left = Math.min(r.left, window.innerWidth - 280) + 'px';
    const spaceBelow = window.innerHeight - r.bottom - 8;
    if (spaceBelow >= 280) {
      popup.style.top = (r.bottom + 4) + 'px';
      popup.style.bottom = '';
    } else {
      popup.style.top = '';
      popup.style.bottom = (window.innerHeight - r.top + 4) + 'px';
    }
  };

  const destroy = () => popup.remove();

  render();
  document.body.appendChild(popup);
  position();

  return { destroy, highlight: (isoDate) => { selDate = isoDate; render(); } };
}

// Автомаска ввода даты (dd.mm.yy) + пикер
function applyDateMask(input) {
  input.placeholder = 'дд.мм.гг';
  input.maxLength = 8;
  let picker = null;

  input.addEventListener('input', () => {
    let digits = input.value.replace(/\D/g, '').slice(0, 6);
    let masked = '';
    if (digits.length > 4) masked = digits.slice(0,2) + '.' + digits.slice(2,4) + '.' + digits.slice(4);
    else if (digits.length > 2) masked = digits.slice(0,2) + '.' + digits.slice(2);
    else masked = digits;
    input.value = masked;
    // Sync picker highlight when full date typed
    if (picker && digits.length === 6) picker.highlight(toIsoDate(masked));
  });

  input.addEventListener('focus', () => {
    if (picker) return;
    picker = createDatePicker(input, isoDate => {
      const [y, m, d] = isoDate.split('-');
      input.value = `${d}.${m}.${y.slice(-2)}`;
      picker = null;
      input.blur();   // triggers save
    });
  });

  // Close picker when input blurs (e.g. user taps outside)
  input.addEventListener('blur', () => {
    if (picker) { picker.destroy(); picker = null; }
  });
}

// ── Барабан для выбора числа (часы / минуты) ───

function createDrumCol(min, max, initial, onChange) {
  const H = 44; // высота одного элемента
  const HALF = 2 * H; // отступ = 2 элемента, чтобы первый/последний были по центру

  const col = document.createElement('div');
  col.className = 'tp-drum-col';

  // Верхний отступ
  const padT = document.createElement('div');
  padT.style.height = HALF + 'px';
  col.appendChild(padT);

  for (let v = min; v <= max; v++) {
    const item = document.createElement('div');
    item.className = 'tp-drum-item';
    item.textContent = String(v).padStart(2, '0');
    item.dataset.v = v;
    col.appendChild(item);
  }

  // Нижний отступ
  const padB = document.createElement('div');
  padB.style.height = HALF + 'px';
  col.appendChild(padB);

  const items = () => [...col.querySelectorAll('.tp-drum-item')];

  const highlightCenter = () => {
    const idx = Math.round(col.scrollTop / H);
    items().forEach((it, i) => it.classList.toggle('tp-center', i === idx));
  };

  // Установить начальное значение
  requestAnimationFrame(() => {
    col.scrollTop = (initial - min) * H;
    highlightCenter();
  });

  // Клик по элементу — прокрутить к нему
  col.addEventListener('mousedown', e => {
    const item = e.target.closest('.tp-drum-item[data-v]');
    if (!item) return;
    e.preventDefault();
    const v = parseInt(item.dataset.v);
    col.scrollTo({ top: (v - min) * H, behavior: 'smooth' });
    onChange(v);
  });
  col.addEventListener('touchend', e => {
    const item = e.target.closest('.tp-drum-item[data-v]');
    if (item) { e.preventDefault(); }
  });

  let scrollTimer;
  col.addEventListener('scroll', () => {
    highlightCenter();
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => {
      const v = Math.max(min, Math.min(max, Math.round(col.scrollTop / H) + min));
      col.scrollTo({ top: (v - min) * H, behavior: 'smooth' });
      onChange(v);
    }, 120);
  }, { passive: true });

  return col;
}

// ── Пикер времени (барабан часов и минут) ───────

function createTimePicker(anchorEl, initialTime, onSelect) {
  let hh = 12, mm = 0;
  if (initialTime) {
    const p = initialTime.split(':');
    const ph = parseInt(p[0]), pm = parseInt(p[1]);
    if (!isNaN(ph)) hh = ph;
    if (!isNaN(pm)) mm = pm;
  }

  const popup = document.createElement('div');
  popup.className = 'timepicker-popup';
  popup.addEventListener('mousedown', e => e.preventDefault());
  popup.addEventListener('touchstart', e => e.preventDefault(), { passive: false });

  const titleEl = document.createElement('div');
  titleEl.className = 'tp-title';
  const updateTitle = () => {
    titleEl.textContent = `${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}`;
  };
  updateTitle();
  popup.appendChild(titleEl);

  const drumRow = document.createElement('div');
  drumRow.className = 'tp-drum-row';

  const hoursCol = createDrumCol(0, 23, hh, v => { hh = v; updateTitle(); });
  const sep = document.createElement('div');
  sep.className = 'tp-sep';
  sep.textContent = ':';
  const minsCol = createDrumCol(0, 59, mm, v => { mm = v; updateTitle(); });

  drumRow.appendChild(hoursCol);
  drumRow.appendChild(sep);
  drumRow.appendChild(minsCol);
  popup.appendChild(drumRow);

  const doneBtn = document.createElement('button');
  doneBtn.className = 'btn btn-primary tp-done';
  doneBtn.textContent = 'Готово';
  const confirm = () => {
    onSelect(`${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}`);
    destroy();
  };
  doneBtn.addEventListener('mousedown', e => { e.preventDefault(); confirm(); });
  doneBtn.addEventListener('touchend',  e => { e.preventDefault(); confirm(); });
  popup.appendChild(doneBtn);

  // Позиционирование — такое же как у datepicker
  const r = anchorEl.getBoundingClientRect();
  popup.style.position = 'fixed';
  popup.style.left = Math.min(r.left, window.innerWidth - 290) + 'px';
  if (window.innerHeight - r.bottom - 8 >= 310) {
    popup.style.top = (r.bottom + 4) + 'px';
  } else {
    popup.style.bottom = (window.innerHeight - r.top + 4) + 'px';
  }

  document.body.appendChild(popup);
  const destroy = () => popup.remove();
  return { destroy };
}

// Автомаска ввода даты+времени (dd.mm.yy hh:mm) + пикер даты → барабан времени
function applyDatetimeMask(input) {
  input.placeholder = 'дд.мм.гг чч:мм';
  input.maxLength = 14;
  let picker = null;

  input.addEventListener('input', () => {
    const digits = input.value.replace(/\D/g, '').slice(0, 10);
    let m = '';
    if (digits.length > 8)      m = `${digits.slice(0,2)}.${digits.slice(2,4)}.${digits.slice(4,6)} ${digits.slice(6,8)}:${digits.slice(8)}`;
    else if (digits.length > 6) m = `${digits.slice(0,2)}.${digits.slice(2,4)}.${digits.slice(4,6)} ${digits.slice(6)}`;
    else if (digits.length > 4) m = `${digits.slice(0,2)}.${digits.slice(2,4)}.${digits.slice(4)}`;
    else if (digits.length > 2) m = `${digits.slice(0,2)}.${digits.slice(2)}`;
    else m = digits;
    input.value = m;
    if (picker && digits.length >= 6) picker.highlight?.(toIsoDate(m.slice(0, 8)));
  });

  input.addEventListener('focus', () => {
    if (picker) return;
    picker = createDatePicker(input, isoDate => {
      const [y, mo, d] = isoDate.split('-');
      const datePart = `${d}.${mo}.${y.slice(-2)}`;
      const existingTime = input.value.match(/\s(\d{2}:\d{2})$/)?.[1];
      // picker уже уничтожен внутри createDatePicker (destroy() после onSelect)
      picker = createTimePicker(input, existingTime || null, time => {
        input.value = `${datePart} ${time}`;
        picker = null;
        input.blur(); // триггер сохранения
      });
    });
  });

  input.addEventListener('blur', () => {
    if (picker) { picker.destroy(); picker = null; }
  });
}

// Автомаска ввода времени (hh:mm)
function applyTimeMask(input) {
  input.placeholder = 'чч:мм';
  input.maxLength = 5;
  input.addEventListener('input', () => {
    let digits = input.value.replace(/\D/g, '').slice(0, 4);
    input.value = digits.length > 2 ? digits.slice(0,2) + ':' + digits.slice(2) : digits;
  });
}

// Поля для каждого типа документа (отображаемые в виджете)
// Поля, которые в мини-карточке показываются только если заполнены
const OPTIONAL_MINI_FIELDS = new Set(['seat','baggage','tariff','passengers']);

const WIDGET_FIELDS = {
  HOTEL_BOOKING:      ['hotel_name','address','check_in','check_out','nights','room_type','guests'],
  FLIGHT_TICKET:      ['flight_number','pnr','departure_place','departure_date','arrival_place','arrival_date','seat','passengers','baggage','tariff'],
  TRAIN_TICKET:       ['pnr','departure_place','departure_date','arrival_place','arrival_date','seat','passengers','tariff'],
  BUS_TICKET:         ['pnr','departure_place','departure_date','arrival_place','arrival_date','seat','passengers','tariff'],
  // departure_time / arrival_time хранятся в data, но не показываются отдельно
  CAR_RENTAL:         ['car_model','plate','pickup_date','pickup_time','dropoff_date','dropoff_time'],
  MEDICAL_INSURANCE:  ['days','coverage_amount','start_date','end_date'],
  PASSPORT:           ['surname','given_names','nationality','date_of_birth','expiry_date'],
  UNKNOWN:            [],
};

function getDocInfo(type) {
  return DOC_TYPES[type] || DOC_TYPES.UNKNOWN;
}

function confidenceClass(conf) {
  if (conf >= 0.7) return 'conf-high';
  if (conf >= 0.4) return 'conf-medium';
  return 'conf-low';
}

function confidenceLabel(conf) {
  const pct = Math.round(conf * 100);
  return `${pct}% уверенность`;
}

// ──────────────────────────────────────────────
// Модальные окна
// ──────────────────────────────────────────────

const Modal = {
  stack: [],

  open(contentFn, opts = {}) {
    const overlay = el('div', 'modal-overlay');
    if (opts.center) overlay.classList.add('center');

    const sheet = el('div', `modal-sheet${opts.full ? ' modal-full' : ''}`);
    sheet.innerHTML = '';

    overlay.appendChild(sheet);
    document.body.appendChild(overlay);
    this.stack.push(overlay);

    // Закрытие по фону
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay && !opts.noClose) Modal.close();
    });

    contentFn(sheet);
    return overlay;
  },

  close(all = false) {
    if (all) {
      this.stack.forEach(o => o.remove());
      this.stack = [];
    } else {
      const last = this.stack.pop();
      if (last) last.remove();
    }
  },

  buildHeader(title, onClose) {
    const h = el('div', 'modal-header');
    h.innerHTML = `<span class="modal-title">${title}</span>`;
    const btn = el('button', 'btn-ghost');
    btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
    btn.onclick = onClose || (() => Modal.close());
    h.appendChild(btn);
    return h;
  },
};

// ──────────────────────────────────────────────
// Рендеры страниц
// ──────────────────────────────────────────────

// ── ГЛАВНАЯ ──

function renderHomePage() {
  const c = qs('#page-content');
  c.innerHTML = '';
  qs('#page-title').textContent = 'Главная';
  qs('#fab').classList.add('hidden');

  // Приветствие
  const greeting = el('div', '');
  greeting.style.cssText = 'padding:20px var(--gap) 0';
  const name = State.user?.first_name || '';
  greeting.innerHTML = `
    <div style="font-size:12px;font-weight:500;color:var(--text-hint);text-transform:uppercase;letter-spacing:.6px;margin-bottom:6px">Добро пожаловать${name ? ', ' + escHtml(name) : ''}</div>
    <div style="font-size:28px;font-weight:400;letter-spacing:0">Ваши документы</div>
  `;
  c.appendChild(greeting);

  // Ближайшая поездка
  const upcoming = State.trips
    .filter(t => t.end_date && t.end_date >= new Date().toISOString().slice(0,10))
    .sort((a,b) => (a.start_date||'') < (b.start_date||'') ? -1 : 1)[0];

  if (upcoming) {
    const label = el('div', 'section-title', 'Ближайшая поездка');
    c.appendChild(label);

    const heroCard = el('div', 'widget-hero-card');
    heroCard.style.cursor = 'pointer';
    heroCard.innerHTML = `
      <div style="font-size:12px;font-weight:500;color:rgba(255,255,255,0.5);text-transform:uppercase;letter-spacing:.6px;margin-bottom:10px">Поездка</div>
      <div style="font-size:24px;font-weight:400;margin-bottom:14px">${escHtml(upcoming.title)}</div>
      <div style="display:flex;gap:20px;flex-wrap:wrap">
        ${upcoming.locations ? `<div>
          <div style="font-size:10px;font-weight:500;color:rgba(255,255,255,0.5);text-transform:uppercase;letter-spacing:.5px">Место</div>
          <div style="font-size:16px;margin-top:3px">${escHtml(upcoming.locations)}</div>
        </div>` : ''}
        ${upcoming.start_date ? `<div>
          <div style="font-size:10px;font-weight:500;color:rgba(255,255,255,0.5);text-transform:uppercase;letter-spacing:.5px">Начало</div>
          <div style="font-size:16px;margin-top:3px">${formatDate(upcoming.start_date)}</div>
        </div>` : ''}
        ${upcoming.end_date ? `<div>
          <div style="font-size:10px;font-weight:500;color:rgba(255,255,255,0.5);text-transform:uppercase;letter-spacing:.5px">Конец</div>
          <div style="font-size:16px;margin-top:3px">${formatDate(upcoming.end_date)}</div>
        </div>` : ''}
      </div>
    `;
    heroCard.onclick = () => openTripDetail(upcoming);
    c.appendChild(heroCard);
  }

  // Последние документы
  const recentDocs = State.documents.slice(0, 3);
  if (recentDocs.length) {
    const label2 = el('div', 'section-title', 'Последние документы');
    c.appendChild(label2);
    recentDocs.forEach(doc => c.appendChild(buildDocMiniCard(doc)));
  }

  // Быстрые действия
  const actLabel = el('div', 'section-title', 'Быстрые действия');
  c.appendChild(actLabel);

  const actRow = el('div', '');
  actRow.style.cssText = 'display:flex;gap:10px;padding:0 var(--gap)';

  const addDocBtn = el('button', 'btn btn-primary', '');
  addDocBtn.style.flex = '1';
  addDocBtn.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path d="M12 5V19M5 12H19" stroke="white" stroke-width="2" stroke-linecap="round"/>
    </svg> Документ`;
  addDocBtn.onclick = () => { App.navigate('docs'); setTimeout(openUploadModal, 100); };

  const addTripBtn = el('button', 'btn btn-secondary', '');
  addTripBtn.style.flex = '1';
  addTripBtn.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path d="M22 16.5H2M6.5 7L2 16.5M17.5 7L22 16.5M6.5 7H17.5M6.5 7L12 3.5L17.5 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg> Поездка`;
  addTripBtn.onclick = () => { App.navigate('trips'); setTimeout(openTripForm, 100); };

  actRow.appendChild(addDocBtn);
  actRow.appendChild(addTripBtn);
  c.appendChild(actRow);

  // Статистика
  const stats = el('div', '');
  stats.style.cssText = 'display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;padding:12px var(--gap) 0';

  [
    { label: 'Поездок',    value: State.trips.length },
    { label: 'Документов', value: State.documents.length },
    { label: 'Тегов',      value: State.tags.length },
  ].forEach(({ label, value }) => {
    const cell = el('div', '');
    cell.style.cssText = `
      background:var(--bg-card);border-radius:var(--radius);border:1px solid var(--border);
      padding:16px 12px;text-align:center;
    `;
    cell.innerHTML = `
      <div style="font-size:28px;font-weight:400;color:var(--accent)">${value}</div>
      <div style="font-size:11px;font-weight:500;color:var(--text-hint);margin-top:4px;text-transform:uppercase;letter-spacing:.4px">${label}</div>
    `;
    stats.appendChild(cell);
  });
  c.appendChild(stats);
}

// ── ПОЕЗДКИ ──

function renderTripsPage() {
  const c = qs('#page-content');
  c.innerHTML = '';
  qs('#page-title').textContent = 'Поездки';
  qs('#fab').classList.remove('hidden');
  qs('#fab').title = 'Новая поездка';

  if (!State.trips.length) {
    c.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none">
            <path d="M22 16.5H2M6.5 7L2 16.5M17.5 7L22 16.5M6.5 7H17.5M6.5 7L12 3.5L17.5 7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
        <strong>Нет поездок</strong>
        <p>Нажмите «+», чтобы добавить первую поездку</p>
      </div>`;
    return;
  }

  const list = el('div', 'trips-list');

  State.trips.forEach(trip => {
    const docCount = State.documents.filter(d => d.trip_id === trip.id).length;
    const card = el('div', 'trip-card');

    const datesStr = [trip.start_date, trip.end_date]
      .filter(Boolean).map(formatDateShort).join(' — ') || 'Даты не указаны';

    card.innerHTML = `
      <div class="trip-card-header">
        <div class="trip-card-title">${escHtml(trip.title)}</div>
      </div>
      <div class="trip-card-meta">
        <span class="trip-meta-chip">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
            <rect x="3" y="4" width="18" height="18" rx="3" stroke="currentColor" stroke-width="2"/>
            <path d="M3 10H21M8 2V6M16 2V6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
          ${escHtml(datesStr)}
        </span>
        ${trip.locations ? `
        <span class="trip-meta-chip">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
            <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" stroke="currentColor" stroke-width="2"/>
            <circle cx="12" cy="9" r="2.5" stroke="currentColor" stroke-width="2"/>
          </svg>
          ${escHtml(trip.locations)}
        </span>` : ''}
        ${docCount ? `
        <span class="trip-meta-chip">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
            <path d="M14 2H6C5.46957 2 4.96086 2.21071 4.58579 2.58579C4.21071 2.96086 4 3.46957 4 4V20C4 20.5304 4.21071 21.0391 4.58579 21.4142C4.96086 21.7893 5.46957 22 6 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V8L14 2Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          ${docCount} доку${docCount === 1 ? 'мент' : 'мента'}
        </span>` : ''}
      </div>
      ${trip.note ? `<div class="trip-card-note">${escHtml(trip.note)}</div>` : ''}
    `;
    card.onclick = () => openTripDetail(trip);
    list.appendChild(card);
  });

  c.appendChild(list);
}

// ── Location autocomplete (Nominatim / OpenStreetMap) ──

function initLocationAutocomplete(input, dropdown) {
  let abortController = null;
  let selectedFromList = false;

  const hide = () => { dropdown.style.display = 'none'; dropdown.innerHTML = ''; };

  const show = (items) => {
    dropdown.innerHTML = '';
    if (!items.length) { hide(); return; }
    items.forEach(({ label, value }) => {
      const item = el('div', 'location-item', escHtml(label));
      item.onmousedown = (e) => {
        e.preventDefault(); // prevent blur before click
        selectedFromList = true;
        input.value = value;
        hide();
      };
      dropdown.appendChild(item);
    });
    dropdown.style.display = 'block';
  };

  input.addEventListener('input', debounce(async () => {
    const q = input.value.trim();
    if (q.length < 2) { hide(); return; }

    if (abortController) abortController.abort();
    abortController = new AbortController();

    try {
      // Запрашиваем больше результатов, чтобы после фильтрации осталось достаточно
      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=12&addressdetails=1`;
      const res = await fetch(url, {
        signal: abortController.signal,
        headers: { 'Accept-Language': 'ru,en' },
      });
      const data = await res.json();

      // Только города / районы / страны — исключаем улицы, площади, достопримечательности
      const CITY_TYPES = new Set([
        'city', 'town', 'village', 'hamlet', 'suburb', 'borough',
        'municipality', 'county', 'state', 'province', 'region',
        'country', 'island', 'administrative',
      ]);

      // Введённые символы должны стоять в начале хотя бы одного слова в строке
      const qLower = q.toLowerCase();
      const matchesWordStart = (str) => {
        if (!str) return false;
        return str.toLowerCase().split(/[\s,\-\/().]+/).some(w => w.startsWith(qLower));
      };

      const seen = new Set();
      const items = [];
      for (const place of data) {
        // Фильтр 1: тип места — только населённые пункты и административные единицы
        if (!CITY_TYPES.has(place.type)) continue;

        const addr = place.address || {};
        const city = addr.city || addr.town || addr.village || addr.county || '';
        const country = addr.country || '';
        // place.name используем только если из address ничего не получили
        const displayCity = city || place.name || '';
        const value = [displayCity, country].filter(Boolean).join(', ');
        if (!value || seen.has(value)) continue;

        // Фильтр 2: запрос должен быть в начале слова отображаемого названия
        if (!matchesWordStart(displayCity) && !matchesWordStart(country)) continue;

        seen.add(value);
        items.push({ label: value, value });
        if (items.length >= 5) break;
      }
      show(items);
    } catch (e) {
      if (e.name !== 'AbortError') hide();
    }
  }, 350));

  input.addEventListener('blur', () => {
    // Small delay so onmousedown fires first
    setTimeout(() => { if (!selectedFromList) hide(); selectedFromList = false; }, 150);
  });

  input.addEventListener('keydown', e => {
    const items = dropdown.querySelectorAll('.location-item');
    const active = dropdown.querySelector('.location-item.active');
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = active ? active.nextElementSibling : items[0];
      if (next) { active?.classList.remove('active'); next.classList.add('active'); }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = active ? active.previousElementSibling : items[items.length - 1];
      if (prev) { active?.classList.remove('active'); prev.classList.add('active'); }
    } else if (e.key === 'Enter' && active) {
      e.preventDefault();
      input.value = active.textContent;
      hide();
    } else if (e.key === 'Escape') {
      hide();
    }
  });
}

function openTripForm(trip = null) {
  Modal.open(sheet => {
    sheet.appendChild(Modal.buildHeader(trip ? 'Редактировать поездку' : 'Новая поездка'));

    const body = el('div', 'modal-body');
    body.innerHTML = `
      <div class="form-group">
        <label class="form-label">Название *</label>
        <input class="form-input" id="trip-title" placeholder="Берлин — лето 2025" value="${escHtml(trip?.title || '')}" />
      </div>
      <div class="form-group">
        <label class="form-label">Место(а)</label>
        <div class="location-autocomplete" id="location-autocomplete-wrap">
          <input class="form-input" id="trip-locations" placeholder="Начните вводить город..." autocomplete="off" value="${escHtml(trip?.locations || '')}" />
          <div class="location-dropdown" id="location-dropdown" style="display:none"></div>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Дата начала</label>
        <input class="form-input" id="trip-start" type="text" value="${escHtml(trip?.start_date ? formatDate(trip.start_date) : '')}" />
      </div>
      <div class="form-group">
        <label class="form-label">Дата окончания</label>
        <input class="form-input" id="trip-end" type="text" value="${escHtml(trip?.end_date ? formatDate(trip.end_date) : '')}" />
      </div>
      <div class="form-group">
        <label class="form-label">Заметка</label>
        <textarea class="form-textarea" id="trip-note" placeholder="Любые заметки...">${escHtml(trip?.note || '')}</textarea>
      </div>
    `;
    sheet.appendChild(body);

    // Date pickers
    applyDateMask(qs('#trip-start', body));
    applyDateMask(qs('#trip-end', body));

    // Location autocomplete
    initLocationAutocomplete(
      qs('#trip-locations', body),
      qs('#location-dropdown', body),
    );

    const footer = el('div', 'modal-footer');
    if (trip) {
      const delBtn = el('button', 'btn btn-danger', 'Удалить');
      delBtn.onclick = async () => {
        if (!confirm('Удалить поездку?')) return;
        await API.delete(`/api/trips/${trip.id}`);
        showToast('Поездка удалена');
        Modal.close();
        await loadAllData();
        renderTripsPage();
      };
      footer.appendChild(delBtn);
    }
    const saveBtn = el('button', 'btn btn-primary', 'Сохранить');
    saveBtn.style.flex = '1';
    saveBtn.onclick = async () => {
      const title = qs('#trip-title').value.trim();
      if (!title) { showToast('Введите название'); return; }
      const payload = {
        title,
        locations: qs('#trip-locations').value.trim() || null,
        start_date: toIsoDate(qs('#trip-start').value.trim()) || null,
        end_date:   toIsoDate(qs('#trip-end').value.trim()) || null,
        note:       qs('#trip-note').value.trim() || null,
      };
      try {
        if (trip) {
          await API.put(`/api/trips/${trip.id}`, payload);
          showToast('Поездка обновлена');
        } else {
          await API.post('/api/trips', payload);
          showToast('Поездка создана');
        }
        Modal.close();
        await loadAllData();
        renderTripsPage();
      } catch (e) { showToast('Ошибка: ' + e.message); }
    };
    footer.appendChild(saveBtn);
    sheet.appendChild(footer);
  });

  setTimeout(() => qs('#trip-title')?.focus(), 100);
}

function openTripDetail(trip) {
  Modal.open(sheet => {
    sheet.appendChild(Modal.buildHeader(trip.title));

    const body = el('div', 'modal-body');
    body.innerHTML = `
      <div class="card" style="margin:0">
        ${trip.locations ? `<div style="margin-bottom:8px">📍 ${escHtml(trip.locations)}</div>` : ''}
        <div>📆 ${trip.start_date ? formatDate(trip.start_date) : '—'} → ${trip.end_date ? formatDate(trip.end_date) : '—'}</div>
        ${trip.note ? `<div style="margin-top:10px;color:var(--text-hint);font-size:14px">${escHtml(trip.note)}</div>` : ''}
      </div>
      <div class="section-title">Документы</div>
      <div class="loader"><div class="spinner"></div></div>
    `;
    sheet.appendChild(body);

    const footer = el('div', 'modal-footer');
    const editBtn = el('button', 'btn btn-secondary', 'Изменить');
    editBtn.onclick = () => { Modal.close(); openTripForm(trip); };
    footer.appendChild(editBtn);
    sheet.appendChild(footer);

    // Загружаем документы поездки через API
    API.get(`/api/documents?trip_id=${trip.id}`).then(docs => {
      const loader = body.querySelector('.loader');
      if (loader) loader.remove();

      const title = body.querySelector('.section-title');
      if (title) title.textContent = `Документы (${docs?.length || 0})`;

      if (docs?.length) {
        docs.forEach(doc => {
          const miniCard = buildDocMiniCard(doc);
          miniCard.style.margin = '0 0 8px 0';
          body.appendChild(miniCard);
        });
      } else {
        body.appendChild(el('div', '', `<div style="color:var(--text-hint);text-align:center;padding:24px;font-size:14px;background:var(--bg-elevated);border-radius:var(--radius-sm);border:1px solid var(--border)">Нет прикреплённых документов</div>`));
      }
    }).catch(() => {
      const loader = body.querySelector('.loader');
      if (loader) loader.remove();
    });
  });
}

// ── ДОКУМЕНТЫ ──

function buildDocMiniCard(doc) {
  const info = getDocInfo(doc.doc_type);
  const data = doc.widget?.data || {};
  const fields = WIDGET_FIELDS[doc.doc_type] || [];

  const card = el('div', 'doc-card');

  // Subtitle for the header
  let subtitle = '';
  if (doc.doc_type === 'HOTEL_BOOKING') {
    subtitle = data.hotel_name || '';
  } else if (['FLIGHT_TICKET','TRAIN_TICKET','BUS_TICKET'].includes(doc.doc_type)) {
    subtitle = [data.departure_place, data.arrival_place].filter(Boolean).join(' → ');
  } else if (doc.doc_type === 'CAR_RENTAL') {
    subtitle = data.car_model || '';
  } else if (doc.doc_type === 'MEDICAL_INSURANCE') {
    subtitle = data.coverage_amount ? `Покрытие: ${data.coverage_amount}` : '';
  } else if (doc.doc_type === 'PASSPORT') {
    subtitle = [data.given_names, data.surname].filter(Boolean).join(' ');
  }

  // Header — click opens full detail
  const header = el('div', 'doc-card-header doc-card-header-clickable');
  header.innerHTML = `
    <div class="doc-type-badge ${info.color}">${info.icon}</div>
    <div class="doc-info">
      <div class="doc-title">${escHtml(doc.title)}</div>
      ${subtitle ? `<div class="doc-subtitle">${escHtml(subtitle)}</div>` : `<div class="doc-subtitle">${info.label}</div>`}
    </div>
    <div class="doc-card-arrow">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
        <path d="M9 18l6-6-6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </div>
  `;
  header.onclick = () => openDocDetail(doc);
  card.appendChild(header);

  // Editable fields grid — optional fields only if filled
  const visibleFields = fields.filter(key =>
    !OPTIONAL_MINI_FIELDS.has(key) || (data[key] !== null && data[key] !== undefined && data[key] !== '')
  );
  if (visibleFields.length) {
    card.appendChild(el('div', 'doc-card-divider'));
    const body = el('div', 'doc-card-body');
    visibleFields.forEach(key => body.appendChild(buildCardFieldItem(doc, key)));
    card.appendChild(body);
  }

  // Для UNKNOWN документов — ручной выбор типа
  if (doc.doc_type === 'UNKNOWN') {
    card.appendChild(el('div', 'doc-card-divider'));
    const typeRow = el('div', 'doc-card-body');
    const typeLabel = el('div', 'doc-field-label', 'Тип документа');
    const typeSelect = el('select', 'form-select');
    typeSelect.style.cssText = 'margin-top:4px;font-size:13px';
    typeSelect.innerHTML = `<option value="">— Выбрать тип —</option>` +
      SELECT_TYPES.filter(t => t.val !== 'UNKNOWN').map(({val, label}) =>
        `<option value="${val}">${label}</option>`
      ).join('');
    typeSelect.onchange = async (e) => {
      e.stopPropagation();
      const newType = typeSelect.value;
      if (!newType) return;
      try {
        await API.put(`/api/documents/${doc.id}`, { doc_type: newType });
        doc.doc_type = newType;
        showToast('Тип обновлён');
        await applyDocFilters();
      } catch (err) { showToast('Ошибка: ' + err.message); }
    };
    typeRow.appendChild(typeLabel);
    typeRow.appendChild(typeSelect);
    card.appendChild(typeRow);
  }

  // Tags
  if (doc.tags?.length) {
    const tagsDiv = el('div', 'doc-tags');
    tagsDiv.innerHTML = doc.tags.map(t => `<span class="tag-pill">${escHtml(t.name)}</span>`).join('');
    card.appendChild(tagsDiv);
  }

  return card;
}

function buildCardFieldItem(doc, key) {
  const data = doc.widget?.data || {};
  let val = data[key];

  const displayed = displayFieldValue(key, val, data);

  const item = el('div', 'doc-field doc-field-editable');
  item.dataset.field = key;
  const labelEl = el('div', 'doc-field-label', escHtml(WIDGET_LABELS[key] || key));
  const valueEl = el('div', `doc-field-value${!displayed ? ' empty' : ''}`,
    displayed ? escHtml(displayed) : 'не заполнено');

  item.appendChild(labelEl);
  item.appendChild(valueEl);

  item.onclick = (e) => {
    e.stopPropagation();
    if (item.querySelector('.card-inline-input')) return;

    valueEl.style.display = 'none';
    const input = el('input', 'card-inline-input');
    input.value = displayFieldValue(key, val, data) || '';
    if (DATETIME_FIELDS.has(key)) applyDatetimeMask(input);
    else if (DATE_FIELDS.has(key)) applyDateMask(input);
    else if (TIME_FIELDS.has(key)) applyTimeMask(input);
    else input.placeholder = WIDGET_LABELS[key] || key;
    item.appendChild(input);

    let saved = false;
    const save = async () => {
      if (saved) return;
      saved = true;
      const raw = input.value.trim();

      let newVal, patch;
      if (DATETIME_FIELDS.has(key)) {
        const [isoDate, isoTime] = parseIsoDatetime(raw);
        newVal = isoDate;
        patch = { [key]: isoDate };
        const timeKey = DATETIME_FIELDS_MAP[key];
        if (isoTime) { patch[timeKey] = isoTime; }
      } else {
        newVal = DATE_FIELDS.has(key) ? toIsoDate(raw) : raw;
        patch = { [key]: newVal };
      }

      // Авто-пересчёт ночей при изменении дат заезда/выезда
      if (key === 'check_in' || key === 'check_out') {
        if (!doc.widget) doc.widget = { data: {} };
        if (!doc.widget.data) doc.widget.data = {};
        const ci = key === 'check_in' ? newVal : doc.widget.data.check_in;
        const co = key === 'check_out' ? newVal : doc.widget.data.check_out;
        const nights = calcNights(ci, co);
        if (nights !== null) patch.nights = String(nights);
      }

      try {
        await API.put(`/api/documents/${doc.id}/widget`, patch);
        if (!doc.widget) doc.widget = { data: {} };
        if (!doc.widget.data) doc.widget.data = {};
        Object.assign(doc.widget.data, patch);
        val = newVal;
        const newDisplayed = displayFieldValue(key, newVal, doc.widget.data);
        valueEl.textContent = newDisplayed || 'не заполнено';
        valueEl.className = `doc-field-value${!newDisplayed ? ' empty' : ''}`;

        if (patch.nights !== undefined) {
          const nightsEl = item.closest('.doc-card-body')?.querySelector('[data-field="nights"] .doc-field-value');
          if (nightsEl) { nightsEl.textContent = patch.nights; nightsEl.classList.remove('empty'); }
        }

        showToast('Сохранено');
      } catch (err) {
        showToast('Ошибка: ' + err.message);
      } finally {
        input.remove();
        valueEl.style.display = '';
      }
    };

    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); save(); }
      if (e.key === 'Escape') { saved = true; input.remove(); valueEl.style.display = ''; }
    });
    input.addEventListener('blur', save);
    setTimeout(() => input.focus(), 10);
  };

  return item;
}

async function renderDocsPage() {
  const c = qs('#page-content');
  c.innerHTML = '';
  qs('#page-title').textContent = 'Документы';
  qs('#fab').classList.remove('hidden');
  qs('#fab').title = 'Загрузить документ';

  // Поиск
  const searchBar = el('div', 'search-bar');
  const searchInput = el('input', 'search-input');
  searchInput.placeholder = '🔍  Поиск документов...';
  searchInput.value = State.docFilters.q;
  searchInput.oninput = debounce(() => {
    State.docFilters.q = searchInput.value;
    applyDocFilters();
  }, 300);
  searchBar.appendChild(searchInput);
  c.appendChild(searchBar);

  // Фильтры по типу
  const chips = el('div', 'filter-chips');
  FILTER_TYPES.forEach(({ val, label }) => {
    const active = State.docFilters.doc_type === val;
    const chip = el('button', `chip${active ? ' active' : ''}`, label);
    chip.onclick = () => {
      State.docFilters.doc_type = val;
      renderDocsPage();
    };
    chips.appendChild(chip);
  });
  c.appendChild(chips);

  // Список документов
  const list = el('div', 'card-list', '');
  list.id = 'doc-list';
  c.appendChild(list);

  await applyDocFilters(list);
}

async function applyDocFilters(listEl) {
  listEl = listEl || qs('#doc-list');
  if (!listEl) return;
  listEl.innerHTML = '<div class="loader"><div class="spinner"></div></div>';

  try {
    const params = new URLSearchParams();
    if (State.docFilters.q)        params.set('q',        State.docFilters.q);
    if (State.docFilters.trip_id)  params.set('trip_id',  State.docFilters.trip_id);
    if (State.docFilters.tag_id)   params.set('tag_id',   State.docFilters.tag_id);

    // TRANSFER — фронтовый фильтр по трём типам билетов
    const isTransferFilter = State.docFilters.doc_type === 'TRANSFER';
    if (State.docFilters.doc_type && !isTransferFilter) {
      params.set('doc_type', State.docFilters.doc_type);
    }

    let docs = await API.get(`/api/documents?${params}`);
    if (isTransferFilter && docs) {
      docs = docs.filter(d => TRANSFER_TYPES.has(d.doc_type));
    }

    listEl.innerHTML = '';

    if (!docs || !docs.length) {
      listEl.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none">
              <path d="M14 2H6C5.46957 2 4.96086 2.21071 4.58579 2.58579C4.21071 2.96086 4 3.46957 4 4V20C4 20.5304 4.21071 21.0391 4.58579 21.4142C4.96086 21.7893 5.46957 22 6 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V8L14 2Z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M14 2V8H20M16 13H8M16 17H8M10 9H8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </div>
          <strong>Нет документов</strong>
          <p>Загрузите PDF или фото документа нажав «+»</p>
        </div>`;
      return;
    }

    docs.forEach(doc => listEl.appendChild(buildDocMiniCard(doc)));
  } catch (e) {
    listEl.innerHTML = `<div class="empty-state"><p>Ошибка загрузки: ${e.message}</p></div>`;
  }
}

// ── Детальная страница документа ──

function openDocDetail(docOrId) {
  const loadAndShow = async () => {
    const docId = typeof docOrId === 'object' ? docOrId.id : docOrId;
    let doc;
    try {
      doc = await API.get(`/api/documents/${docId}`);
    } catch (e) {
      showToast('Не удалось загрузить документ');
      return;
    }

    Modal.open(sheet => {
      sheet.classList.add('modal-full');
      const info = getDocInfo(doc.doc_type);

      sheet.appendChild(Modal.buildHeader(`${info.icon} ${escHtml(doc.title)}`));

      const body = el('div', 'modal-body');
      sheet.appendChild(body);

      renderDocDetailBody(body, doc);
    }, { full: true, noClose: false });
  };

  loadAndShow();
}

function renderDocDetailBody(body, doc) {
  body.innerHTML = '';
  const info = getDocInfo(doc.doc_type);
  const data = doc.widget?.data || {};
  const conf = doc.widget?.confidence || 0;

  // Превью файла
  const preview = el('div', 'doc-preview');
  if (doc.file_path) {
    if (doc.file_mime?.startsWith('image/')) {
      const img = el('img');
      img.src = `${CONFIG.API_BASE}/api/documents/${doc.id}/file`;
      img.alt = doc.title;
      preview.appendChild(img);
    } else if (doc.file_mime === 'application/pdf') {
      const iframe = el('iframe');
      iframe.src = `${CONFIG.API_BASE}/api/documents/${doc.id}/file`;
      iframe.title = doc.title;
      preview.appendChild(iframe);
    } else {
      preview.innerHTML = `<div class="doc-preview-placeholder">📎<span>Файл есть</span></div>`;
    }
  } else {
    preview.innerHTML = `<div class="doc-preview-placeholder">📄<span>Файл не загружен</span></div>`;
  }
  body.appendChild(preview);

  // Тип + confidence
  const typeRow = el('div', 'action-row');
  typeRow.style.marginBottom = '4px';
  typeRow.innerHTML = `
    <span class="doc-type-badge ${info.color}" style="width:36px;height:36px;font-size:20px">${info.icon}</span>
    <strong style="font-size:16px;letter-spacing:-0.2px">${info.label}</strong>
    <span class="confidence-badge ${confidenceClass(conf)}">${confidenceLabel(conf)}</span>
  `;
  body.appendChild(typeRow);

  // Кнопки действий
  const actions = el('div', 'action-row');
  actions.style.marginTop = '4px';

  if (doc.file_path) {
    const openBtn = el('button', 'btn btn-secondary', '');
    openBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg> Открыть`;
    openBtn.onclick = () => window.open(`${CONFIG.API_BASE}/api/documents/${doc.id}/file`, '_blank');
    actions.appendChild(openBtn);
  }

  const replaceBtn = el('button', 'btn btn-secondary', '');
  replaceBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M1 4v6h6M23 20v-6h-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M20.49 9A9 9 0 005.64 5.64L1 10M23 14l-4.64 4.36A9 9 0 013.51 15" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg> Заменить`;
  replaceBtn.onclick = () => openReplaceFileModal(doc.id, async (updated) => {
    const fresh = updated || await API.get(`/api/documents/${doc.id}`);
    renderDocDetailBody(body, fresh);
  });
  actions.appendChild(replaceBtn);

  const walletBtn = el('button', 'btn btn-secondary', '');
  walletBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><rect x="2" y="7" width="20" height="14" rx="2" stroke="currentColor" stroke-width="2"/><path d="M16 3l-4 4-4-4M12 7v6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg> Wallet`;
  walletBtn.onclick = () => addToWallet(doc);
  actions.appendChild(walletBtn);

  body.appendChild(actions);

  // Поля виджета
  const fields = WIDGET_FIELDS[doc.doc_type] || [];
  if (fields.length || Object.keys(data).length) {
    const sectionTitle = el('div', 'section-title', 'Данные документа');
    body.appendChild(sectionTitle);

    const allFields = [...new Set([...fields, ...Object.keys(data)])];
    // Скрыть отдельные поля времени, которые объединены с датой в DATETIME_FIELDS
    const hiddenTimeKeys = new Set(
      allFields.filter(k => DATETIME_FIELDS.has(k)).map(k => DATETIME_FIELDS_MAP[k])
    );
    const visibleDetailFields = allFields.filter(k => !hiddenTimeKeys.has(k));

    const widgetCard = el('div', 'widget-card');
    const widgetDiv = el('div', 'widget-fields');

    visibleDetailFields.forEach(key => {
      const val = data[key];
      const row = buildWidgetFieldRow(key, val, async (newVal, extraPatch) => {
        try {
          const patch = { [key]: newVal, ...(extraPatch || {}) };
          await API.put(`/api/documents/${doc.id}/widget`, patch);
          Object.assign(doc.widget.data, patch);
          showToast('Сохранено');
        } catch (e) { showToast('Ошибка: ' + e.message); }
      }, data);
      widgetDiv.appendChild(row);
    });

    widgetCard.appendChild(widgetDiv);
    body.appendChild(widgetCard);
  }

  // Поездка
  const tripSection = el('div', 'section-title', 'Поездка');
  body.appendChild(tripSection);
  const tripRow = el('div', 'action-row');
  const tripSelect = el('select', 'form-select');
  tripSelect.style.flex = '1';
  tripSelect.innerHTML = `<option value="">— Без поездки —</option>` +
    State.trips.map(t => `<option value="${t.id}" ${t.id === doc.trip_id ? 'selected' : ''}>${escHtml(t.title)}</option>`).join('');
  tripSelect.onchange = async () => {
    await API.put(`/api/documents/${doc.id}`, { trip_id: tripSelect.value ? parseInt(tripSelect.value) : null });
    showToast('Поездка обновлена');
  };
  tripRow.appendChild(tripSelect);
  body.appendChild(tripRow);

  // Теги
  const tagsSection = el('div', 'section-title', 'Теги');
  body.appendChild(tagsSection);
  const tagsContainer = el('div');
  tagsContainer.style.padding = '0 var(--gap)';
  body.appendChild(tagsContainer);
  renderTagsEditor(tagsContainer, doc.tags || [], async (newTagIds) => {
    await API.put(`/api/documents/${doc.id}`, { tag_ids: newTagIds });
    showToast('Теги обновлены');
  });

  // Удаление
  const delSection = el('div', 'section-title', '');
  body.appendChild(delSection);
  const delBtn = el('button', 'btn btn-danger btn-full', '🗑 Удалить документ');
  delBtn.style.margin = '0 var(--gap)';
  delBtn.onclick = async () => {
    if (!confirm('Удалить документ?')) return;
    await API.delete(`/api/documents/${doc.id}`);
    showToast('Документ удалён');
    Modal.close();
    await applyDocFilters();
  };
  body.appendChild(delBtn);
}

function buildWidgetFieldRow(key, val, onSave, allData) {
  const displayed = displayFieldValue(key, val, allData);

  const row = el('div', 'widget-field-row');
  const label = el('div', 'widget-field-key', escHtml(WIDGET_LABELS[key] || key));
  const valEl = el('div', `widget-field-val${!displayed ? ' empty' : ''}`,
    displayed ? escHtml(displayed) : 'не заполнено');
  const editBtn = el('button', 'widget-field-edit', 'изм.');

  row.appendChild(label);
  row.appendChild(valEl);
  row.appendChild(editBtn);

  editBtn.onclick = () => {
    if (row.querySelector('.inline-edit-input')) return;
    editBtn.style.display = 'none';
    valEl.style.display = 'none';

    const input = el('input', 'inline-edit-input');
    input.value = displayFieldValue(key, val, allData) || '';
    if (DATETIME_FIELDS.has(key)) applyDatetimeMask(input);
    else if (DATE_FIELDS.has(key)) applyDateMask(input);
    else if (TIME_FIELDS.has(key)) applyTimeMask(input);
    else input.placeholder = WIDGET_LABELS[key] || key;
    row.appendChild(input);

    let saved = false;
    const saveInline = async () => {
      if (saved) return;
      saved = true;
      const raw = input.value.trim();
      let newVal, extraPatch;
      if (DATETIME_FIELDS.has(key)) {
        const [isoDate, isoTime] = parseIsoDatetime(raw);
        newVal = isoDate;
        extraPatch = isoTime ? { [DATETIME_FIELDS_MAP[key]]: isoTime } : undefined;
      } else {
        newVal = DATE_FIELDS.has(key) ? toIsoDate(raw) : raw;
      }
      try {
        await onSave(newVal, extraPatch);
        val = newVal;
        if (allData && extraPatch) Object.assign(allData, extraPatch);
        const newDisplayed = displayFieldValue(key, newVal, allData);
        valEl.textContent = newDisplayed || 'не заполнено';
        valEl.className = `widget-field-val${!newDisplayed ? ' empty' : ''}`;
      } finally {
        input.remove();
        editBtn.style.display = '';
        valEl.style.display = '';
      }
    };

    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); saveInline(); }
      if (e.key === 'Escape') { saved = true; input.remove(); editBtn.style.display = ''; valEl.style.display = ''; }
    });
    input.addEventListener('blur', saveInline);
    input.focus();
  };

  return row;
}

function renderTagsEditor(container, currentTags, onUpdate) {
  let selectedTags = [...currentTags];

  const render = () => {
    container.innerHTML = '';

    const selectedDiv = el('div', 'selected-tags');
    selectedTags.forEach(tag => {
      const pill = el('div', 'selected-tag');
      pill.innerHTML = `${escHtml(tag.name)} <button class="selected-tag-remove" data-id="${tag.id}">×</button>`;
      pill.querySelector('button').onclick = () => {
        selectedTags = selectedTags.filter(t => t.id !== tag.id);
        onUpdate(selectedTags.map(t => t.id));
        render();
      };
      selectedDiv.appendChild(pill);
    });
    container.appendChild(selectedDiv);

    const autocomplete = el('div', 'tag-autocomplete');
    const input = el('input', 'form-input');
    input.placeholder = 'Добавить тег...';
    input.style.marginTop = '8px';
    autocomplete.appendChild(input);

    let dropdown = null;

    const showDropdown = (items) => {
      if (dropdown) dropdown.remove();
      if (!items.length) return;
      dropdown = el('div', 'tag-dropdown');
      items.forEach(item => {
        const row = el('div', `tag-dropdown-item${item.isCreate ? ' create' : ''}`,
          item.isCreate ? `+ Создать тег «${escHtml(item.name)}»` : `${item.kind === 'tripType' ? '🗺 ' : '🏷 '}${escHtml(item.name)}`);
        row.onclick = async () => {
          let tag = item;
          if (item.isCreate) {
            try {
              tag = await API.post('/api/tags', { name: item.name, kind: 'custom' });
              State.tags.push(tag);
            } catch (e) { showToast('Ошибка: ' + e.message); return; }
          }
          if (!selectedTags.find(t => t.id === tag.id)) {
            selectedTags.push(tag);
            onUpdate(selectedTags.map(t => t.id));
          }
          input.value = '';
          dropdown.remove();
          dropdown = null;
          render();
        };
        dropdown.appendChild(row);
      });
      autocomplete.appendChild(dropdown);
    };

    input.oninput = () => {
      const q = input.value.trim().toLowerCase();
      if (!q) { if (dropdown) { dropdown.remove(); dropdown = null; } return; }
      const filtered = State.tags
        .filter(t => t.name.toLowerCase().includes(q) && !selectedTags.find(s => s.id === t.id))
        .slice(0, 6);
      const items = [...filtered];
      const exact = State.tags.find(t => t.name.toLowerCase() === q);
      if (!exact) items.push({ name: input.value.trim(), isCreate: true });
      showDropdown(items);
    };

    container.appendChild(autocomplete);
  };

  render();
}

// ── Upload flow ──

function openUploadModal() {
  Modal.open(sheet => {
    sheet.appendChild(Modal.buildHeader('Загрузить документ'));

    const body = el('div', 'modal-body');
    body.id = 'upload-modal-body';
    sheet.appendChild(body);

    renderUploadStep1(body);
  });
}

function renderUploadStep1(body) {
  body.innerHTML = `
    <div class="upload-area" id="drop-zone">
      <div class="upload-icon">📎</div>
      <strong>Выберите файл</strong>
      <div class="upload-hint">PDF, JPG или PNG · до 20 МБ</div>
      <input type="file" id="upload-file" accept=".pdf,.jpg,.jpeg,.png,.webp" style="display:none" />
    </div>
    <button class="btn btn-primary btn-full" onclick="document.getElementById('upload-file').click()">
      Выбрать файл
    </button>
  `;

  const dropZone = qs('#drop-zone', body);
  const fileInput = qs('#upload-file', body);

  // Drag & Drop
  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelected(file, body);
  });
  dropZone.onclick = () => fileInput.click();
  fileInput.onchange = () => { if (fileInput.files[0]) handleFileSelected(fileInput.files[0], body); };
}

async function handleFileSelected(file, body) {
  // Шаг 2: загружаем, ждём парсинга
  body.innerHTML = `
    <div class="loader"><div class="spinner"></div></div>
    <p style="text-align:center;color:var(--text-hint);margin-top:12px">Анализируем документ...</p>
  `;

  const fd = new FormData();
  fd.append('file', file);

  let doc;
  try {
    doc = await API.postForm('/api/documents', fd);
  } catch (e) {
    showToast('Ошибка загрузки: ' + e.message);
    renderUploadStep1(body);
    return;
  }

  if (!doc) {
    showToast('Ошибка: не удалось загрузить документ');
    renderUploadStep1(body);
    return;
  }

  renderUploadStep2(body, doc);
}

function renderUploadStep2(body, doc) {
  const info = getDocInfo(doc.doc_type);
  const conf = doc.widget?.confidence || 0;
  const needManualType = doc.doc_type === 'UNKNOWN' || conf < 0.35;

  body.innerHTML = `
    <div style="text-align:center;padding:10px 0 16px">
      <div style="font-size:48px">${info.icon}</div>
      <div style="font-size:18px;font-weight:600;margin-top:8px">${info.label}</div>
      <div class="confidence-badge ${confidenceClass(conf)} " style="margin:8px auto;display:inline-flex">
        ${confidenceLabel(conf)}
      </div>
      ${needManualType ? '<div style="color:var(--text-hint);font-size:13px;margin-top:4px">Низкая уверенность — выберите тип вручную</div>' : ''}
    </div>

    ${needManualType ? `
    <div class="form-group">
      <label class="form-label">Тип документа *</label>
      <select class="form-select" id="manual-type">
        ${SELECT_TYPES.map(({val, label}) =>
          `<option value="${val}" ${val === doc.doc_type ? 'selected' : ''}>${label}</option>`
        ).join('')}
      </select>
    </div>` : ''}

    <div class="form-group">
      <label class="form-label">Название</label>
      <input class="form-input" id="doc-title-input" value="${escHtml(doc.title)}" />
    </div>

    <div class="form-group">
      <label class="form-label">Поездка</label>
      <select class="form-select" id="doc-trip-select">
        <option value="">— Без поездки —</option>
        ${State.trips.map(t => `<option value="${t.id}">${escHtml(t.title)}</option>`).join('')}
      </select>
    </div>

    <div id="upload-tags-area"></div>
  `;

  let selectedTagIds = [];
  const tagsArea = qs('#upload-tags-area', body);
  const tagLabel = el('div', 'section-title', 'Теги');
  tagsArea.appendChild(tagLabel);
  const tagsContainer = el('div');
  tagsArea.appendChild(tagsContainer);
  renderTagsEditor(tagsContainer, [], async (ids) => { selectedTagIds = ids; });

  // Кнопки в footer
  const sheet = body.closest('.modal-sheet');
  let footer = sheet.querySelector('.modal-footer');
  if (!footer) {
    footer = el('div', 'modal-footer');
    sheet.appendChild(footer);
  }
  footer.innerHTML = '';

  const saveBtn = el('button', 'btn btn-primary', 'Сохранить');
  saveBtn.style.flex = '1';
  saveBtn.onclick = async () => {
    const title = qs('#doc-title-input', body).value.trim();
    const tripId = qs('#doc-trip-select', body).value;
    const manualType = qs('#manual-type', body)?.value;

    const updatePayload = {
      title: title || doc.title,
      trip_id: tripId ? parseInt(tripId) : null,
      tag_ids: selectedTagIds,
    };
    if (manualType) updatePayload.doc_type = manualType;

    try {
      await API.put(`/api/documents/${doc.id}`, updatePayload);
      showToast('Документ сохранён');
      Modal.close();
      await loadAllData();
      await applyDocFilters();
    } catch (e) { showToast('Ошибка: ' + e.message); }
  };

  footer.appendChild(saveBtn);
}

function openReplaceFileModal(docId, onDone) {
  Modal.open(sheet => {
    sheet.appendChild(Modal.buildHeader('Заменить файл'));
    const body = el('div', 'modal-body');
    sheet.appendChild(body);

    body.innerHTML = `
      <div class="upload-area" id="replace-drop-zone">
        <div class="upload-icon">🔄</div>
        <strong>Выберите новый файл</strong>
        <div class="upload-hint">PDF, JPG или PNG</div>
        <input type="file" id="replace-file" accept=".pdf,.jpg,.jpeg,.png,.webp" style="display:none" />
      </div>
      <button class="btn btn-primary btn-full" onclick="document.getElementById('replace-file').click()">
        Выбрать файл
      </button>
    `;

    const replaceInput = qs('#replace-file', body);
    const dz = qs('#replace-drop-zone', body);
    dz.onclick = () => replaceInput.click();

    replaceInput.onchange = async () => {
      if (!replaceInput.files[0]) return;
      body.innerHTML = '<div class="loader"><div class="spinner"></div></div><p style="text-align:center;color:var(--text-hint);margin-top:12px">Обновляем...</p>';
      const fd = new FormData();
      fd.append('file', replaceInput.files[0]);
      try {
        const updated = await API.postForm(`/api/documents/${docId}/replace`, fd);
        // Обновляем кэш документов в State
        if (updated) {
          const idx = State.documents.findIndex(d => d.id === docId);
          if (idx !== -1) State.documents[idx] = updated;
        }
        showToast('Файл заменён');
        Modal.close();
        if (onDone) onDone(updated);
      } catch (e) { showToast('Ошибка: ' + e.message); }
    };
  });
}

// ── Wallet ──

async function addToWallet(doc) {
  try {
    const res = await fetch(`${CONFIG.API_BASE}/api/wallet/${doc.id}.pkpass`, {
      headers: { 'Authorization': `Bearer ${State.token}` },
    });
    const ct = res.headers.get('Content-Type') || '';

    if (ct.includes('application/vnd.apple.pkpass')) {
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `packfolio-${doc.id}.pkpass`;
      a.click();
      URL.revokeObjectURL(url);
    } else {
      const data = await res.json();
      if (data.error === 'wallet_not_configured') {
        showWalletFallback(data.message);
      } else {
        showToast(data.message || 'Ошибка генерации Wallet');
      }
    }
  } catch (e) {
    showToast('Ошибка: ' + e.message);
  }
}

function showWalletFallback(_message) {
  Modal.open(sheet => {
    sheet.appendChild(Modal.buildHeader('Apple Wallet'));
    const body = el('div', 'modal-body');
    body.innerHTML = `
      <div style="text-align:center;padding:20px 0">
        <div style="font-size:56px">🍎</div>
        <h2 style="margin-top:12px">Wallet не настроен</h2>
      </div>
      <div class="wallet-setup">
        <h3>Для активации задайте в .env:</h3>
        <code>PASS_TYPE_ID=pass.com.yourcompany.packfolio
TEAM_ID=XXXXXXXXXX
CERT_P12_BASE64=base64...
CERT_P12_PASSWORD=password
WWDR_CERT_BASE64=base64...</code>
        <p style="margin-top:12px;font-size:13px;color:var(--text-hint)">
          Сертификаты получают в Apple Developer Program.<br/>
          Подробнее: <a href="https://developer.apple.com/documentation/walletpasses" target="_blank">developer.apple.com/documentation/walletpasses</a>
        </p>
      </div>
    `;
    sheet.appendChild(body);
  });
}

// ── КАЛЕНДАРЬ ──

async function renderCalendarPage() {
  const c = qs('#page-content');
  c.innerHTML = '';
  qs('#page-title').textContent = 'Календарь';
  qs('#fab').classList.add('hidden');

  // Обновляем поездки и события параллельно
  const [calData] = await Promise.all([
    API.get(`/api/calendar?month=${State.calMonth}`).catch(() => ({ events: [] })),
    API.get('/api/trips').then(t => { if (t) State.trips = t; }).catch(() => {}),
  ]);
  State.calEvents = calData?.events || [];

  renderCalendarGrid(c);
  renderEventsList(c);
}

function renderCalendarGrid(container) {
  const [year, month] = State.calMonth.split('-').map(Number);
  const today = new Date();

  const header = el('div', 'cal-header');
  const prevBtn = el('button', 'btn btn-icon', '‹');
  const nextBtn = el('button', 'btn btn-icon', '›');
  const label   = el('div', 'cal-month-label',
    new Date(year, month - 1, 1).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' }));

  prevBtn.onclick = () => shiftMonth(-1, container);
  nextBtn.onclick = () => shiftMonth(+1, container);

  header.appendChild(prevBtn);
  header.appendChild(label);
  header.appendChild(nextBtn);
  container.appendChild(header);

  // Имена дней
  const dayNames = el('div', 'cal-day-names');
  ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].forEach(n => {
    dayNames.appendChild(el('div', 'cal-day-name', n));
  });
  container.appendChild(dayNames);

  // Ячейки месяца
  const grid = el('div', 'calendar-grid');
  const firstDay = new Date(year, month - 1, 1);
  const lastDay  = new Date(year, month, 0);

  // Отступ для первого дня (пн = 1, …, вс = 7)
  let startOffset = firstDay.getDay();
  if (startOffset === 0) startOffset = 7;
  startOffset -= 1;

  // Дни с событиями
  const eventDays = new Set(
    State.calEvents
      .map(e => e.date?.substring(0, 10))
      .filter(Boolean)
  );

  // Вычисляем покрытие поездками для каждого дня
  const getTripInfo = (dateStr) => {
    for (const trip of State.trips) {
      if (!trip.start_date || !trip.end_date) continue;
      const s = trip.start_date.substring(0, 10);
      const e = trip.end_date.substring(0, 10);
      if (dateStr >= s && dateStr <= e) {
        return { inTrip: true, isStart: dateStr === s, isEnd: dateStr === e };
      }
    }
    return { inTrip: false };
  };

  // Пустые ячейки до начала месяца
  for (let i = 0; i < startOffset; i++) {
    grid.appendChild(el('div', 'cal-cell empty'));
  }

  for (let d = 1; d <= lastDay.getDate(); d++) {
    const dateStr = `${year}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const isToday    = today.getFullYear() === year && today.getMonth() + 1 === month && today.getDate() === d;
    const isSelected = State.calSelectedDay === dateStr;
    const hasEvents  = eventDays.has(dateStr);
    const tripInfo   = getTripInfo(dateStr);

    const classes = [
      'cal-cell',
      isToday    ? 'today'      : '',
      isSelected ? 'selected'   : '',
      hasEvents  ? 'has-events' : '',
      tripInfo.inTrip  ? 'in-trip'    : '',
      tripInfo.isStart ? 'trip-start' : '',
      tripInfo.isEnd   ? 'trip-end'   : '',
    ].filter(Boolean).join(' ');

    const cell = el('div', classes);
    const numSpan = el('span', 'cal-day-num', String(d));
    cell.appendChild(numSpan);

    cell.onclick = () => {
      State.calSelectedDay = isSelected ? null : dateStr;
      const evList = qs('#events-list');
      if (evList) {
        const parent = evList.parentElement;
        evList.remove();
        renderEventsList(parent);
      }
      qsa('.cal-cell:not(.empty)', grid).forEach(c => c.classList.remove('selected'));
      if (!isSelected) cell.classList.add('selected');
    };

    grid.appendChild(cell);
  }

  container.appendChild(grid);
}

function renderEventsList(container) {
  const existing = qs('#events-list', container);
  if (existing) existing.remove();

  const list = el('div', 'events-list');
  list.id = 'events-list';

  let events = State.calEvents;
  if (State.calSelectedDay) {
    events = events.filter(e => {
      const s = e.date || '';
      const en = e.end_date || e.date || '';
      return s <= State.calSelectedDay && State.calSelectedDay <= en;
    });
  }

  if (!events.length) {
    if (State.calSelectedDay) {
      list.innerHTML = `<div style="text-align:center;color:var(--text-hint);padding:20px;font-size:14px">Нет событий ${formatDateShort(State.calSelectedDay)}</div>`;
    }
    container.appendChild(list);
    return;
  }

  const title = el('div', 'section-title', State.calSelectedDay ? formatDate(State.calSelectedDay) : 'Все события месяца');
  list.appendChild(title);

  events.forEach(ev => {
    const item = el('div', 'event-item');

    if (ev.kind === 'trip') {
      // Карточка поездки
      const trip = State.trips.find(t => t.id === ev.trip_id);
      item.innerHTML = `
        <div class="event-type-badge" style="background:var(--accent)">🗺</div>
        <div class="event-info">
          <div class="event-title">${escHtml(ev.title)}</div>
          ${trip?.locations ? `<div class="event-sub">📍 ${escHtml(trip.locations)}</div>` : ''}
          <div class="event-sub">
            ${ev.date ? formatDateShort(ev.date) : ''}${ev.end_date && ev.end_date !== ev.date ? ` — ${formatDateShort(ev.end_date)}` : ''}
          </div>
        </div>
        <div class="event-arrow">›</div>
      `;
      if (trip) item.onclick = () => openTripDetail(trip);

    } else {
      // Карточка документа
      const info = getDocInfo(ev.doc_type);
      const dateStr = ev.date ? formatDateShort(ev.date) : '';
      const endStr  = ev.end_date && ev.end_date !== ev.date ? ` — ${formatDateShort(ev.end_date)}` : '';
      item.innerHTML = `
        <div class="event-type-badge ${info.color}">${info.icon}</div>
        <div class="event-info">
          <div class="event-title">${escHtml(ev.title)}</div>
          ${ev.subtitle ? `<div class="event-sub">${escHtml(ev.subtitle)}</div>` : ''}
          <div class="event-sub">${dateStr}${endStr}</div>
        </div>
        <div class="event-arrow">›</div>
      `;
      item.onclick = () => openDocDetail(ev.doc_id);
    }

    list.appendChild(item);
  });

  container.appendChild(list);
}

async function shiftMonth(delta, container) {
  const [y, m] = State.calMonth.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  State.calMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  State.calSelectedDay = null;
  container.innerHTML = '';
  try {
    const data = await API.get(`/api/calendar?month=${State.calMonth}`);
    State.calEvents = data.events || [];
  } catch (_) {}
  renderCalendarGrid(container);
  renderEventsList(container);
}

// ──────────────────────────────────────────────
// Загрузка данных
// ──────────────────────────────────────────────

async function loadAllData() {
  const [trips, tags] = await Promise.all([
    API.get('/api/trips').catch(() => []),
    API.get('/api/tags').catch(() => []),
  ]);
  State.trips = trips || [];
  State.tags  = tags  || [];
}

// ──────────────────────────────────────────────
// Навигация
// ──────────────────────────────────────────────

const App = {
  async init() {
    tgInit();
    State.user = TG?.initDataUnsafe?.user || { id: 1, first_name: 'Packfolio' };

    // Аутентификация: получаем Bearer-токен
    try {
      const authRes = await fetch(CONFIG.API_BASE + '/api/auth/telegram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ init_data: getInitData() }),
      });
      if (authRes.ok) {
        const authData = await authRes.json();
        State.token = authData.token || null;
        if (authData.user) State.user = authData.user;
      }
    } catch (_) {
      // Сервер недоступен или dev-режим без токена
    }

    await loadAllData();
    this.navigate(location.hash.replace('#', '') || 'home');
    window.addEventListener('hashchange', () => {
      const tab = location.hash.replace('#', '') || 'home';
      this.navigate(tab, true);
    });
  },

  navigate(tab, fromHash = false) {
    if (!fromHash) location.hash = tab;
    State.currentTab = tab;

    // Обновляем навигацию
    qsa('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));

    if (tab === 'home') {
      renderHomePage();
    } else if (tab === 'trips') {
      renderTripsPage();
    } else if (tab === 'docs') {
      renderDocsPage();
    } else if (tab === 'calendar') {
      renderCalendarPage();
    }
  },

  fabAction() {
    if (State.currentTab === 'trips') openTripForm();
    else if (State.currentTab === 'docs') openUploadModal();
  },
};

// ──────────────────────────────────────────────
// Утилиты безопасности
// ──────────────────────────────────────────────

function escHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

// ──────────────────────────────────────────────
// Старт
// ──────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => App.init());
