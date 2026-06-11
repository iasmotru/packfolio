/**
 * Packfolio — Telegram Mini App
 * Чистый JS, без фреймворков. Hash-based роутинг.
 */

// ──────────────────────────────────────────────
// Конфигурация
// ──────────────────────────────────────────────

const CONFIG = {
  // В разработке меняйте на http://localhost:8000
  API_BASE: '',
};

// ──────────────────────────────────────────────
// Состояние приложения
// ──────────────────────────────────────────────

const State = {
  token: null,
  user: null,
  currentTab: 'trips',
  loaded: false,
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
  calActiveTripId: null,
  calEvents: [],
};

// ──────────────────────────────────────────────
// Telegram WebApp
// ──────────────────────────────────────────────

const TG = window.Telegram?.WebApp;

function tgInit() {
  if (!TG) return;
  try { TG.ready(); } catch (_) {}
  try { TG.expand(); } catch (_) {}
  try { TG.setHeaderColor('bg_color'); } catch (_) {}
  try { TG.setBottomBarColor('bg_color'); } catch (_) {}
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
    if (!res.ok) {
      const err = new Error(data.detail || `HTTP ${res.status}`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
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

// ── Флаги стран по городам и странам ──

const LOCATION_FLAGS = {
  // Страны (RU + EN)
  'россия':'RU','russia':'RU','российская федерация':'RU',
  'испания':'ES','spain':'ES',
  'португалия':'PT','portugal':'PT',
  'франция':'FR','france':'FR',
  'германия':'DE','germany':'DE',
  'италия':'IT','italy':'IT',
  'великобритания':'GB','uk':'GB','england':'GB','britain':'GB',
  'нидерланды':'NL','netherlands':'NL','голландия':'NL','holland':'NL',
  'австрия':'AT','austria':'AT',
  'швейцария':'CH','switzerland':'CH',
  'чехия':'CZ','czech republic':'CZ','czechia':'CZ',
  'венгрия':'HU','hungary':'HU',
  'польша':'PL','poland':'PL',
  'швеция':'SE','sweden':'SE',
  'дания':'DK','denmark':'DK',
  'норвегия':'NO','norway':'NO',
  'финляндия':'FI','finland':'FI',
  'греция':'GR','greece':'GR',
  'сербия':'RS','serbia':'RS',
  'хорватия':'HR','croatia':'HR',
  'словения':'SI','slovenia':'SI',
  'черногория':'ME','montenegro':'ME',
  'босния':'BA','bosnia':'BA',
  'македония':'MK','north macedonia':'MK',
  'албания':'AL','albania':'AL',
  'болгария':'BG','bulgaria':'BG',
  'румыния':'RO','romania':'RO',
  'турция':'TR','turkey':'TR','türkiye':'TR',
  'кипр':'CY','cyprus':'CY',
  'мальта':'MT','malta':'MT',
  'исландия':'IS','iceland':'IS',
  'ирландия':'IE','ireland':'IE',
  'бельгия':'BE','belgium':'BE',
  'люксембург':'LU','luxembourg':'LU',
  'оаэ':'AE','uae':'AE','united arab emirates':'AE',
  'израиль':'IL','israel':'IL',
  'иордания':'JO','jordan':'JO',
  'катар':'QA','qatar':'QA',
  'саудовская аравия':'SA','saudi arabia':'SA',
  'ливан':'LB','lebanon':'LB',
  'египет':'EG','egypt':'EG',
  'марокко':'MA','morocco':'MA',
  'таиланд':'TH','thailand':'TH',
  'сингапур':'SG','singapore':'SG',
  'малайзия':'MY','malaysia':'MY',
  'индонезия':'ID','indonesia':'ID',
  'филиппины':'PH','philippines':'PH',
  'япония':'JP','japan':'JP',
  'китай':'CN','china':'CN',
  'корея':'KR','korea':'KR','south korea':'KR',
  'тайвань':'TW','taiwan':'TW',
  'гонконг':'HK','hong kong':'HK',
  'индия':'IN','india':'IN',
  'австралия':'AU','australia':'AU',
  'канада':'CA','canada':'CA',
  'сша':'US','usa':'US','америка':'US','united states':'US',
  'мексика':'MX','mexico':'MX',
  'бразилия':'BR','brazil':'BR',
  'аргентина':'AR','argentina':'AR',
  'армения':'AM','armenia':'AM',
  'грузия':'GE','georgia':'GE',
  'казахстан':'KZ','kazakhstan':'KZ',
  'узбекистан':'UZ','uzbekistan':'UZ',
  'украина':'UA','ukraine':'UA',
  'беларусь':'BY','belarus':'BY',
  'азербайджан':'AZ','azerbaijan':'AZ',
  // Города (RU + EN)
  'москва':'RU','moscow':'RU',
  'санкт-петербург':'RU','петербург':'RU','спб':'RU','saint petersburg':'RU','st petersburg':'RU',
  'новосибирск':'RU','екатеринбург':'RU','казань':'RU','сочи':'RU',
  'мадрид':'ES','madrid':'ES',
  'барселона':'ES','barcelona':'ES',
  'севилья':'ES','seville':'ES','sevilla':'ES',
  'валенсия':'ES','valencia':'ES',
  'лиссабон':'PT','lisbon':'PT','lisboa':'PT',
  'порту':'PT','porto':'PT',
  'париж':'FR','paris':'FR',
  'лион':'FR','lyon':'FR',
  'ницца':'FR','nice':'FR',
  'берлин':'DE','berlin':'DE',
  'мюнхен':'DE','munich':'DE','münchen':'DE',
  'гамбург':'DE','hamburg':'DE',
  'франкфурт':'DE','frankfurt':'DE',
  'кёльн':'DE','cologne':'DE','köln':'DE',
  'рим':'IT','rome':'IT','roma':'IT',
  'милан':'IT','milan':'IT','milano':'IT',
  'венеция':'IT','venice':'IT','venezia':'IT',
  'флоренция':'IT','florence':'IT','firenze':'IT',
  'неаполь':'IT','naples':'IT','napoli':'IT',
  'лондон':'GB','london':'GB',
  'манчестер':'GB','manchester':'GB',
  'эдинбург':'GB','edinburgh':'GB',
  'амстердам':'NL','amsterdam':'NL',
  'вена':'AT','vienna':'AT','wien':'AT',
  'цюрих':'CH','zurich':'CH','zürich':'CH',
  'женева':'CH','geneva':'CH','genève':'CH',
  'прага':'CZ','prague':'CZ','praha':'CZ',
  'будапешт':'HU','budapest':'HU',
  'варшава':'PL','warsaw':'PL','warszawa':'PL',
  'краков':'PL','krakow':'PL','kraków':'PL',
  'стокгольм':'SE','stockholm':'SE',
  'гётеборг':'SE','gothenburg':'SE',
  'копенгаген':'DK','copenhagen':'DK',
  'осло':'NO','oslo':'NO',
  'хельсинки':'FI','helsinki':'FI',
  'белград':'RS','belgrade':'RS','beograd':'RS',
  'загреб':'HR','zagreb':'HR',
  'дубровник':'HR','dubrovnik':'HR',
  'сплит':'HR','split':'HR',
  'любляна':'SI','ljubljana':'SI',
  'подгорица':'ME','podgorica':'ME',
  'сараево':'BA','sarajevo':'BA',
  'тирана':'AL','tirana':'AL',
  'скопье':'MK','skopje':'MK',
  'софия':'BG','sofia':'BG',
  'бухарест':'RO','bucharest':'RO',
  'стамбул':'TR','istanbul':'TR',
  'анкара':'TR','ankara':'TR',
  'анталья':'TR','antalya':'TR',
  'никосия':'CY','nicosia':'CY',
  'афины':'GR','athens':'GR','athina':'GR',
  'салоники':'GR','thessaloniki':'GR',
  'рейкьявик':'IS','reykjavik':'IS',
  'дублин':'IE','dublin':'IE',
  'брюссель':'BE','brussels':'BE','bruxelles':'BE',
  'дубай':'AE','dubai':'AE',
  'абу-даби':'AE','abu dhabi':'AE',
  'тель-авив':'IL','tel aviv':'IL',
  'иерусалим':'IL','jerusalem':'IL',
  'амман':'JO','amman':'JO',
  'доха':'QA','doha':'QA',
  'бейрут':'LB','beirut':'LB',
  'каир':'EG','cairo':'EG',
  'марракеш':'MA','marrakech':'MA',
  'касабланка':'MA','casablanca':'MA',
  'бангкок':'TH','bangkok':'TH',
  'пхукет':'TH','phuket':'TH',
  'куала-лумпур':'MY','kuala lumpur':'MY',
  'бали':'ID','bali':'ID',
  'джакарта':'ID','jakarta':'ID',
  'манила':'PH','manila':'PH',
  'токио':'JP','tokyo':'JP',
  'осака':'JP','osaka':'JP',
  'киото':'JP','kyoto':'JP',
  'пекин':'CN','beijing':'CN',
  'шанхай':'CN','shanghai':'CN',
  'сеул':'KR','seoul':'KR',
  'тайбэй':'TW','taipei':'TW',
  'дели':'IN','delhi':'IN','new delhi':'IN',
  'мумбаи':'IN','mumbai':'IN',
  'бангалор':'IN','bangalore':'IN','bengaluru':'IN',
  'сидней':'AU','sydney':'AU',
  'мельбурн':'AU','melbourne':'AU',
  'торонто':'CA','toronto':'CA',
  'ванкувер':'CA','vancouver':'CA',
  'монреаль':'CA','montreal':'CA',
  'нью-йорк':'US','new york':'US',
  'лос-анджелес':'US','los angeles':'US',
  'чикаго':'US','chicago':'US',
  'майами':'US','miami':'US',
  'сан-франциско':'US','san francisco':'US',
  'мехико':'MX','mexico city':'MX',
  'рио-де-жанейро':'BR','rio de janeiro':'BR',
  'сан-паулу':'BR','são paulo':'BR','sao paulo':'BR',
  'буэнос-айрес':'AR','buenos aires':'AR',
  'ереван':'AM','yerevan':'AM',
  'тбилиси':'GE','tbilisi':'GE',
  'батуми':'GE','batumi':'GE',
  'алматы':'KZ','almaty':'KZ',
  'астана':'KZ','astana':'KZ','нур-султан':'KZ',
  'ташкент':'UZ','tashkent':'UZ',
  'самарканд':'UZ','samarkand':'UZ',
  'киев':'UA','kyiv':'UA','kiev':'UA',
  'одесса':'UA','odessa':'UA',
  'минск':'BY','minsk':'BY',
  'баку':'AZ','baku':'AZ',
};

function isoToFlag(iso) {
  return [...iso.toUpperCase()].map(c => String.fromCodePoint(c.charCodeAt(0) + 0x1F1E6 - 65)).join('');
}

function addLocationFlags(str) {
  if (!str) return str;
  const routeParts = str.split(/\s*(?:→|->|–|—)\s*/);
  return routeParts.map(part => {
    const subParts = part.split(/\s*,\s*/);
    let iso = null;
    for (const sub of subParts) {
      const key = sub.trim().toLowerCase();
      if (LOCATION_FLAGS[key]) { iso = LOCATION_FLAGS[key]; break; }
    }
    const city = subParts[0].trim();
    return (iso ? isoToFlag(iso) + ' ' : '') + city;
  }).join(' → ');
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

// Возвращает «главную» дату документа (строка YYYY-MM-DD или YYYY-MM-DD HH:MM)
function getDocPrimaryDate(doc) {
  const data = doc.widget?.data || {};
  if (TRANSFER_TYPES.has(doc.doc_type))      return data.departure_date  || null;
  if (doc.doc_type === 'HOTEL_BOOKING')       return data.check_out       || data.check_in    || null;
  if (doc.doc_type === 'CAR_RENTAL')          return data.dropoff_date    || data.pickup_date || null;
  if (doc.doc_type === 'MEDICAL_INSURANCE')   return data.end_date        || data.start_date  || null;
  return null;
}

// true, если главная дата документа раньше сегодняшнего дня
function isDocPast(doc) {
  const dateStr = getDocPrimaryDate(doc);
  if (!dateStr) return false;
  const isoDate = String(dateStr).slice(0, 10); // "YYYY-MM-DD"
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return new Date(isoDate) < today;
}

// Человекочитаемые названия полей виджета
const WIDGET_LABELS = {
  hotel_name:        'Название',
  address:           'Адрес',
  check_in:          'Заезд',
  check_out:         'Выезд',
  nights:            'Ночей',
  room_type:         'Тип номера',
  guests:            'Гостей',
  flight_number:     'Рейс / маршрут',
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
  passengers:        'Пассажир',
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
  TRAIN_TICKET:       ['flight_number','pnr','departure_place','departure_date','arrival_place','arrival_date','seat','passengers','tariff'],
  BUS_TICKET:         ['flight_number','pnr','departure_place','departure_date','arrival_place','arrival_date','seat','passengers','tariff'],
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
  document.body.classList.remove('has-fab');
  if (!State.loaded) { c.innerHTML = '<div class="loader"><div class="spinner"></div></div>'; return; }

  // Приветствие
  const greeting = el('div', '');
  greeting.style.cssText = 'padding:20px var(--gap) 0';
  const name = State.user?.first_name || '';
  greeting.innerHTML = `
    <div style="font-size:12px;font-weight:500;color:var(--text-hint);letter-spacing:.6px;margin-bottom:6px">Добро пожаловать${name ? ', ' + escHtml(name) : ''}</div>
    <div style="font-size:28px;font-weight:400;letter-spacing:0">Готовы к путешествиям?</div>
  `;
  c.appendChild(greeting);

  // Ближайшая поездка
  const upcoming = State.trips
    .filter(t => t.end_date && t.end_date >= new Date().toISOString().slice(0,10))
    .sort((a,b) => (a.start_date||'') < (b.start_date||'') ? -1 : 1)[0];

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
      <path d="M12 5V19M5 12H19" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    </svg> Поездка`;
  addTripBtn.onclick = () => { App.navigate('trips'); setTimeout(openTripForm, 100); };

  actRow.appendChild(addDocBtn);
  actRow.appendChild(addTripBtn);

  if (upcoming) {
    const label = el('div', 'section-title', 'Ближайшая поездка');
    label.style.textTransform = 'none';
    c.appendChild(label);

    const heroCard = el('div', 'widget-hero-card');
    heroCard.style.cursor = 'pointer';
    heroCard.innerHTML = `
      <div style="font-size:12px;font-weight:500;color:rgba(255,255,255,0.5);text-transform:uppercase;letter-spacing:.6px;margin-bottom:10px">Поездка</div>
      <div style="font-size:24px;font-weight:400;margin-bottom:14px">${escHtml(upcoming.title)}</div>
      <div style="display:flex;gap:20px;flex-wrap:wrap">
        ${upcoming.locations ? `<div>
          <div style="font-size:10px;font-weight:500;color:rgba(255,255,255,0.5);text-transform:uppercase;letter-spacing:.5px">Место</div>
          <div style="font-size:16px;margin-top:3px">${escHtml(addLocationFlags(upcoming.locations))}</div>
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
    actRow.style.marginTop = '12px';
  }

  c.appendChild(actRow);

  // Последние документы
  const recentDocs = State.documents.slice(0, 3);
  if (recentDocs.length) {
    const label2 = el('div', 'section-title', 'Последние документы');
    label2.style.textTransform = 'none';
    c.appendChild(label2);
    recentDocs.forEach((doc, i) => {
      const card = buildDocMiniCard(doc);
      if (i === 0) card.style.marginTop = '0';
      c.appendChild(card);
    });
  }
}

// ── ПОЕЗДКИ ──

function renderTripsPage() {
  const c = qs('#page-content');
  c.innerHTML = '';
  qs('#page-title').textContent = 'Поездки';
  qs('#fab').classList.remove('hidden');
  qs('#fab-label').textContent = 'Новая поездка';
  document.body.classList.add('has-fab');

  if (!State.loaded) {
    c.innerHTML = '<div class="loader"><div class="spinner"></div></div>';
    return;
  }

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
        <span class="trip-meta-chip">📅 ${escHtml(datesStr)}</span>
        ${trip.locations ? `
        <span class="trip-meta-chip">
          ${escHtml(addLocationFlags(trip.locations))}
        </span>` : ''}
        ${docCount ? `<span class="trip-meta-chip">📄 ${docCount} доку${docCount === 1 ? 'мент' : 'мента'}</span>` : ''}
      </div>
      ${trip.note ? `<div class="trip-card-note">${escHtml(trip.note)}</div>` : ''}
    `;
    card.onclick = () => openTripDetail(trip);
    list.appendChild(card);
  });

  c.appendChild(list);
}

// ── Location autocomplete (Nominatim / OpenStreetMap) ──

const _locationCache = new Map();

// Локальный список городов для мгновенного автодополнения (RU + EN)
const CITY_LIST = [
  ['Москва','Россия'],['Санкт-Петербург','Россия'],['Новосибирск','Россия'],
  ['Екатеринбург','Россия'],['Казань','Россия'],['Нижний Новгород','Россия'],
  ['Сочи','Россия'],['Краснодар','Россия'],['Ростов-на-Дону','Россия'],
  ['Берлин','Германия'],['Мюнхен','Германия'],['Гамбург','Германия'],['Франкфурт','Германия'],['Кёльн','Германия'],['Дюссельдорф','Германия'],['Штутгарт','Германия'],['Дрезден','Германия'],
  ['Париж','Франция'],['Лион','Франция'],['Ницца','Франция'],['Марсель','Франция'],['Бордо','Франция'],['Тулуза','Франция'],
  ['Мадрид','Испания'],['Барселона','Испания'],['Валенсия','Испания'],['Севилья','Испания'],['Малага','Испания'],['Бильбао','Испания'],['Пальма','Испания'],
  ['Лиссабон','Португалия'],['Порту','Португалия'],['Фару','Португалия'],
  ['Рим','Италия'],['Милан','Италия'],['Венеция','Италия'],['Флоренция','Италия'],['Неаполь','Италия'],['Болонья','Италия'],['Турин','Италия'],
  ['Лондон','Великобритания'],['Манчестер','Великобритания'],['Эдинбург','Великобритания'],['Бирмингем','Великобритания'],['Глазго','Великобритания'],['Бристоль','Великобритания'],
  ['Амстердам','Нидерланды'],['Роттердам','Нидерланды'],['Гаага','Нидерланды'],
  ['Вена','Австрия'],['Зальцбург','Австрия'],['Инсбрук','Австрия'],
  ['Прага','Чехия'],['Брно','Чехия'],
  ['Варшава','Польша'],['Краков','Польша'],['Гданьск','Польша'],['Вроцлав','Польша'],
  ['Будапешт','Венгрия'],['Дебрецен','Венгрия'],
  ['Стокгольм','Швеция'],['Гётеборг','Швеция'],['Мальмё','Швеция'],
  ['Копенгаген','Дания'],['Орхус','Дания'],
  ['Осло','Норвегия'],['Берген','Норвегия'],
  ['Хельсинки','Финляндия'],['Тампере','Финляндия'],
  ['Цюрих','Швейцария'],['Женева','Швейцария'],['Базель','Швейцария'],['Берн','Швейцария'],
  ['Брюссель','Бельгия'],['Антверпен','Бельгия'],
  ['Дублин','Ирландия'],
  ['Рейкьявик','Исландия'],
  ['Люксембург','Люксембург'],
  ['Афины','Греция'],['Салоники','Греция'],['Ираклион','Греция'],
  ['Белград','Сербия'],['Нови-Сад','Сербия'],
  ['Загреб','Хорватия'],['Сплит','Хорватия'],['Дубровник','Хорватия'],
  ['Любляна','Словения'],
  ['Братислава','Словакия'],
  ['Бухарест','Румыния'],['Клуж','Румыния'],
  ['София','Болгария'],['Варна','Болгария'],
  ['Стамбул','Турция'],['Анкара','Турция'],['Анталья','Турция'],['Измир','Турция'],
  ['Никосия','Кипр'],['Лимасол','Кипр'],
  ['Тель-Авив','Израиль'],['Иерусалим','Израиль'],['Хайфа','Израиль'],
  ['Дубай','ОАЭ'],['Абу-Даби','ОАЭ'],
  ['Амман','Иордания'],['Бейрут','Ливан'],['Доха','Катар'],
  ['Каир','Египет'],['Шарм-эль-Шейх','Египет'],['Хургада','Египет'],['Александрия','Египет'],
  ['Марракеш','Марокко'],['Касабланка','Марокко'],['Рабат','Марокко'],
  ['Тунис','Тунис'],
  ['Йоханнесбург','ЮАР'],['Кейптаун','ЮАР'],
  ['Найроби','Кения'],
  ['Ереван','Армения'],
  ['Тбилиси','Грузия'],['Батуми','Грузия'],
  ['Баку','Азербайджан'],
  ['Алматы','Казахстан'],['Астана','Казахстан'],
  ['Ташкент','Узбекистан'],['Самарканд','Узбекистан'],
  ['Минск','Беларусь'],
  ['Киев','Украина'],['Одесса','Украина'],['Харьков','Украина'],['Львов','Украина'],
  ['Рига','Латвия'],['Таллин','Эстония'],['Вильнюс','Литва'],
  ['Скопье','Северная Македония'],['Подгорица','Черногория'],['Тирана','Албания'],
  ['Сараево','Босния и Герцеговина'],
  ['Мальта','Мальта'],
  ['Нью-Йорк','США'],['Лос-Анджелес','США'],['Чикаго','США'],['Майами','США'],['Сан-Франциско','США'],['Лас-Вегас','США'],['Бостон','США'],['Вашингтон','США'],['Сиэтл','США'],
  ['Торонто','Канада'],['Ванкувер','Канада'],['Монреаль','Канада'],
  ['Мехико','Мексика'],['Канкун','Мексика'],
  ['Буэнос-Айрес','Аргентина'],
  ['Рио-де-Жанейро','Бразилия'],['Сан-Паулу','Бразилия'],
  ['Токио','Япония'],['Осака','Япония'],['Киото','Япония'],
  ['Пекин','Китай'],['Шанхай','Китай'],['Гуанчжоу','Китай'],['Гонконг','Китай'],
  ['Сеул','Южная Корея'],['Пусан','Южная Корея'],
  ['Бангкок','Таиланд'],['Пхукет','Таиланд'],['Паттайя','Таиланд'],['Чиангмай','Таиланд'],
  ['Сингапур','Сингапур'],
  ['Бали','Индонезия'],['Джакарта','Индонезия'],
  ['Куала-Лумпур','Малайзия'],
  ['Дели','Индия'],['Мумбаи','Индия'],['Гоа','Индия'],['Бангалор','Индия'],
  ['Сидней','Австралия'],['Мельбурн','Австралия'],['Брисбен','Австралия'],
  ['Окленд','Новая Зеландия'],
];

function mergeResults(local, api) {
  const seen = new Set(local.map(i => i.value.toLowerCase()));
  const extra = api.filter(i => !seen.has(i.value.toLowerCase()));
  return [...local, ...extra].slice(0, 5);
}

function searchLocalCities(q) {
  const qLow = q.toLowerCase();
  return CITY_LIST
    .filter(([city]) => city.toLowerCase().startsWith(qLow))
    .slice(0, 5)
    .map(([city, country]) => ({ label: `${city}, ${country}`, value: `${city}, ${country}` }));
}

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
        e.preventDefault();
        selectedFromList = true;
        input.value = value;
        hide();
      };
      dropdown.appendChild(item);
    });
    dropdown.style.display = 'block';
  };

  const CITY_TYPES = new Set([
    'city', 'town', 'village', 'hamlet', 'suburb', 'borough',
    'municipality', 'county', 'state', 'province', 'region',
    'country', 'island', 'administrative',
  ]);

  const parseItems = (data) => {
    const seen = new Set();
    const items = [];
    for (const place of data) {
      if (!CITY_TYPES.has(place.type)) continue;
      const addr = place.address || {};
      // Приоритет: русское название из place.name, потом address
      const city = place.name || addr.city || addr.town || addr.village || addr.county || '';
      const country = addr.country || '';
      const value = [city, country].filter(Boolean).join(', ');
      if (!value || seen.has(value)) continue;
      seen.add(value);
      items.push({ label: value, value });
      if (items.length >= 5) break;
    }
    return items;
  };

  input.addEventListener('input', debounce(async () => {
    const q = input.value.trim();
    if (q.length < 1) { hide(); return; }

    // Мгновенный локальный результат
    const local = searchLocalCities(q);
    if (local.length) show(local);

    if (q.length < 2) return;

    // Кэш API
    if (_locationCache.has(q)) {
      const cached = _locationCache.get(q);
      const merged = mergeResults(local, cached);
      show(merged);
      return;
    }

    if (abortController) abortController.abort();
    abortController = new AbortController();

    try {
      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=12&addressdetails=1`;
      const res = await fetch(url, {
        signal: abortController.signal,
        headers: { 'Accept-Language': 'ru,en' },
      });
      const data = await res.json();
      const apiItems = parseItems(data);
      _locationCache.set(q, apiItems);
      if (_locationCache.size > 50) _locationCache.delete(_locationCache.keys().next().value);
      if (input.value.trim() === q) show(mergeResults(local, apiItems));
    } catch (e) {
      if (e.name !== 'AbortError' && !local.length) hide();
    }
  }, 150));

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
        <label class="form-label">Города</label>
        <div id="trip-locations-list"></div>
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

    applyDateMask(qs('#trip-start', body));
    applyDateMask(qs('#trip-end', body));

    // --- динамический список городов ---
    const locList = qs('#trip-locations-list', body);
    const existingCities = trip?.locations
      ? trip.locations.split(/\s*→\s*/).map(s => s.trim()).filter(Boolean)
      : [''];

    const addCityRow = (value = '') => {
      const row = el('div', 'location-row');
      row.style.cssText = 'display:flex;gap:8px;align-items:flex-start;margin-bottom:8px;position:relative';

      const wrap = el('div', 'location-autocomplete');
      wrap.style.flex = '1';
      const input = el('input', 'form-input');
      input.placeholder = 'Начните вводить город...';
      input.autocomplete = 'off';
      input.value = value;
      const dropdown = el('div', 'location-dropdown');
      dropdown.style.display = 'none';
      wrap.appendChild(input);
      wrap.appendChild(dropdown);
      initLocationAutocomplete(input, dropdown);
      row.appendChild(wrap);

      const updateButtons = () => {
        const rows = locList.querySelectorAll('.location-row');
        rows.forEach((r, i) => {
          const addBtn = r.querySelector('.loc-add-btn');
          const delBtn = r.querySelector('.loc-del-btn');
          if (addBtn) addBtn.style.display = i === rows.length - 1 ? '' : 'none';
          if (delBtn) delBtn.style.display = rows.length > 1 ? '' : 'none';
        });
      };

      const delBtn = el('button', 'btn-ghost loc-del-btn');
      delBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
      delBtn.style.cssText = 'padding:8px;flex-shrink:0;margin-top:2px';
      delBtn.onclick = () => { row.remove(); updateButtons(); };
      row.appendChild(delBtn);

      const addBtn = el('button', 'btn-ghost loc-add-btn');
      addBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
      addBtn.style.cssText = 'padding:8px;flex-shrink:0;margin-top:2px';
      addBtn.onclick = () => { addCityRow(); updateButtons(); };
      row.appendChild(addBtn);

      locList.appendChild(row);
      updateButtons();
    };

    existingCities.forEach(c => addCityRow(c));

    const getLocations = () =>
      [...locList.querySelectorAll('.location-row input')]
        .map(i => i.value.trim()).filter(Boolean).join(' → ') || null;

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
        locations:  getLocations(),
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
        ${trip.locations ? `<div style="margin-bottom:8px">${escHtml(addLocationFlags(trip.locations))}</div>` : ''}
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
          const miniCard = buildDocMiniCard(doc, true);
          miniCard.style.margin = '0 0 8px 0';
          body.appendChild(miniCard);
        });
      } else {
        body.appendChild(el('div', '', `<div style="color:var(--text-hint);text-align:center;padding:24px;font-size:14px;background:var(--bg-elevated);border-radius:var(--radius-sm);border:1px solid var(--border)">Нет прикреплённых документов</div>`));
      }
    }).catch((err) => {
      const loader = body.querySelector('.loader');
      if (loader) loader.remove();
      console.error('openTripDetail error:', err);
    });
  });
}

// ── ДОКУМЕНТЫ ──

function buildDocMiniCard(doc, showAllFields = false) {
  const info = getDocInfo(doc.doc_type);
  const data = doc.widget?.data || {};
  const fields = WIDGET_FIELDS[doc.doc_type] || [];

  const card = el('div', 'doc-card');

  // ─── FRONT FACE ───────────────────────────────────────────────────────────
  const front = el('div', 'doc-card-face');

  // ─── Edit-mode state ──────────────────────────────────────────────────────
  let isEditMode = false;
  const fieldRefs = []; // { key, item, valueEl }

  const editBtn = el('button', 'doc-card-edit-btn', 'Редактировать');
  editBtn.onclick = (e) => {
    e.stopPropagation();
    isEditMode ? saveAllEdits() : enterEditMode();
  };

  const header = el('div', 'doc-card-header');
  header.innerHTML = `
    <div class="doc-type-badge ${info.color}">${info.icon}</div>
    <div class="doc-info">
      <div class="doc-title">${escHtml(doc.title)}</div>
    </div>
  `;
  header.appendChild(editBtn);
  front.appendChild(header);

  // Flip by clicking anywhere on front (except interactive controls)
  front.onclick = (e) => {
    if (!isEditMode) doFlip();
  };

  // Editable fields grid
  const visibleFields = fields.filter(key =>
    showAllFields || !OPTIONAL_MINI_FIELDS.has(key) || (data[key] !== null && data[key] !== undefined && data[key] !== '')
  );
  if (visibleFields.length) {
    front.appendChild(el('div', 'doc-card-divider'));
    const body = el('div', 'doc-card-body');
    visibleFields.forEach(key => {
      const item = buildCardFieldItem(doc, key);
      body.appendChild(item);
      fieldRefs.push({ key, item, valueEl: item.querySelector('.doc-field-value') });
    });
    front.appendChild(body);
  }

  // ─── Enter edit mode ───────────────────────────────────────────────────────
  // Все поля превращаются в инпуты; серая обводка → синяя при фокусе (как form-input)
  function enterEditMode() {
    isEditMode = true;
    editBtn.textContent = 'Сохранить';
    editBtn.classList.add('saving');
    const wdata = doc.widget?.data || {};
    fieldRefs.forEach(({ key, item, valueEl }) => {
      valueEl.style.display = 'none';
      const inp = el('input', 'card-edit-input');
      inp.value = displayFieldValue(key, wdata[key], wdata) || '';
      inp.dataset.editKey = key;
      inp.onclick = e => e.stopPropagation();
      if (DATETIME_FIELDS.has(key)) applyDatetimeMask(inp);
      else if (DATE_FIELDS.has(key)) applyDateMask(inp);
      else if (TIME_FIELDS.has(key)) applyTimeMask(inp);
      item.appendChild(inp);
    });
  }

  // ─── Save all edits ────────────────────────────────────────────────────────
  async function saveAllEdits() {
    const wdata = doc.widget?.data || {};
    const patch = {};
    fieldRefs.forEach(({ key, item }) => {
      const inp = item.querySelector('.card-edit-input');
      if (!inp) return;
      const raw = inp.value.trim();
      if (DATETIME_FIELDS.has(key)) {
        const [isoDate, isoTime] = parseIsoDatetime(raw);
        patch[key] = isoDate;
        const timeKey = DATETIME_FIELDS_MAP[key];
        if (isoTime && timeKey) patch[timeKey] = isoTime;
      } else if (DATE_FIELDS.has(key)) {
        patch[key] = toIsoDate(raw);
      } else {
        patch[key] = raw;
      }
    });
    // Авто-пересчёт ночей
    if ('check_in' in patch || 'check_out' in patch) {
      const ci = patch.check_in ?? wdata.check_in;
      const co = patch.check_out ?? wdata.check_out;
      const nights = calcNights(ci, co);
      if (nights !== null) patch.nights = String(nights);
    }
    try {
      await API.put(`/api/documents/${doc.id}/widget`, patch);
      if (!doc.widget) doc.widget = { data: {} };
      if (!doc.widget.data) doc.widget.data = {};
      Object.assign(doc.widget.data, patch);
      showToast('Сохранено');
    } catch (err) {
      showToast('Ошибка: ' + err.message);
    }
    exitEditMode();
  }

  // ─── Exit edit mode ────────────────────────────────────────────────────────
  function exitEditMode() {
    isEditMode = false;
    editBtn.textContent = 'Редактировать';
    editBtn.classList.remove('saving');
    const newData = doc.widget?.data || {};
    fieldRefs.forEach(({ key, item, valueEl }) => {
      item.onclick = null;
      const inp = item.querySelector('.card-edit-input');
      if (inp) inp.remove();
      const displayed = displayFieldValue(key, newData[key], newData);
      valueEl.textContent = displayed || 'не заполнено';
      valueEl.className = `doc-field-value${!displayed ? ' empty' : ''}`;
      valueEl.style.display = '';
    });
  }

  // UNKNOWN type selector
  if (doc.doc_type === 'UNKNOWN') {
    front.appendChild(el('div', 'doc-card-divider'));
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
    front.appendChild(typeRow);
  }

  // Tags + trip pills (rebuilt on refresh)
  function buildFrontTags() {
    const existing = front.querySelector('.doc-tags');
    if (existing) existing.remove();
    const trip = doc.trip_id ? State.trips.find(t => t.id === doc.trip_id) : null;
    if (doc.tags?.length || trip) {
      const tagsDiv = el('div', 'doc-tags');
      if (trip) tagsDiv.appendChild(el('span', 'tag-pill tag-pill-trip', '✈️ ' + escHtml(trip.title)));
      doc.tags?.forEach(t => {
        const cls = t.kind === 'old_version' ? 'tag-pill tag-pill-old'
                  : t.kind === 'duplicate'   ? 'tag-pill tag-pill-dup'
                  : 'tag-pill';
        tagsDiv.appendChild(el('span', cls, escHtml(t.name)));
      });
      front.appendChild(tagsDiv);
    }
  }
  buildFrontTags();

  card.appendChild(front);

  // ─── BACK FACE ────────────────────────────────────────────────────────────
  const back = el('div', 'doc-card-face doc-card-back-face');
  back.style.display = 'none';
  buildDocCardBack(back, doc, doFlip, buildFrontTags);
  card.appendChild(back);

  // ─── Flip logic ───────────────────────────────────────────────────────────
  let isFlipped = false;
  function doFlip() {
    isFlipped = !isFlipped;
    if (isFlipped) {
      // Lock card height to the front face height before flipping
      const h = card.offsetHeight;
      card.style.height = h + 'px';
      back.style.height = h + 'px';
    }
    card.style.transition = 'transform 0.13s ease-in';
    card.style.transform = 'scaleX(0)';
    card.addEventListener('transitionend', function handler() {
      card.removeEventListener('transitionend', handler);
      if (isFlipped) {
        front.style.display = 'none';
        back.style.display = '';
      } else {
        back.style.display = 'none';
        front.style.display = '';
        // Restore dynamic height when returning to front
        card.style.height = '';
        back.style.height = '';
      }
      card.style.transition = 'transform 0.13s ease-out';
      card.style.transform = 'scaleX(1)';
    }, { once: true });
  }

  return card;
}

function buildDocCardBack(container, doc, onFlipBack, onFrontRefresh) {
  container.innerHTML = '';
  const conf = doc.widget?.confidence || 0;

  // ─ Компактный заголовок: ← title [confidence] ─
  const header = el('div', 'doc-card-back-header doc-card-header-clickable');

  const backBtn = el('button', 'doc-card-back-btn', '');
  backBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none">
    <path d="M19 12H5M12 19l-7-7 7-7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
  backBtn.onclick = (e) => { e.stopPropagation(); onFlipBack(); };

  const titleEl = el('div', 'doc-info');
  titleEl.innerHTML = `<div class="doc-title">${escHtml(doc.title)}</div>`;

  const confBadge = el('span', `confidence-badge ${confidenceClass(conf)}`, confidenceLabel(conf));
  confBadge.style.cssText = 'font-size:10px;padding:3px 7px;flex-shrink:0';

  header.appendChild(backBtn);
  header.appendChild(titleEl);
  header.appendChild(confBadge);
  container.appendChild(header);

  // ─ Превью файла (90px) ─
  const previewWrap = el('div', 'doc-card-preview-wrap');
  if (doc.file_path) {
    if (doc.file_mime?.startsWith('image/')) {
      const img = el('img', 'doc-card-preview-img');
      img.src = `${CONFIG.API_BASE}/api/documents/${doc.id}/file`;
      img.alt = doc.title;
      previewWrap.appendChild(img);
    } else if (doc.file_mime === 'application/pdf') {
      const iframe = el('iframe', 'doc-card-preview-iframe');
      iframe.src = `${CONFIG.API_BASE}/api/documents/${doc.id}/file`;
      iframe.title = doc.title;
      previewWrap.appendChild(iframe);
      previewWrap.appendChild(el('div', 'doc-card-preview-overlay'));
    } else {
      previewWrap.innerHTML = `<div class="doc-preview-placeholder" style="padding:16px;font-size:12px">📎 Файл</div>`;
    }
    previewWrap.onclick = (e) => {
      e.stopPropagation();
      Modal.open(sheet => {
        const msg = el('p', 'dialog-msg', 'Открыть файл документа?');
        const row = el('div', 'dialog-btns');
        const cancelBtn = el('button', 'btn btn-secondary', 'Отменить');
        cancelBtn.onclick = () => Modal.close();
        const openBtn = el('button', 'btn btn-primary', 'Открыть');
        openBtn.onclick = () => { Modal.close(); window.open(`${CONFIG.API_BASE}/api/documents/${doc.id}/file`, '_blank'); };
        row.appendChild(cancelBtn);
        row.appendChild(openBtn);
        sheet.appendChild(msg);
        sheet.appendChild(row);
      }, { center: true });
    };
  } else {
    previewWrap.innerHTML = `<div class="doc-preview-placeholder" style="padding:16px;font-size:12px">📄 Файл не загружен</div>`;
  }
  container.appendChild(previewWrap);

  // ─ Кнопки действий (компактные) ─
  const actions = el('div', 'doc-card-back-actions');

  const renameBtn = el('button', 'btn btn-secondary', '');
  renameBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg> Переименовать`;
  renameBtn.onclick = async (e) => {
    e.stopPropagation();
    const newTitle = prompt('Новое название:', doc.title);
    if (!newTitle || newTitle.trim() === doc.title) return;
    try {
      await API.put(`/api/documents/${doc.id}`, { title: newTitle.trim() });
      doc.title = newTitle.trim();
      titleEl.querySelector('.doc-title').textContent = doc.title;
      showToast('Переименовано');
      onFrontRefresh?.();
    } catch (err) { showToast('Ошибка: ' + err.message); }
  };

  const replaceBtn = el('button', 'btn btn-secondary', '');
  replaceBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M1 4v6h6M23 20v-6h-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M20.49 9A9 9 0 005.64 5.64L1 10M23 14l-4.64 4.36A9 9 0 013.51 15" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg> Заменить`;
  replaceBtn.onclick = (e) => {
    e.stopPropagation();
    openReplaceFileModal(doc.id, async () => { showToast('Файл заменён'); await applyDocFilters(); });
  };

  const walletBtn = el('button', 'btn btn-secondary btn-locked', '');
  walletBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none"><rect x="2" y="7" width="20" height="14" rx="2" stroke="currentColor" stroke-width="2"/><path d="M16 3l-4 4-4-4M12 7v6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg> Wallet <span class="pro-badge">Pro</span>`;
  walletBtn.onclick = (e) => { e.stopPropagation(); openProModal(); };

  actions.appendChild(renameBtn);
  actions.appendChild(replaceBtn);
  actions.appendChild(walletBtn);
  container.appendChild(actions);

  container.appendChild(el('div', 'doc-card-divider'));

  // ─ Поездка — одна строка ─
  const tripRow = el('div', 'doc-card-back-row');
  tripRow.appendChild(el('span', 'doc-card-back-row-label', 'Поездка'));
  const tripSelect = el('select', 'select-card');
  tripSelect.innerHTML = `<option value="">— Без поездки —</option>` +
    State.trips.map(t => `<option value="${t.id}" ${t.id === doc.trip_id ? 'selected' : ''}>${escHtml(t.title)}</option>`).join('');
  tripSelect.onchange = async (e) => {
    e.stopPropagation();
    const newTripId = tripSelect.value ? parseInt(tripSelect.value) : null;
    try {
      await API.put(`/api/documents/${doc.id}`, { trip_id: newTripId });
      doc.trip_id = newTripId;
      showToast('Поездка обновлена');
      onFrontRefresh?.();
    } catch (err) { showToast('Ошибка: ' + err.message); }
  };
  tripSelect.onclick = e => e.stopPropagation();
  tripRow.appendChild(tripSelect);
  container.appendChild(tripRow);

  container.appendChild(el('div', 'doc-card-divider'));

  // ─ Теги — компактно ─
  const tagsRow = el('div', 'doc-card-back-row');
  tagsRow.style.alignItems = 'flex-start';
  tagsRow.appendChild(el('span', 'doc-card-back-row-label', 'Теги'));
  const tagsWrap = el('div', 'doc-card-back-tags');
  tagsWrap.style.cssText = 'flex:1;padding:0';
  tagsWrap.onclick = e => e.stopPropagation();
  tagsRow.appendChild(tagsWrap);
  container.appendChild(tagsRow);
  renderTagsEditor(tagsWrap, doc.tags || [], async (newTagIds) => {
    try {
      await API.put(`/api/documents/${doc.id}`, { tag_ids: newTagIds });
      const fresh = await API.get(`/api/documents/${doc.id}`);
      doc.tags = fresh.tags;
      showToast('Теги обновлены');
      onFrontRefresh?.();
    } catch (err) { showToast('Ошибка: ' + err.message); }
  });

  container.appendChild(el('div', 'doc-card-divider'));

  // ─ Удалить ─
  const delWrap = el('div', 'doc-card-back-delete');
  const delBtn = el('button', 'btn btn-danger', '🗑 Удалить');
  delBtn.style.cssText = 'width:100%;padding:7px 12px;font-size:12px';
  delBtn.onclick = async (e) => {
    e.stopPropagation();
    if (!confirm('Удалить документ?')) return;
    try {
      await API.delete(`/api/documents/${doc.id}`);
      showToast('Документ удалён');
      await applyDocFilters();
    } catch (err) { showToast('Ошибка: ' + err.message); }
  };
  delWrap.appendChild(delBtn);
  container.appendChild(delWrap);

  // Клик в любое место обратной стороны — переворот назад
  // (кнопки, превью, поездка, теги останавливают всплытие сами)
  container.onclick = () => onFlipBack();
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

  return item;
}

// ── Экран Архива ──

function openArchiveModal() {
  Modal.open(sheet => {
    sheet.classList.add('modal-full');

    // ── Хэдер — клон docs-sticky-controls ──
    const header = el('div', 'docs-sticky-controls archive-modal-sticky');

    const controlsCol = el('div', 'docs-controls-col');

    // Строка: ← Назад | поиск | Очистить
    const searchRow = el('div', 'docs-search-row');

    const backBtn = el('button', 'archive-icon-btn');
    backBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path d="M15 18l-6-6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
    backBtn.onclick = () => Modal.close();
    searchRow.appendChild(backBtn);

    let archiveQ = '';
    const searchInput = el('input', 'search-input');
    searchInput.placeholder = 'Поиск в архиве...';
    searchInput.oninput = debounce(() => { archiveQ = searchInput.value; loadArchive(); }, 300);
    searchRow.appendChild(searchInput);

    const clearBtn = el('button', 'archive-icon-btn');
    clearBtn.innerHTML = `<span>Очистить</span>`;
    clearBtn.onclick = async () => {
      if (!confirm('Удалить все документы из архива?')) return;
      clearBtn.disabled = true;
      try {
        const params = new URLSearchParams();
        let docs = await API.get(`/api/documents?${params}`);
        if (docs) docs = docs.filter(d => isDocPast(d));
        await Promise.all((docs || []).map(d => API.delete(`/api/documents/${d.id}`)));
        await loadAllData();
        loadArchive();
      } catch (e) {
        showToast('Ошибка при удалении');
      } finally {
        clearBtn.disabled = false;
      }
    };
    searchRow.appendChild(clearBtn);

    controlsCol.appendChild(searchRow);

    // Чипы
    let archiveDocType = '';
    const chipsWrap = el('div', 'filter-chips');
    const buildArchiveChips = () => {
      chipsWrap.innerHTML = '';
      FILTER_TYPES.forEach(({ val, label }) => {
        const chip = el('button', `chip${archiveDocType === val ? ' active' : ''}`, label);
        chip.onclick = () => { archiveDocType = val; buildArchiveChips(); loadArchive(); };
        chipsWrap.appendChild(chip);
      });
    };
    buildArchiveChips();
    controlsCol.appendChild(chipsWrap);

    header.appendChild(controlsCol);
    sheet.appendChild(header);

    // ── Список ──
    const list = el('div', 'card-list');
    list.style.cssText = 'padding:0 16px;flex:1;overflow-y:auto;min-height:0;';
    sheet.appendChild(list);

    const loadArchive = async () => {
      list.innerHTML = '<div class="loader"><div class="spinner"></div></div>';
      try {
        const params = new URLSearchParams();
        if (archiveQ) params.set('q', archiveQ);
        const isTransfer = archiveDocType === 'TRANSFER';
        if (archiveDocType && !isTransfer) params.set('doc_type', archiveDocType);

        let docs = await API.get(`/api/documents?${params}`);
        if (isTransfer && docs) docs = docs.filter(d => TRANSFER_TYPES.has(d.doc_type));
        if (docs) docs = docs.filter(d => isDocPast(d));

        list.innerHTML = '';
        if (!docs || !docs.length) {
          list.innerHTML = `
            <div class="empty-state">
              <div class="empty-icon">
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none">
                  <path d="M21 8v13H3V8M1 3h22v5H1zM10 12h4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </div>
              <strong>Архив пуст</strong>
              <p>Здесь будут документы с истёкшими датами</p>
            </div>`;
          return;
        }
        docs.forEach(doc => list.appendChild(buildDocMiniCard(doc)));
      } catch (e) {
        list.innerHTML = `<div class="empty-state"><p>Ошибка: ${e.message}</p></div>`;
      }
    };

    loadArchive();
  });
}

async function renderDocsPage() {
  const c = qs('#page-content');
  c.innerHTML = '';
  qs('#page-title').textContent = 'Документы';
  qs('#fab').classList.remove('hidden');
  qs('#fab-label').textContent = 'Загрузить документ';
  if (!State.loaded) { c.innerHTML = '<div class="loader"><div class="spinner"></div></div>'; return; }
  document.body.classList.add('has-fab');

  // Sticky-контейнер: поиск + фильтры
  const stickyControls = el('div', 'docs-sticky-controls');

  const controlsCol = el('div', 'docs-controls-col');

  // Строка поиска + кнопка «Архив» справа
  const searchRow = el('div', 'docs-search-row');

  const searchInput = el('input', 'search-input');
  searchInput.placeholder = 'Поиск документов...';
  searchInput.value = State.docFilters.q;
  searchInput.oninput = debounce(() => {
    State.docFilters.q = searchInput.value;
    applyDocFilters();
  }, 300);
  searchRow.appendChild(searchInput);

  const archiveBtn = el('button', 'archive-icon-btn');
  archiveBtn.title = 'Архив';
  archiveBtn.innerHTML = `
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <path d="M21 8v13H3V8M1 3h22v5H1zM10 12h4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
    <span>Архив</span>`;
  archiveBtn.onclick = openArchiveModal;
  searchRow.appendChild(archiveBtn);

  controlsCol.appendChild(searchRow);

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

  controlsCol.appendChild(chips);
  stickyControls.appendChild(controlsCol);

  c.appendChild(stickyControls);

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

    // Основной список: только актуальные документы (без прошедших)
    if (docs) {
      docs = docs.filter(d => !isDocPast(d));
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

  const renameBtn = el('button', 'btn btn-secondary', '');
  renameBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg> Переименовать`;
  renameBtn.onclick = () => {
    const newTitle = prompt('Новое название:', doc.title);
    if (!newTitle || newTitle.trim() === doc.title) return;
    API.put(`/api/documents/${doc.id}`, { title: newTitle.trim() }).then(() => {
      doc.title = newTitle.trim();
      const modalTitle = renameBtn.closest('.modal-sheet')?.querySelector('.modal-title');
      if (modalTitle) modalTitle.textContent = `${info.icon} ${doc.title}`;
      showToast('Переименовано');
    }).catch(e => showToast('Ошибка: ' + e.message));
  };
  actions.appendChild(renameBtn);

  const replaceBtn = el('button', 'btn btn-secondary', '');
  replaceBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M1 4v6h6M23 20v-6h-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M20.49 9A9 9 0 005.64 5.64L1 10M23 14l-4.64 4.36A9 9 0 013.51 15" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg> Заменить`;
  replaceBtn.onclick = () => openReplaceFileModal(doc.id, async (updated) => {
    const fresh = updated || await API.get(`/api/documents/${doc.id}`);
    renderDocDetailBody(body, fresh);
  });
  actions.appendChild(replaceBtn);

  const walletBtn = el('button', 'btn btn-secondary btn-locked', '');
  walletBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><rect x="2" y="7" width="20" height="14" rx="2" stroke="currentColor" stroke-width="2"/><path d="M16 3l-4 4-4-4M12 7v6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg> Wallet <span class="pro-badge">Pro</span>`;
  walletBtn.onclick = () => openProModal();
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

    const extractedData = doc.widget?.extracted_data || {};
    visibleDetailFields.forEach(key => {
      const val = data[key];
      const row = buildWidgetFieldRow(key, val, async (newVal, extraPatch) => {
        try {
          const patch = { [key]: newVal, ...(extraPatch || {}) };
          await API.put(`/api/documents/${doc.id}/widget`, patch);
          Object.assign(doc.widget.data, patch);
          showToast('Сохранено');
        } catch (e) { showToast('Ошибка: ' + e.message); }
      }, data, extractedData[key]);
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
    const newTripId = tripSelect.value ? parseInt(tripSelect.value) : null;
    await API.put(`/api/documents/${doc.id}`, { trip_id: newTripId });
    doc.trip_id = newTripId;
    const idx = State.documents.findIndex(d => d.id === doc.id);
    if (idx !== -1) State.documents[idx] = { ...State.documents[idx], trip_id: newTripId };
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

function buildWidgetFieldRow(key, val, onSave, allData, extractedVal) {
  const displayed = displayFieldValue(key, val, allData);

  const row = el('div', 'widget-field-row');

  const label = el('div', 'widget-field-key');
  label.appendChild(document.createTextNode(escHtml(WIDGET_LABELS[key] || key)));

  // Бейдж «Изменено»: показываем только если оригинал был непустым и значение отличается
  const isModified = extractedVal != null && extractedVal !== '' &&
                     String(extractedVal) !== String(val ?? '');
  let modifiedBadge = null;
  if (isModified) {
    modifiedBadge = el('span', 'field-modified-badge', 'Изменено');
    label.appendChild(modifiedBadge);
  }

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
        // Обновляем бейдж «Изменено»
        const nowModified = extractedVal != null && extractedVal !== '' &&
                            String(extractedVal) !== String(newVal ?? '');
        if (nowModified && !modifiedBadge) {
          modifiedBadge = el('span', 'field-modified-badge', 'Изменено');
          label.appendChild(modifiedBadge);
        } else if (!nowModified && modifiedBadge) {
          modifiedBadge.remove();
          modifiedBadge = null;
        }
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

function showDuplicateModal(file, body) {
  Modal.open(sheet => {
    sheet.appendChild(Modal.buildHeader('Документ уже загружен'));
    const mbody = el('div', 'modal-body');
    mbody.innerHTML = `
      <p style="color:var(--text-hint);font-size:14px;line-height:1.5">
        Этот документ уже был загружен ранее. Загрузить его повторно?
      </p>`;
    const footer = el('div', 'modal-footer');
    footer.style.cssText = 'display:flex;gap:10px;';

    const cancelBtn = el('button', 'btn btn-secondary', 'Отменить');
    cancelBtn.onclick = () => { Modal.close(); Modal.close(); }; // закрыть дубликат + загрузку

    const reuploadBtn = el('button', 'btn btn-primary', 'Загрузить повторно');
    reuploadBtn.onclick = async () => {
      Modal.close(); // закрыть этот диалог
      body.innerHTML = `
        <div class="loader"><div class="spinner"></div></div>
        <p style="text-align:center;color:var(--text-hint);margin-top:12px">Загружаем документ...</p>`;
      const fd = new FormData();
      fd.append('file', file);
      fd.append('force', 'true');
      fd.append('mark_duplicate', 'true');
      let uploadResult;
      try {
        uploadResult = await API.postForm('/api/documents', fd);
      } catch (e) {
        showToast('Ошибка загрузки: ' + e.message);
        renderUploadStep1(body);
        return;
      }
      if (!uploadResult) { renderUploadStep1(body); return; }
      if (Array.isArray(uploadResult)) { renderUploadStepMulti(body, uploadResult); return; }
      renderUploadStep2(body, uploadResult);
    };

    footer.appendChild(cancelBtn);
    footer.appendChild(reuploadBtn);
    sheet.appendChild(mbody);
    sheet.appendChild(footer);
  }, { noClose: true });
}

function showSimilarModal(file, body, existingDoc) {
  Modal.open(sheet => {
    sheet.appendChild(Modal.buildHeader('Есть похожий документ'));

    const mbody = el('div', 'modal-body');

    const hint = el('p', '', 'Найден документ с тем же номером рейса или PNR. Обновить его версию или загрузить как новый?');
    hint.style.cssText = 'color:var(--text-hint);font-size:14px;line-height:1.5;margin:0;';
    mbody.appendChild(hint);

    // Карточка существующего документа
    const cardWrap = el('div', '');
    cardWrap.style.cssText = 'pointer-events:none;opacity:0.85;';
    cardWrap.appendChild(buildDocMiniCard(existingDoc));
    mbody.appendChild(cardWrap);

    sheet.appendChild(mbody);

    const footer = el('div', 'modal-footer');
    footer.style.cssText = 'display:flex;gap:10px;';

    const uploadNewBtn = el('button', 'btn btn-secondary', 'Загрузить новый');
    uploadNewBtn.onclick = async () => {
      Modal.close();
      body.innerHTML = `
        <div class="loader"><div class="spinner"></div></div>
        <p style="text-align:center;color:var(--text-hint);margin-top:12px">Загружаем документ...</p>`;
      const fd = new FormData();
      fd.append('file', file);
      fd.append('force', 'true');
      fd.append('mark_old', 'true');
      let result;
      try { result = await API.postForm('/api/documents', fd); }
      catch (e) { showToast('Ошибка: ' + e.message); renderUploadStep1(body); return; }
      if (!result) { renderUploadStep1(body); return; }
      if (Array.isArray(result)) { renderUploadStepMulti(body, result); return; }
      renderUploadStep2(body, result);
    };

    const updateBtn = el('button', 'btn btn-primary', 'Обновить');
    updateBtn.onclick = async () => {
      Modal.close();
      body.innerHTML = `
        <div class="loader"><div class="spinner"></div></div>
        <p style="text-align:center;color:var(--text-hint);margin-top:12px">Обновляем документ...</p>`;
      const fd = new FormData();
      fd.append('file', file);
      let result;
      try { result = await API.postForm(`/api/documents/${existingDoc.id}/replace`, fd); }
      catch (e) { showToast('Ошибка: ' + e.message); renderUploadStep1(body); return; }
      if (!result) { renderUploadStep1(body); return; }
      renderUploadStep2(body, result);
    };

    footer.appendChild(uploadNewBtn);
    footer.appendChild(updateBtn);
    sheet.appendChild(footer);
  }, { noClose: true });
}

async function handleFileSelected(file, body) {
  // Шаг 2: загружаем, ждём парсинга
  body.innerHTML = `
    <div class="loader"><div class="spinner"></div></div>
    <p style="text-align:center;color:var(--text-hint);margin-top:12px">Анализируем документ...</p>
  `;

  const fd = new FormData();
  fd.append('file', file);

  let uploadResult;
  try {
    uploadResult = await API.postForm('/api/documents', fd);
  } catch (e) {
    if (e.status === 409 && e.data?.duplicate) {
      showDuplicateModal(file, body);
      return;
    }
    showToast('Ошибка загрузки: ' + e.message);
    renderUploadStep1(body);
    return;
  }

  if (!uploadResult) {
    showToast('Ошибка: не удалось загрузить документ');
    renderUploadStep1(body);
    return;
  }

  if (uploadResult.similar) {
    showSimilarModal(file, body, uploadResult.existing);
    return;
  }

  if (Array.isArray(uploadResult)) {
    renderUploadStepMulti(body, uploadResult);
    return;
  }

  renderUploadStep2(body, uploadResult);
}

function renderUploadStepMulti(body, docs) {
  const sheet = body.closest('.modal-sheet');

  body.innerHTML = `
    <div style="text-align:center;padding:8px 0 16px">
      <div style="font-size:36px">✈️</div>
      <div style="font-size:17px;font-weight:600;margin-top:8px">Создано ${docs.length} карточки</div>
      <div style="font-size:13px;color:var(--text-hint);margin-top:4px">Прикрепить все к поездке?</div>
    </div>
    <div class="doc-card-list" style="display:flex;flex-direction:column;gap:8px;margin-bottom:4px">
      ${docs.map(d => `<div class="card" style="margin:0;padding:12px 16px;font-size:14px">${escHtml(d.title)}</div>`).join('')}
    </div>
    <div class="form-group" style="margin-top:12px">
      <label class="form-label">Поездка</label>
      <select class="form-select" id="multi-trip-select">
        <option value="">— Не указывать —</option>
        ${State.trips.map(t => `<option value="${t.id}">${escHtml(t.title)}</option>`).join('')}
      </select>
    </div>
  `;

  let footer = sheet.querySelector('.modal-footer');
  if (!footer) {
    footer = el('div', 'modal-footer');
    sheet.appendChild(footer);
  }
  footer.innerHTML = '';

  const saveBtn = el('button', 'btn btn-primary', 'Сохранить');
  saveBtn.style.flex = '1';
  saveBtn.onclick = async () => {
    const tripId = qs('#multi-trip-select', body).value;
    if (tripId) {
      try {
        await Promise.all(docs.map(d =>
          API.put(`/api/documents/${d.id}`, { trip_id: parseInt(tripId) })
        ));
      } catch (e) { showToast('Ошибка: ' + e.message); return; }
    }
    showToast(`Создано ${docs.length} карточки`);
    Modal.close();
    await loadAllData();
    await applyDocFilters();
  };

  footer.appendChild(saveBtn);
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

// ── Pro Modal ──

function openProModal() {
  let selectedPlan = 'year';
  Modal.open(sheet => {
    sheet.appendChild(Modal.buildHeader('Доступно с подпиской'));
    const body = el('div', 'modal-body');
    body.innerHTML = `
      <div style="padding:4px 0 20px">
        <p style="color:var(--text-hint);font-size:14px;margin-bottom:20px">
          Оформите подписку Pro, чтобы открыть новые возможности Packfolio:
        </p>
        <ul style="list-style:none;padding:0;margin:0 0 20px;display:flex;flex-direction:column;gap:6px">
          <li class="pro-feature-item">
            <span class="pro-feature-icon">✈️</span>
            <span>Создание поездок без ограничений</span>
          </li>
          <li class="pro-feature-item">
            <span class="pro-feature-icon">🪪</span>
            <span>Добавление документов в Wallet</span>
          </li>
          <li class="pro-feature-item">
            <span class="pro-feature-icon">👥</span>
            <span>Совместные поездки</span>
          </li>
        </ul>
        <div class="pro-plans">
          <label class="pro-plan active" data-plan="month">
            <input type="radio" name="plan" value="month" style="display:none">
            <div class="pro-plan-name">Месяц</div>
            <div class="pro-plan-price">⭐ 250</div>
          </label>
          <label class="pro-plan" data-plan="year">
            <input type="radio" name="plan" value="year" style="display:none" checked>
            <div class="pro-plan-name">Год <span class="pro-badge">−30%</span></div>
            <div class="pro-plan-price">⭐ 2100</div>
          </label>
        </div>
      </div>
    `;
    sheet.appendChild(body);

    body.querySelectorAll('.pro-plan').forEach(pl => {
      pl.onclick = () => {
        body.querySelectorAll('.pro-plan').forEach(p => p.classList.remove('active'));
        pl.classList.add('active');
        selectedPlan = pl.dataset.plan;
      };
    });

    const footer = el('div', 'modal-footer');
    const proBtn = el('button', 'btn btn-primary btn-full', 'Оформить подписку');
    proBtn.onclick = () => Modal.close();
    footer.appendChild(proBtn);
    sheet.appendChild(footer);
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
  if (!State.loaded) { c.innerHTML = '<div class="loader"><div class="spinner"></div></div>'; return; }
  qs('#fab').classList.add('hidden');
  document.body.classList.remove('has-fab');

  // Обновляем поездки и события параллельно
  const [calData] = await Promise.all([
    API.get(`/api/calendar?month=${State.calMonth}`).catch(() => ({ events: [] })),
    API.get('/api/trips').then(t => { if (t) State.trips = t; }).catch(() => {}),
  ]);
  State.calEvents = calData?.events || [];

  renderCalendarTripFilters(c);
  renderCalendarGrid(c);
  renderEventsList(c);
}

function renderCalendarTripFilters(container) {
  if (!State.trips.length) return;

  const today = new Date().toISOString().slice(0, 10);

  const upcoming = State.trips
    .filter(t => t.start_date && t.start_date >= today)
    .sort((a, b) => a.start_date < b.start_date ? -1 : 1)[0];

  const chips = el('div', 'filter-chips');
  chips.style.margin = '8px var(--gap) 0';

  const jumpToTrip = async (trip) => {
    const [y, m] = trip.start_date.split('-');
    State.calMonth = `${y}-${m.padStart(2,'0')}`;
    State.calSelectedDay = null;
    State.calActiveTripId = trip.id;
    const data = await API.get(`/api/calendar?month=${State.calMonth}`).catch(() => ({ events: [] }));
    State.calEvents = data?.events || [];
    const c = qs('#page-content');
    c.innerHTML = '';
    renderCalendarTripFilters(c);
    renderCalendarGrid(c);
    renderEventsList(c);
  };

  if (upcoming) {
    const nearBtn = el('button', 'chip', '⭐ Ближайшая поездка');
    if (State.calActiveTripId === upcoming.id) nearBtn.classList.add('active');
    nearBtn.onclick = () => jumpToTrip(upcoming);
    chips.appendChild(nearBtn);
  }

  State.trips
    .filter(t => t.start_date)
    .sort((a, b) => a.start_date < b.start_date ? -1 : 1)
    .forEach(trip => {
      const btn = el('button', 'chip', escHtml(trip.title));
      if (State.calActiveTripId === trip.id) btn.classList.add('active');
      btn.onclick = () => jumpToTrip(trip);
      chips.appendChild(btn);
    });

  container.appendChild(chips);
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

  // Числа предыдущего месяца
  const prevMonthLastDay = new Date(year, month - 1, 0).getDate();
  const prevYear  = month === 1 ? year - 1 : year;
  const prevMonth = month === 1 ? 12 : month - 1;
  let cellIndex = 0;

  const rowClasses = (idx) => [
    idx % 7 === 0 ? 'row-start' : '',
    idx % 7 === 6 ? 'row-end'   : '',
  ];

  for (let i = 0; i < startOffset; i++, cellIndex++) {
    const d = prevMonthLastDay - startOffset + 1 + i;
    const dateStr  = `${prevYear}-${String(prevMonth).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const tripInfo = getTripInfo(dateStr);
    const classes  = ['cal-cell', 'out-of-month',
      tripInfo.inTrip  ? 'in-trip'    : '',
      tripInfo.isStart ? 'trip-start' : '',
      tripInfo.isEnd   ? 'trip-end'   : '',
      ...rowClasses(cellIndex),
    ].filter(Boolean).join(' ');
    const cell = el('div', classes);
    cell.appendChild(el('span', 'cal-day-num', String(d)));
    grid.appendChild(cell);
  }

  for (let d = 1; d <= lastDay.getDate(); d++, cellIndex++) {
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
      ...rowClasses(cellIndex),
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

  // Числа следующего месяца
  const nextYear  = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const totalCells = startOffset + lastDay.getDate();
  const remainder  = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
  for (let d = 1; d <= remainder; d++, cellIndex++) {
    const dateStr  = `${nextYear}-${String(nextMonth).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const tripInfo = getTripInfo(dateStr);
    const classes  = ['cal-cell', 'out-of-month',
      tripInfo.inTrip  ? 'in-trip'    : '',
      tripInfo.isStart ? 'trip-start' : '',
      tripInfo.isEnd   ? 'trip-end'   : '',
      ...rowClasses(cellIndex),
    ].filter(Boolean).join(' ');
    const cell = el('div', classes);
    cell.appendChild(el('span', 'cal-day-num', String(d)));
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
          ${trip?.locations ? `<div class="event-sub">${escHtml(addLocationFlags(trip.locations))}</div>` : ''}
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
  State.calActiveTripId = null;
  container.innerHTML = '';
  try {
    const data = await API.get(`/api/calendar?month=${State.calMonth}`);
    State.calEvents = data.events || [];
  } catch (_) {}
  renderCalendarTripFilters(container);
  renderCalendarGrid(container);
  renderEventsList(container);
}

// ──────────────────────────────────────────────
// Загрузка данных
// ──────────────────────────────────────────────

async function loadAllData() {
  const [trips, tags, documents] = await Promise.all([
    API.get('/api/trips').catch(() => []),
    API.get('/api/tags').catch(() => []),
    API.get('/api/documents').catch(() => []),
  ]);
  State.trips     = trips     || [];
  State.tags      = tags      || [];
  State.documents = documents || [];
}

// ──────────────────────────────────────────────
// Навигация
// ──────────────────────────────────────────────

const App = {
  async init() {
    tgInit();
    State.user = TG?.initDataUnsafe?.user || { id: 1, first_name: 'Packfolio' };

    const TABS = ['home', 'trips', 'docs', 'calendar'];
    const initialTab = TABS.includes(location.hash.replace('#', '')) ? location.hash.replace('#', '') : 'trips';
    this.navigate(initialTab);

    window.addEventListener('hashchange', () => {
      const h = location.hash.replace('#', '');
      const tab = TABS.includes(h) ? h : State.currentTab;
      if (tab !== State.currentTab) this.navigate(tab, true);
    });

    // Аутентификация и загрузка данных в фоне
    try {
      const ctrl = new AbortController();
      const authTimeout = setTimeout(() => ctrl.abort(), 8000);
      const authRes = await fetch(CONFIG.API_BASE + '/api/auth/telegram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ init_data: getInitData() }),
        signal: ctrl.signal,
      });
      clearTimeout(authTimeout);
      if (authRes.ok) {
        const authData = await authRes.json();
        State.token = authData.token || null;
        if (authData.user) State.user = authData.user;
      }
    } catch (_) {
      // Сервер недоступен, таймаут или dev-режим без токена
    }

    await loadAllData();
    State.loaded = true;
    // Перерисовываем текущую вкладку с загруженными данными
    this.navigate(State.currentTab, true);
  },

  navigate(tab, fromHash = false) {
    if (!fromHash) location.hash = tab;
    State.currentTab = tab;
    document.body.dataset.page = tab;

    // Обновляем навигацию
    qsa('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));

    try {
      if (tab === 'home') {
        renderHomePage();
      } else if (tab === 'trips') {
        renderTripsPage();
      } else if (tab === 'docs') {
        renderDocsPage();
      } else if (tab === 'calendar') {
        renderCalendarPage();
      }
    } catch (e) {
      console.error('navigate error:', e);
      qs('#page-content').innerHTML = `<div style="padding:24px;color:#ff4444;font-size:14px;word-break:break-all">${e.message}<br><br>${e.stack || ''}</div>`;
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

document.addEventListener('DOMContentLoaded', () => {
  App.init();
  setupKeyboardAdjust();
});

// ──────────────────────────────────────────────
// Keyboard / visualViewport fix (iOS Telegram)
// ──────────────────────────────────────────────
function setupKeyboardAdjust() {
  // Скроллим активный инпут в зону видимости при фокусе
  // Пробуем дважды: 350ms и 700ms — клавиатура iOS анимируется ~500ms
  document.addEventListener('focusin', (e) => {
    if (!e.target.matches('input, textarea, select')) return;
    [350, 700].forEach(delay => {
      setTimeout(() => {
        const vv = window.visualViewport;
        const target = e.target;
        const rect = target.getBoundingClientRect();
        const visibleBottom = vv ? vv.height : window.innerHeight;
        if (rect.bottom > visibleBottom - 16) {
          // Скроллим ближайший прокручиваемый контейнер
          const scrollEl =
            target.closest('.modal-body') ||
            target.closest('.modal-sheet') ||
            target.closest('.page');
          if (scrollEl) {
            scrollEl.scrollTop += rect.bottom - visibleBottom + 80;
          } else {
            target.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }
      }, delay);
    });
  });

  // Уменьшаем высоту modal-overlay И modal-sheet до реальной видимой области.
  // dvh не пересчитывается в iOS Telegram WKWebView при появлении клавиатуры,
  // поэтому задаём max-height шиту вручную через JS.
  if (!window.visualViewport) return;

  const applyKeyboard = () => {
    const vv = window.visualViewport;
    const visibleH = Math.round(vv.height);
    const offsetTop = Math.round(vv.offsetTop);
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
      overlay.style.height  = visibleH + 'px';
      overlay.style.top     = offsetTop + 'px';
      overlay.style.bottom  = '';
    });
    document.querySelectorAll('.modal-sheet').forEach(sheet => {
      sheet.style.maxHeight = Math.round(visibleH * 0.95) + 'px';
    });
  };

  const resetKeyboard = () => {
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
      overlay.style.height = '';
      overlay.style.top    = '';
    });
    document.querySelectorAll('.modal-sheet').forEach(sheet => {
      sheet.style.maxHeight = '';
    });
  };

  window.visualViewport.addEventListener('resize', () => {
    window.visualViewport.height < window.innerHeight * 0.85
      ? applyKeyboard()
      : resetKeyboard();
  });
}
