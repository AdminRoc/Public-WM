(function () {
  /* 极简/护眼模式：登录页星空/扫光两个纯装饰效果一律不跑
     （login.html 不引入 shared.js，独立复刻同名判断） */
  function _isMinimal() {
    return document.documentElement.getAttribute('data-fui-theme') === 'minimal';
  }
  function _isEyecare() {
    return document.documentElement.getAttribute('data-fui-theme') === 'eyecare';
  }

  /* canvas 不解析 CSS 变量：统一经 getComputedStyle 读主题变量。
     运行中切主题不重载页面，故按「主题+变量名」缓存，切主题自动重读。 */
  var _cssVarCache = {};
  function _cssVar(name, fallback) {
    var theme = document.documentElement.getAttribute('data-fui-theme') || 'gold';
    var key = theme + '|' + name;
    if (!_cssVarCache[key]) {
      var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      _cssVarCache[key] = v || fallback;
    }
    return _cssVarCache[key];
  }
  /* --g-* 通道契约是「r,g,b」三通道数字，直接拼 rgba；格式异常时回兜底，不中断装饰渲染 */
  function _rgbChan(name, fallback) {
    var v = _cssVar(name, fallback);
    return /^\d{1,3},\s*\d{1,3},\s*\d{1,3}$/.test(v) ? v : fallback;
  }

  /* ── 三重重置 body opacity ── */
  // 1. 字体就绪
  (document.fonts ? document.fonts.ready : Promise.resolve())
    .catch(function () {})
    .then(function () { document.body.style.opacity = '1'; });
  // 2. 2s 兜底
  setTimeout(function () { document.body.style.opacity = '1'; }, 2000);
  // 3. load 兜底
  window.addEventListener('load', function () { document.body.style.opacity = '1'; });

  /* ── 登录卡片金光扫过（Canvas，软径向光晕） ── */
  (function initCardGlow() {
    var card = document.getElementById('bw-login-form');
    /* 护眼主题同极简：纸面阅读感上不跑扫光动效 */
    if (!card || _isMinimal() || _isEyecare()) return;

    var canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:0;display:block;';
    card.insertBefore(canvas, card.firstChild);

    var ctx = canvas.getContext('2d');
    var W = 0, H = 0;

    function resize() {
      W = canvas.width  = card.offsetWidth;
      H = canvas.height = card.offsetHeight;
    }
    resize();
    window.addEventListener('resize', resize);

    /* 每 9 秒一次扫光，前 38% 时间（≈3.4s）金光从右上扫向左下 */
    var PERIOD = 9000;
    var ACTIVE  = 0.38;

    function draw(ts) {
      if (_isMinimal() || _isEyecare()) return; /* 运行中途切到极简/护眼模式：本帧起停止渲染循环 */
      if (!W || !H) { requestAnimationFrame(draw); return; }
      ctx.clearRect(0, 0, W, H);

      var phase = (ts % PERIOD) / PERIOD;

      if (phase < ACTIVE) {
        var p = phase / ACTIVE;                            // 0 → 1
        var ease = p < 0.5 ? 2*p*p : -1 + (4 - 2*p)*p;  // ease-in-out

        /* 钟形包络：光从 0 增到峰值再降为 0，无硬切边 */
        var alpha = Math.sin(p * Math.PI) * 0.22;

        /* 光心路径：从卡片右上角外侧扫向左下角外侧 */
        var cx = W * (1.15 - 1.3 * ease);
        var cy = H * (-0.15 + 1.3 * ease);

        /* 大半径软径向光晕：颜色从写死的金色六段改为读主题通道
           （亮段 --g-hi / 主体 --g-primary），各主题扫光跟随自己的强调色；
           兜底为 gold 的主金/高光金通道值 */
        var hi  = _rgbChan('--g-hi', '255,215,100');
        var pri = _rgbChan('--g-primary', '212,168,74');
        var r = Math.max(W, H) * 0.9;
        var g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        g.addColorStop(0,    'rgba(' + hi + ',' + alpha + ')');
        g.addColorStop(0.15, 'rgba(' + hi + ',' + (alpha * 0.85) + ')');
        g.addColorStop(0.35, 'rgba(' + pri + ',' + (alpha * 0.55) + ')');
        g.addColorStop(0.60, 'rgba(' + pri + ',' + (alpha * 0.22) + ')');
        g.addColorStop(0.85, 'rgba(' + pri + ',' + (alpha * 0.06) + ')');
        g.addColorStop(1,    'rgba(' + pri + ',0)');

        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
      }

      requestAnimationFrame(draw);
    }

    requestAnimationFrame(draw);
  })();

  /* ════════════════════════════════════════════════════
     登录逻辑
     主流程（无感登录）：凭据直交 Worker POST /api/auth/login，
       服务端直连 WM 试登录，成功即 Set-Cookie 建立会话；
       被 CF 人机验证拦截（cf_challenge）时自动展开下方手动 JWT 指引。
     兜底（JWT）：按 7 步图文 F12 复制 JWT 粘贴登录
       （POST /api/auth/login-jwt），用户也可随时手动点击
       「改用 JWT 登录」展开。
     （公版无 JWT 池 / 镜像登录：JWT 不会在服务端保存，只能手动粘贴）
     ════════════════════════════════════════════════════ */
  var form      = document.getElementById('bw-login-form');
  var btn       = document.getElementById('bw-login-btn');
  var errEl     = document.getElementById('bw-login-err');
  var jwtPanel  = document.getElementById('bw-mode-jwt');
  var jwtToggle = document.getElementById('bw-jwt-toggle');
  var jwtBtn    = document.getElementById('bw-jwt-btn');
  var jwtInput  = document.getElementById('bw-jwt');

  function showError(msg) {
    errEl.textContent = msg;
    errEl.classList.add('show');
    errEl.classList.remove('bw-login-err--hide');
  }
  function hideError() { errEl.classList.remove('show'); }

  function revealJwtPanel(show) {
    var willShow = (typeof show === 'boolean') ? show : !jwtPanel.classList.contains('active');
    jwtPanel.classList.toggle('active', willShow);
    jwtToggle.textContent = willShow ? '收起 JWT 登录 ↑' : '改用 JWT 登录 →';
    if (willShow) {
      var jd = document.getElementById('bw-jwt-details');
      if (jd) jd.open = true; /* 自动展开 7 步图文，零基础用户不用再找入口 */
      setTimeout(function () { jwtInput.focus(); }, 60);
    }
  }

  function creds() {
    return {
      email:    document.getElementById('bw-email').value.trim(),
      password: document.getElementById('bw-pass').value,
    };
  }

  /* ── 主流程：Worker 直连无感登录 ── */
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    hideError();
    var c = creds();
    if (!c.email || !c.password) { showError('请输入邮箱和密码'); return; }

    btn.disabled = true;
    btn.textContent = '正在尝试无感登录…';

    /* 登录请求自动重试：WM/网络偶发超时，最多重试 3 次（业务错误响应不重试） */
    function attemptLogin(i) {
      return fetch('https://pwm-api.wfspeed.run/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email: c.email, password: c.password }),
      }).catch(function (err) {
        if (i < 2) {
          return new Promise(function (res) { setTimeout(res, 1000); }).then(function () { return attemptLogin(i + 1); });
        }
        throw err;
      });
    }
    attemptLogin(0).then(function (r) {
      return r.json().then(function (j) { return { ok: r.ok, body: j }; });
    }).then(function (res) {
      if (res.body && res.body.ok === true) {
        /* 会话 cookie 由响应 Set-Cookie 自动种下（same-origin fetch 会存储），无需额外代码 */
        btn.textContent = '✓ 登录成功，正在进入系统…';
        setTimeout(function () { location.href = '/'; }, 300);
        return;
      }
      btn.disabled = false; btn.textContent = '进入系统';
      if (res.body && res.body.cf_challenge === true) {
        /* 被 CF 人机验证拦截：摊开手动 JWT 图文指引 */
        showError('WM 当前要求人机验证，无法自动登录——请按下方图文步骤手动获取 JWT 粘贴登录（约 1 分钟）。');
        revealJwtPanel(true);
        jwtPanel.scrollIntoView({ behavior: 'smooth' });
        return;
      }
      /* 其他错误（如密码错误）：只报错，不展开 JWT 面板。
         统一过 bwWmErrorText：worker 包装的错误虽多为中文，但 WM 上游
         异常（502/JWT 无效等）会带英文细节，翻译后用户才看得懂 */
      showError(window.bwWmErrorText((res.body && res.body.error) || '登录失败'));
    }).catch(function (netErr) {
      btn.disabled = false; btn.textContent = '进入系统';
      showError(window.bwWmErrorText(netErr) + ' 也可以改用下方 JWT 登录。');
      revealJwtPanel(true);
    });
  });

  /* ── 兜底：JWT 登录 ──
     公版无 JWT 池：必须由用户手动粘贴 JWT，与 /api/auth/login-jwt 直连。 */
  jwtBtn.addEventListener('click', function () {
    hideError();
    var c = creds();
    if (!c.email || !c.password) { showError('请输入邮箱和密码'); return; }
    var jwt = jwtInput.value.trim();
    if (!jwt) { showError('请先按上方图文步骤获取并粘贴 JWT（公版不保存 JWT，无法自动填入）。'); return; }
    jwtBtn.disabled = true;
    jwtBtn.textContent = '验证中…';

    fetch('https://pwm-api.wfspeed.run/api/auth/login-jwt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email: c.email, password: c.password, jwt: jwt }),
    }).then(function (r) {
      return r.json().then(function (j) { return { ok: r.ok, body: j }; });
    }).then(function (res) {
      if (!res.ok) {
        /* 与主登录同一套翻译：JWT 无效/过期、WM 上游异常等都在这里转成中文人话 */
        showError(window.bwWmErrorText((res.body && res.body.error) || 'JWT 登录失败'));
        jwtBtn.disabled = false; jwtBtn.textContent = '使用 JWT 登录';
        return;
      }
      jwtBtn.textContent = '✓ 验证通过';
      setTimeout(function () { location.href = '/'; }, 420);
    }).catch(function (netErr) {
      showError(window.bwWmErrorText(netErr));
      jwtBtn.disabled = false; jwtBtn.textContent = '使用 JWT 登录';
    });
  });

  /* ── 手动展开/收起 JWT 兜底区 ── */
  jwtToggle.addEventListener('click', function () { revealJwtPanel(); });

  /* ── 从验证通道带错误重定向回来：展示错误并自动展开 JWT 兜底 ── */
  (function() {
    var m = location.search.match(/[?&]err=([^&]*)/);
    if (m) {
      /* err 参数可能携带 WM 原始错误码，同样过翻译函数再展示 */
      showError(window.bwWmErrorText(decodeURIComponent(m[1])));
      revealJwtPanel(true);
      // 清除 URL 中的 err 参数
      if (history.replaceState) history.replaceState(null, '', location.pathname);
    }
  })();

})();
