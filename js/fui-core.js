/* ═══════════════════════════════════════════════════════════
   fui-core.js —— 跨项目共享 FUI 地基（开机加载动画控制器）
   在 <head> 内、CSS 之后同步引入。立即读取主题；注入战术接入
   界面（精美载入动画）；字体就绪后淡出，页面元素才渐显。
   纯叠加，不触碰任何业务逻辑。

   手动控制：受保护页面在 shared.js 里设置
   window.__fuiBootManual = true，随后由 revealPage() 调用
   window.__fuiBoot.done()。未设置则在字体就绪后自动淡出。
   ═══════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ── 视觉设置：中文字体 / 英文+数字字体 / 配色主题（三组独立下拉，各自持久化） ──
     数字与英文同字体是"字体栈自动分流"的天然结果：--f-main 把英文槽排在中文槽前面，
     浏览器逐字符找字形，英文/数字命中英文槽，中文字形缺失时自动落到中文槽，
     不需要手写任何"是不是中文字符"的判断逻辑。 */
  var THEME_KEY = 'fui_theme';
  var CJK_KEY   = 'fui_font_cjk';
  var EN_KEY    = 'fui_font_en';

  var COLOR_THEMES = [
    { id: 'gold',    label: 'Orokin 金' },
    { id: 'cyber',   label: '赛博朋克' },
    { id: 'dark',    label: '暗黑色调' },
    { id: 'eyecare', label: '护眼色调' },
    { id: 'minimal', label: '极简模式' }
  ];
  var CJK_FONTS = [
    { id: 'xszt',     label: 'XSZT',         family: "'xszt'" },
    { id: 'zhuolang', label: '微软雅黑',        family: "'Microsoft YaHei', sans-serif" },
    { id: 'cangji',   label: '仓迹高德国妙黑',   family: "'仓迹高德国妙黑'" },
    { id: 'qiuhong',  label: '演示秋鸿楷',      family: "'演示秋鸿楷'" },
    { id: 'qiji',     label: 'QIJI FALLBACK', family: "'QIJIFALLBACK'" }
  ];
  var EN_FONTS = [
    { id: 'xszt',  label: 'XSZT（默认）', family: "'xszt'" },
    { id: 'teko',  label: 'Teko Bold',   family: "'Teko-Bold-5'" },
    { id: 'lemon', label: 'LEMON MILK',  family: "'LEMONMILK-MediumItalic'" },
    { id: 'cako',  label: 'Cako Black',  family: "'Cako-Black'" },
    { id: 'adieu', label: 'Adieu Bold',  family: "'Adieu-Regular-Bold'" },
    { id: 'elsie', label: 'Elsie Black', family: "'Elsie-Black'" }
  ];
  function _find(arr, id) {
    for (var i = 0; i < arr.length; i++) { if (arr[i].id === id) return arr[i]; }
    return arr[0];
  }

  var _color = 'gold', _cjk = 'xszt', _en = 'xszt';
  try { _color = localStorage.getItem(THEME_KEY) || 'gold'; } catch (e) {}
  try { _cjk   = localStorage.getItem(CJK_KEY)   || 'xszt'; } catch (e) {}
  try { _en    = localStorage.getItem(EN_KEY)    || 'xszt'; } catch (e) {}

  function applyAll() {
    var html = document.documentElement;
    /* gold 也显式写 data-fui-theme="gold"，不再靠"缺省=金"：main.css 新增
       html[data-fui-theme="gold"] 作用域承载金主题专属覆盖，缺省属性会让那组
       规则失效。仓库内其余消费方（login.js/shared.js）只做 === 'minimal'/'eyecare'
       的等值判断，gold 显式化对它们无影响。 */
    html.setAttribute('data-fui-theme', _color);

    if (_color === 'minimal') {
      /* 极简模式强制系统字体：不写内联样式，让 main.css 里
         html[data-fui-theme="minimal"] 的兜底规则生效
         （内联样式优先级高于任何属性选择器，写了反而会盖掉强制系统字体）。 */
      html.style.removeProperty('--f-cjk-name');
      html.style.removeProperty('--f-en-name');
      html.removeAttribute('data-fui-cjk');
    } else {
      html.style.setProperty('--f-cjk-name', _find(CJK_FONTS, _cjk).family);
      html.style.setProperty('--f-en-name',  _find(EN_FONTS,  _en).family);
      /* 暴露当前选中的中文字体 id，供 main.css 按字体单独修正字号/行高
         （部分艺术字体的实际字面比字号数值小得多，不修正会小到看不清） */
      html.setAttribute('data-fui-cjk', _cjk);
    }
  }
  applyAll();

  function optsHtml(arr, cur) {
    return arr.map(function (o) {
      return '<option value="' + o.id + '"' + (o.id === cur ? ' selected' : '') + '>' + o.label + '</option>';
    }).join('');
  }

  window.fuiTheme = {
    getColor:   function () { return _color; },
    getCjkFont: function () { return _cjk; },
    getEnFont:  function () { return _en; },
    setColor: function (id) {
      _color = _find(COLOR_THEMES, id).id;
      try { localStorage.setItem(THEME_KEY, _color); } catch (e) {}
      applyAll();
    },
    setCjkFont: function (id) {
      _cjk = _find(CJK_FONTS, id).id;
      try { localStorage.setItem(CJK_KEY, _cjk); } catch (e) {}
      applyAll();
    },
    setEnFont: function (id) {
      _en = _find(EN_FONTS, id).id;
      try { localStorage.setItem(EN_KEY, _en); } catch (e) {}
      applyAll();
    }
  };

  document.addEventListener('DOMContentLoaded', function () {
    /* 登录页（/login）不注入设置面板：登录框只跟随已记忆的主题显示，本函数顶部的
       applyAll() 已经无条件跑过，颜色/字体已经生效，这里只是跳过面板注入。 */
    var _path = (location.pathname || '').replace(/\/+$/, '');
    var _isLoginPage = _path === '/login' || _path.endsWith('/login');
    if (_isLoginPage) return;

    var inner = document.querySelector('.bw-footer-inner');
    if (inner && !inner.querySelector('.bw-fui-settings-row')) {
      var wrap = document.createElement('div');
      wrap.className = 'bw-fui-settings-row';
      wrap.innerHTML =
        '<label class="bw-fui-select-wrap">'
          + '<span class="bw-fui-select-label">中文字体</span>'
          + '<select class="bw-fui-select" id="bw-fui-cjk-select">' + optsHtml(CJK_FONTS, _cjk) + '</select>'
        + '</label>'
        + '<label class="bw-fui-select-wrap">'
          + '<span class="bw-fui-select-label">英文字体</span>'
          + '<select class="bw-fui-select" id="bw-fui-en-select">' + optsHtml(EN_FONTS, _en) + '</select>'
        + '</label>'
        + '<label class="bw-fui-select-wrap">'
          + '<span class="bw-fui-select-label">配色主题</span>'
          + '<select class="bw-fui-select" id="bw-fui-color-select">' + optsHtml(COLOR_THEMES, _color) + '</select>'
        + '</label>';
      inner.appendChild(wrap);

      wrap.querySelector('#bw-fui-cjk-select').addEventListener('change', function (e) { window.fuiTheme.setCjkFont(e.target.value); });
      wrap.querySelector('#bw-fui-en-select').addEventListener('change', function (e) { window.fuiTheme.setEnFont(e.target.value); });
      wrap.querySelector('#bw-fui-color-select').addEventListener('change', function (e) { window.fuiTheme.setColor(e.target.value); });
    }
  });

  /* 侧边数据流文字素材 */
  var _hexChars = '0123456789ABCDEF';
  function _rHex(n) {
    var s = ''; for (var i = 0; i < n; i++) s += _hexChars[Math.floor(Math.random() * 16)];
    return s;
  }
  function _genSideLines() {
    var lines = [];
    for (var i = 0; i < 40; i++) {
      var r = Math.random();
      if (r < 0.4) lines.push(_rHex(8) + ' ' + _rHex(4));
      else if (r < 0.7) lines.push('0x' + _rHex(6));
      else lines.push(_rHex(4) + ':' + _rHex(4) + ':' + _rHex(4));
    }
    return lines.join('\n');
  }

  /* UTC 时钟 */
  var _utcTimer = null;
  function _startUtc(el) {
    function tick() {
      var d = new Date();
      el.textContent = 'UTC ' +
        String(d.getUTCHours()).padStart(2,'0') + ':' +
        String(d.getUTCMinutes()).padStart(2,'0') + ':' +
        String(d.getUTCSeconds()).padStart(2,'0');
    }
    tick();
    _utcTimer = setInterval(tick, 1000);
  }

  /* ── 已有自有载入遮罩的页面跳过注入 ── */
  var _hasOwn = !!(document.getElementById('ws-splash') || document.getElementById('el-overlay'));
  if (_hasOwn) {
    window.__fuiBoot = { done: function () { if (document.body) { document.body.classList.add('fui-in'); document.body.style.opacity = '1'; } } };
    return;
  }

  /* 开机虚线环取当前主题的 --fui-accent（hex），转成低透明度 rgba 描边，不再写死
     金色——否则非 gold 主题下开机环是唯一一道金色残留。此函数执行时 applyAll() 已
     跑过、主题属性已就位，getComputedStyle 能取到最终主题色；取不到（非 6 位 hex
     或环境异常）则兜底旧金色，保证开机动画任何情况下都可见。 */
  function _ringStrokeColor() {
    var fallback = 'rgba(201,164,50,.35)';
    try {
      var hex = getComputedStyle(document.documentElement).getPropertyValue('--fui-accent').trim();
      var m = /^#([0-9a-fA-F]{6})$/.exec(hex);
      if (!m) return fallback;
      var n = parseInt(m[1], 16);
      return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',.35)';
    } catch (e) { return fallback; }
  }

  /* ── 注入 #fui-splash HTML ── */
  var spl = document.createElement('div');
  spl.id = 'fui-splash';
  spl.setAttribute('aria-hidden', 'true');
  spl.innerHTML =
    '<div class="fui-spl-scan"></div>'
    + '<div class="fui-spl-corner fui-spl-corner--tl"></div>'
    + '<div class="fui-spl-corner fui-spl-corner--tr"></div>'
    + '<div class="fui-spl-corner fui-spl-corner--bl"></div>'
    + '<div class="fui-spl-corner fui-spl-corner--br"></div>'
    + '<div class="fui-spl-side fui-spl-side--l" id="fui-spl-left"></div>'
    + '<div class="fui-spl-side fui-spl-side--r" id="fui-spl-right"></div>'
    + '<div class="fui-spl-center">'
    +   '<div class="fui-spl-hex-area">'
    +     '<div class="fui-spl-hex-wrap" id="fui-spl-hex">'
    +       '<svg class="fui-spl-ring-svg" viewBox="-110 -110 220 220" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">'
    +         '<circle cx="0" cy="0" r="102" fill="none" stroke="' + _ringStrokeColor() + '" stroke-width="1" stroke-dasharray="30 130"/>'
    +         '<circle class="fui-spl-ring-o" cx="0" cy="0" r="88"/>'
    +         '<circle class="fui-spl-ring-i" cx="0" cy="0" r="76"/>'
    +         '<line class="fui-spl-ring-tk" x1="0" y1="-88" x2="0" y2="-100"/>'
    +         '<line class="fui-spl-ring-tk" x1="88" y1="0" x2="100" y2="0"/>'
    +         '<line class="fui-spl-ring-tk" x1="0" y1="88" x2="0" y2="100"/>'
    +         '<line class="fui-spl-ring-tk" x1="-88" y1="0" x2="-100" y2="0"/>'
    +       '</svg>'
    +     '</div>'
    +     '<div class="fui-spl-logo-cnt">'
    +       '<div class="fui-spl-logo-bg"></div>'
    +       '<img class="fui-spl-logo-img" src="/picture/WS-logo-2.png" alt="" aria-hidden="true">'
    +     '</div>'
    +   '</div>'
    +   '<div class="fui-spl-label-cn" id="fui-spl-cn">CSC·ALLIANCE</div>'
    +   '<div class="fui-spl-label-en" id="fui-spl-en">PUBLIC WM <span class="fui-spl-dot">◈</span> UPLINK</div>'
    +   '<div class="fui-spl-sr">'
    +     '<span class="fui-spl-sr-dot"></span>'
    +     '<span class="fui-spl-sr-txt" id="fui-spl-status">ESTABLISHING CONNECTION</span>'
    +   '</div>'
    +   '<div class="fui-spl-bar">'
    +     '<div class="fui-spl-bar-track"><div class="fui-spl-bar-fill" id="fui-spl-fill"></div></div>'
    +     '<span class="fui-spl-bar-pct" id="fui-spl-pct">0%</span>'
    +   '</div>'
    +   '<div class="fui-spl-info" id="fui-spl-info">// INITIALIZING TACTICAL UPLINK</div>'
    + '</div>'
    + '<div class="fui-spl-footer">'
    +   '<span>CSC·Alliance</span>'
    +   '<span>TENNO TACTICAL NETWORK</span>'
    +   '<span id="fui-spl-utc">UTC 00:00:00</span>'
    + '</div>';

  (document.body || document.documentElement).appendChild(spl);

  /* ── 动画控制器 ── */
  var _statusEl = document.getElementById('fui-spl-status');
  var _infoEl   = document.getElementById('fui-spl-info');
  var _fillEl   = document.getElementById('fui-spl-fill');
  var _pctEl    = document.getElementById('fui-spl-pct');
  var _leftEl   = document.getElementById('fui-spl-left');
  var _rightEl  = document.getElementById('fui-spl-right');
  var _utcEl    = document.getElementById('fui-spl-utc');
  var _hexWrap  = document.getElementById('fui-spl-hex');

  if (_leftEl)  _leftEl.textContent  = _genSideLines();
  if (_rightEl) _rightEl.textContent = _genSideLines();
  if (_utcEl)   _startUtc(_utcEl);

  var _pct = 0;
  function _setBar(v) {
    _pct = Math.min(100, Math.max(0, v));
    if (_fillEl) _fillEl.style.width = _pct + '%';
    if (_pctEl)  _pctEl.textContent  = Math.round(_pct) + '%';
  }

  var _stages = [
    { at: 200,  status: 'ESTABLISHING CONNECTION',    info: '// INITIALIZING TACTICAL UPLINK',      pct: 12 },
    { at: 500,  status: 'AUTHENTICATING TENNO ID',    info: '// VERIFYING ACCESS CREDENTIALS',       pct: 32 },
    { at: 900,  status: 'DOWNLOADING AUCTION DATA',   info: '// LOADING CSC·ALLIANCE PUBLIC WM',     pct: 58 },
    { at: 1300, status: 'SYNCHRONIZING MARKET DATA',  info: '// SYNCING OPERATIONAL RECORDS',        pct: 80 },
    { at: 1700, status: 'UPLINK ESTABLISHED',         info: '// ALL SYSTEMS NOMINAL · READY',        pct: 96 }
  ];
  _stages.forEach(function(s) {
    setTimeout(function() {
      if (_statusEl) _statusEl.textContent = s.status;
      if (_infoEl)   _infoEl.textContent   = s.info;
      _setBar(s.pct);
    }, s.at);
  });

  setTimeout(function() {
    if (_hexWrap) _hexWrap.classList.add('fui-spl-spinning');
  }, 1100);

  /* ── 淡出逻辑 ── */
  var _dismissed = false;
  var MIN_VISIBLE = 2000;
  var _startTime  = Date.now();

  function _dismiss() {
    if (_dismissed) return;
    _dismissed = true;
    clearInterval(_utcTimer);
    _setBar(100);
    var remain = Math.max(0, MIN_VISIBLE - (Date.now() - _startTime));
    setTimeout(function() {
      spl.classList.add('fui-splash--done');
      if (document.body) { document.body.classList.add('fui-in'); document.body.style.opacity = '1'; }
      setTimeout(function() { if (spl.parentNode) spl.parentNode.removeChild(spl); }, 850);
    }, remain);
  }

  window.__fuiBoot = { done: _dismiss };

  (document.fonts ? document.fonts.ready : Promise.resolve())
    .catch(function() {})
    .then(function() {
      if (!window.__fuiBootManual) _dismiss();
    });

  setTimeout(_dismiss, 8000);
}());
