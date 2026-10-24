export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// A standalone operational page: it must render even while the business
// database is being renamed, so it deliberately avoids the app shell and DB.
const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>数据库恢复状态</title>
<style>
:root{color-scheme:light dark;--bg:#f4f6f8;--card:#fff;--text:#111827;--muted:#6b7280;--line:#e5e7eb;--brand:#111827;--brand-text:#fff;--ok:#047857;--err:#b91c1c;--warn:#b45309}
@media(prefers-color-scheme:dark){:root{--bg:#0b0f16;--card:#111827;--text:#f9fafb;--muted:#9ca3af;--line:#1f2937;--brand:#f9fafb;--brand-text:#111827;--ok:#34d399;--err:#f87171;--warn:#fbbf24}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;background:var(--bg);color:var(--text)}
.card{width:min(96vw,640px);padding:36px;border:1px solid var(--line);border-radius:18px;background:var(--card);box-shadow:0 24px 70px rgba(15,23,42,.10)}
.mark{width:44px;height:44px;border-radius:13px;background:var(--brand);color:var(--brand-text);display:grid;place-items:center;font-weight:700;margin-bottom:20px}
h1{font-size:22px;margin:0 0 8px;letter-spacing:-.01em}p{margin:0;line-height:1.7;font-size:14px;color:var(--muted)}
.badge{display:inline-flex;align-items:center;gap:6px;margin-bottom:14px;padding:4px 10px;border:1px solid var(--line);border-radius:999px;font-size:12px;color:var(--muted)}
.dot{width:7px;height:7px;border-radius:50%;background:var(--warn)}
.dot.ok{background:var(--ok)}.dot.err{background:var(--err)}
ol.steps{list-style:none;margin:26px 0 0;padding:0;display:flex;flex-direction:column;gap:0}
ol.steps li{position:relative;display:flex;gap:12px;padding:0 0 22px 0;font-size:14px}
ol.steps li:last-child{padding-bottom:0}
ol.steps li::before{content:"";position:absolute;left:9px;top:22px;bottom:0;width:2px;background:var(--line)}
ol.steps li:last-child::before{display:none}
.step-dot{width:20px;height:20px;border-radius:50%;border:2px solid var(--line);background:var(--card);flex:none;margin-top:1px}
li.done .step-dot{border-color:var(--ok);background:var(--ok)}
li.active .step-dot{border-color:var(--warn);box-shadow:0 0 0 4px color-mix(in srgb,var(--warn) 18%,transparent)}
li.failed .step-dot{border-color:var(--err);background:var(--err)}
.step-title{font-weight:500}.step-hint{font-size:12px;color:var(--muted);margin-top:2px}
.meta{margin-top:24px;padding-top:18px;border-top:1px solid var(--line);display:grid;gap:8px;font-size:13px}
.meta div{display:flex;justify-content:space-between;gap:16px}.meta dt{color:var(--muted)}.meta dd{margin:0;text-align:right;word-break:break-all}
.error{margin-top:18px;padding:12px 14px;border-radius:10px;border:1px solid color-mix(in srgb,var(--err) 35%,transparent);color:var(--err);font-size:13px;line-height:1.6}
.actions{margin-top:22px;display:flex;flex-wrap:wrap;gap:10px}
button,a.button{appearance:none;border:1px solid var(--line);background:transparent;color:var(--text);border-radius:9px;padding:9px 14px;font-size:13px;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center}
button.primary,a.primary{background:var(--brand);color:var(--brand-text);border-color:var(--brand)}
button[disabled]{opacity:.55;cursor:wait}
.hint{margin-top:14px;font-size:12px;color:var(--muted)}
</style>
</head>
<body>
<main class="card">
  <div class="mark">评</div>
  <div class="badge"><span class="dot" id="dot"></span><span id="badge">正在读取恢复状态</span></div>
  <h1>数据库恢复</h1>
  <p id="summary">正在确认恢复任务状态，请稍候。此页面在维护期间保持可访问。</p>
  <ol class="steps" id="steps">
    <li data-step="confirmed"><span class="step-dot"></span><div><div class="step-title">确认恢复</div><div class="step-hint">校验密码、确认短语与数据库指纹</div></div></li>
    <li data-step="snapshot"><span class="step-dot"></span><div><div class="step-title">创建安全快照</div><div class="step-hint">为当前数据库生成可回退备份</div></div></li>
    <li data-step="exported"><span class="step-dot"></span><div><div class="step-title">导出审计旁路</div><div class="step-hint">保存恢复前操作日志并写入候选库</div></div></li>
    <li data-step="swapping"><span class="step-dot"></span><div><div class="step-title">切换数据库</div><div class="step-hint">原子重命名候选库与当前库</div></div></li>
    <li data-step="swapped"><span class="step-dot"></span><div><div class="step-title">校验恢复结果</div><div class="step-hint">检查迁移、管理员账号与外键</div></div></li>
    <li data-step="completed"><span class="step-dot"></span><div><div class="step-title">恢复完成</div><div class="step-hint">系统恢复正常访问</div></div></li>
  </ol>
  <dl class="meta">
    <div><dt>恢复任务</dt><dd id="restore-id">—</dd></div>
    <div><dt>开始时间</dt><dd id="started">—</dd></div>
    <div><dt>最近更新</dt><dd id="updated">—</dd></div>
    <div id="audit-row" hidden><dt>审计旁路</dt><dd id="audit">—</dd></div>
  </dl>
  <div class="error" id="error" hidden></div>
  <div class="actions">
    <button class="primary" id="ack" hidden>我已了解，解除维护模式</button>
    <a class="button" id="home" href="/" hidden>返回系统</a>
    <button id="retry" hidden>重新检查</button>
  </div>
  <p class="hint" id="hint">页面每 3 秒自动刷新，直到恢复任务结束。</p>
</main>
<script>
(() => {
  const phases = ["confirmed","snapshot","exported","swapping","swapped","completed"];
  const labels = { preflight:"预检中", ready:"预检通过，等待确认", confirmed:"已确认，准备恢复", snapshot:"正在创建安全快照", exported:"正在导出审计旁路", swapping:"正在原子切换数据库", swapped:"正在校验恢复结果", completed:"恢复完成", failed:"恢复失败", "rolled-back":"已自动回滚" };
  const state = { timer: null, data: null, stopped: false };
  const $ = id => document.getElementById(id);
  const fmt = value => { if (!value) return "—"; const date = new Date(value); return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("zh-CN", { hour12: false }); };
  const bytes = value => { if (value == null) return "—"; if (value <= 0) return "0 B"; const units = ["B","KiB","MiB","GiB","TiB"]; const i = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024))); return (value / 1024 ** i).toFixed(i === 0 ? 0 : 1) + " " + units[i]; };

  function paint(stateValue) {
    const phase = stateValue.phase;
    const terminal = ["completed","failed","rolled-back"].includes(phase);
    $("restore-id").textContent = stateValue.id || "—";
    $("started").textContent = fmt(stateValue.startedAt);
    $("updated").textContent = fmt(stateValue.updatedAt);
    if (stateValue.auditExport) {
      $("audit-row").hidden = false;
      $("audit").textContent = stateValue.auditExport.count + " 条 · " + bytes(stateValue.auditExport.bytes);
    }
    const badge = $("badge");
    const dot = $("dot");
    badge.textContent = labels[phase] || phase || "无恢复任务";
    dot.className = "dot" + (phase === "completed" ? " ok" : terminal ? " err" : "");
    let summary = "恢复任务正在执行，系统已暂停业务写入，请勿关闭服务器。";
    if (phase === "completed") summary = "数据库恢复已完成，业务数据已切换为备份内容。所有账号需要重新登录。";
    else if (phase === "rolled-back") summary = "恢复失败，系统已自动回滚到恢复前数据库。";
    else if (phase === "failed") summary = "恢复任务未成功完成。请根据下方信息联系运维处理。";
    else if (phase === "ready") summary = "恢复预检已通过，等待管理员在备份页面确认执行。";
    $("summary").textContent = summary;

    const index = phases.indexOf(phase);
    document.querySelectorAll("#steps li").forEach(item => {
      const stepIndex = phases.indexOf(item.dataset.step);
      item.className = "";
      if (phase === "failed" || phase === "rolled-back") {
        if (index === -1 && item.dataset.step === "swapping") item.className = "failed";
      } else if (index >= 0) {
        if (stepIndex < index) item.className = "done";
        else if (stepIndex === index) item.className = phase === "completed" ? "done" : "active";
      }
    });

    const error = $("error");
    if (stateValue.errorCode || stateValue.message) {
      error.hidden = false;
      error.textContent = [stateValue.errorCode, stateValue.message].filter(Boolean).join("：");
    } else error.hidden = true;

    const ack = $("ack");
    ack.hidden = !stateValue.maintenance;
    const home = $("home");
    home.hidden = !(terminal || !stateValue.maintenance);
    const hint = $("hint");
    if (terminal) {
      hint.textContent = "任务已结束。如页面仍显示维护提示，可尝试刷新或联系运维。";
      stop();
    } else hint.textContent = "页面每 3 秒自动刷新，直到恢复任务结束。";
  }

  function stop() { state.stopped = true; if (state.timer) clearTimeout(state.timer); state.timer = null; }

  async function load() {
    $("retry").hidden = true;
    try {
      const response = await fetch("/api/system/restore-status", { cache: "no-store", credentials: "same-origin" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        $("badge").textContent = "无法读取恢复状态";
        $("dot").className = "dot err";
        $("summary").textContent = response.status === 403 ? "当前浏览器没有有效的恢复状态令牌。请使用启动恢复的管理员浏览器查看，或直接等待系统自动恢复。" : "读取恢复状态失败，系统可能正在重启。";
        $("error").hidden = false;
        $("error").textContent = data.error || data.message || ("HTTP " + response.status);
        $("retry").hidden = false;
        $("home").hidden = false;
        stop();
        return;
      }
      if (!data.phase) {
        $("badge").textContent = "当前没有恢复任务";
        $("dot").className = "dot ok";
        $("summary").textContent = "系统没有进行中的数据库恢复。";
        $("home").hidden = false;
        stop();
        return;
      }
      state.data = data;
      paint(data);
      if (!state.stopped) state.timer = setTimeout(load, 3000);
    } catch (error) {
      $("badge").textContent = "连接中断，正在重试";
      $("dot").className = "dot err";
      $("summary").textContent = "应用可能正在重启或切换数据库，页面会继续尝试连接。";
      $("retry").hidden = false;
      state.timer = setTimeout(load, 3000);
    }
  }

  $("ack").addEventListener("click", async () => {
    const button = $("ack");
    button.disabled = true;
    try {
      const response = await fetch("/api/system/restore-status", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ action: "acknowledge" }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || data.message || "解除维护失败");
      $("ack").hidden = true;
      if (data.state) paint(data.state);
      $("home").hidden = false;
    } catch (error) {
      $("error").hidden = false;
      $("error").textContent = error.message || "解除维护失败";
      button.disabled = false;
    }
  });
  $("retry").addEventListener("click", () => { stop(); state.stopped = false; $("retry").hidden = true; load(); });
  load();
})();
</script>
</body>
</html>`;

export async function GET() {
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
