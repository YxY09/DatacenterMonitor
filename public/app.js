const state = {
  room: "all",
  charts: {}
};

const palette = {
  accent: "#d79921",
  orange: "#fe8019",
  blue: "#83a598",
  green: "#b8bb26",
  purple: "#d3869b",
  red: "#fb4934",
  text: "#ebdbb2",
  muted: "#a89984",
  grid: "#504945"
};

function $(id) {
  return document.getElementById(id);
}

function setText(id, value) {
  const node = $(id);
  if (node) node.textContent = value;
}

function fmt(value, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "--";
  return Number(value).toLocaleString("zh-CN", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits
  });
}

function fmtInt(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "--";
  return Number(value).toLocaleString("zh-CN", { maximumFractionDigits: 0 });
}

function fmtPercent(value) {
  return value === null || value === undefined ? "--" : `${fmt(value, 2)}%`;
}

function metricValueDigits(unit) {
  return ["MB", "个", "pkt/s"].includes(unit) ? 0 : 2;
}

async function api(path) {
  const response = await fetch(path);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || `请求失败：${path}`);
  }
  return data;
}

function showError(message) {
  const banner = $("errorState");
  banner.textContent = message;
  banner.classList.remove("myui-hidden");
}

function clearError() {
  const banner = $("errorState");
  banner.textContent = "";
  banner.classList.add("myui-hidden");
}

function initCharts() {
  state.charts.trend = echarts.init($("trendChart"));
  state.charts.disk = echarts.init($("diskChart"));
  state.charts.rooms = echarts.init($("roomChart"));
  state.charts.topHosts = echarts.init($("topHostsChart"));
  window.addEventListener("resize", () => {
    Object.values(state.charts).forEach((chart) => chart.resize());
  });
}

function baseChartOption() {
  return {
    textStyle: { color: palette.text, fontFamily: "Microsoft YaHei, Segoe UI, sans-serif" },
    tooltip: {
      trigger: "axis",
      backgroundColor: "#282828",
      borderColor: "#665c54",
      textStyle: { color: palette.text }
    },
    grid: { left: 48, right: 26, top: 36, bottom: 48 },
    xAxis: {
      type: "category",
      axisLine: { lineStyle: { color: palette.grid } },
      axisTick: { show: false },
      axisLabel: { color: palette.muted }
    },
    yAxis: {
      type: "value",
      splitLine: { lineStyle: { color: palette.grid, type: "dashed" } },
      axisLabel: { color: palette.muted }
    }
  };
}

function renderOverview(data) {
  setText("hostCount", fmtInt(data.host_count));
  setText("roomCount", `${fmtInt(data.room_count)} 个机房`);
  setText("metricCount", fmtInt(data.metric_count));
  setText("cpuAvg", fmtPercent(data.avg_cpu_usage));
  setText("cpuWait", `IO wait ${fmtPercent(data.avg_cpu_wait)}`);
  setText("memAvg", fmt(data.avg_mem_used, 0));
  setText("diskUtil", fmtPercent(data.max_disk_util));
  setText("diskLatency", `延迟 ${fmt(data.avg_disk_latency, 2)} ms`);
  setText("alertCount", fmtInt(data.alert_count));
  setText("latestHour", `性能 ${data.latest_pref_hour || "--"} / 磁盘 ${data.latest_disk_hour || "--"}`);
}

function renderTrendChart(rows) {
  const base = baseChartOption();
  const labels = rows.map((row) => row.event_hour);
  const visibleHours = 96;
  const zoomStart = rows.length > visibleHours ? Math.round(((rows.length - visibleHours) / rows.length) * 100) : 0;
  const option = {
    ...base,
    legend: {
      top: 0,
      right: 4,
      textStyle: { color: palette.muted }
    },
    grid: { left: 52, right: 112, top: 44, bottom: 48 },
    tooltip: {
      ...base.tooltip,
      axisPointer: { type: "cross", label: { backgroundColor: "#3c3836" } }
    },
    dataZoom: [
      {
        type: "inside",
        start: zoomStart,
        end: 100,
        filterMode: "none"
      }
    ],
    xAxis: {
      ...base.xAxis,
      data: labels,
      axisLabel: {
        ...base.xAxis.axisLabel,
        formatter: (value) => String(value).slice(5, 16)
      }
    },
    yAxis: [
      {
        ...base.yAxis,
        name: "CPU / IO",
        max: 100,
        nameTextStyle: { color: palette.muted },
        axisLabel: {
          color: palette.muted,
          formatter: "{value}%"
        }
      },
      {
        type: "value",
        name: "内存",
        position: "right",
        nameTextStyle: { color: palette.muted },
        splitLine: { show: false },
        axisLabel: {
          color: palette.muted,
          formatter: (value) => `${Math.round(value / 1024)}G`
        }
      },
      {
        type: "value",
        name: "网络",
        position: "right",
        offset: 54,
        nameTextStyle: { color: palette.muted },
        splitLine: { show: false },
        axisLabel: {
          color: palette.muted,
          formatter: (value) => `${Math.round(value)}`
        }
      }
    ],
    series: [
      { name: "CPU使用率%", type: "line", smooth: true, showSymbol: false, sampling: "lttb", yAxisIndex: 0, data: rows.map((row) => row.cpu_usage), color: palette.orange, lineStyle: { width: 2.2 } },
      { name: "CPU等待%", type: "line", smooth: true, showSymbol: false, sampling: "lttb", yAxisIndex: 0, data: rows.map((row) => row.cpu_wait), color: palette.purple, lineStyle: { width: 2 } },
      { name: "内存MB", type: "line", smooth: true, showSymbol: false, sampling: "lttb", yAxisIndex: 1, data: rows.map((row) => row.mem_used), color: palette.blue, lineStyle: { width: 2 }, areaStyle: { opacity: 0.08 } },
      { name: "入站MB/s", type: "line", smooth: true, showSymbol: false, sampling: "lttb", yAxisIndex: 2, data: rows.map((row) => row.net_in), color: palette.green, lineStyle: { width: 2, type: "dashed" } }
    ]
  };
  state.charts.trend.setOption(option, true);
}

function renderDiskChart(rows) {
  const base = baseChartOption();
  const labels = rows.map((row) => row.event_hour);
  const visibleHours = 96;
  const zoomStart = rows.length > visibleHours ? Math.round(((rows.length - visibleHours) / rows.length) * 100) : 0;
  const option = {
    ...base,
    legend: { top: 0, right: 4, textStyle: { color: palette.muted } },
    grid: { left: 48, right: 68, top: 42, bottom: 48 },
    tooltip: {
      ...base.tooltip,
      axisPointer: { type: "cross", label: { backgroundColor: "#3c3836" } }
    },
    dataZoom: [
      {
        type: "inside",
        start: zoomStart,
        end: 100,
        filterMode: "none"
      }
    ],
    xAxis: {
      ...base.xAxis,
      data: labels,
      axisLabel: {
        ...base.xAxis.axisLabel,
        formatter: (value) => String(value).slice(5, 16)
      }
    },
    yAxis: [
      {
        ...base.yAxis,
        name: "延迟 / 利用率",
        nameTextStyle: { color: palette.muted },
        axisLabel: { color: palette.muted }
      },
      {
        type: "value",
        name: "读写扇区",
        nameTextStyle: { color: palette.muted },
        splitLine: { show: false },
        axisLabel: {
          color: palette.muted,
          formatter: (value) => (value >= 10000 ? `${Math.round(value / 10000)}万` : value)
        }
      }
    ],
    series: [
      { name: "磁盘延迟ms", type: "line", smooth: true, showSymbol: false, yAxisIndex: 0, z: 3, data: rows.map((row) => row.disk_latency), color: palette.orange },
      { name: "磁盘利用率%", type: "line", smooth: true, showSymbol: false, yAxisIndex: 0, z: 3, data: rows.map((row) => row.disk_util), color: palette.red },
      {
        name: "读写扇区",
        type: "bar",
        yAxisIndex: 1,
        barWidth: "42%",
        barMaxWidth: 7,
        barCategoryGap: "58%",
        data: rows.map((row) => row.disk_rw),
        color: palette.blue,
        z: 1,
        itemStyle: { borderRadius: [3, 3, 0, 0], opacity: 0.62 },
        emphasis: { itemStyle: { opacity: 0.9 } }
      }
    ]
  };
  state.charts.disk.setOption(option, true);
}

function renderRoomChart(rows) {
  const labels = rows.map((row) => row.room);
  state.charts.rooms.setOption({
    ...baseChartOption(),
    tooltip: { ...baseChartOption().tooltip, trigger: "axis" },
    legend: { top: 0, right: 4, textStyle: { color: palette.muted } },
    grid: { left: 42, right: 18, top: 38, bottom: 42 },
    xAxis: { ...baseChartOption().xAxis, data: labels },
    series: [
      { name: "CPU使用率%", type: "bar", data: rows.map((row) => row.cpu_usage), color: palette.orange, barMaxWidth: 22 },
      { name: "CPU等待%", type: "bar", data: rows.map((row) => row.cpu_wait), color: palette.purple, barMaxWidth: 22 },
      { name: "主机数", type: "line", data: rows.map((row) => row.host_count), color: palette.green }
    ]
  }, true);
}

function renderTopHosts(rows) {
  const sorted = [...rows].sort((a, b) => Number(a.cpu_usage) - Number(b.cpu_usage));
  state.charts.topHosts.setOption({
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      backgroundColor: "#282828",
      borderColor: "#665c54",
      textStyle: { color: palette.text }
    },
    grid: { left: 104, right: 24, top: 18, bottom: 28 },
    xAxis: {
      type: "value",
      axisLabel: { color: palette.muted },
      splitLine: { lineStyle: { color: palette.grid, type: "dashed" } }
    },
    yAxis: {
      type: "category",
      data: sorted.map((row) => row.hostname),
      axisLabel: { color: palette.muted, width: 96, overflow: "truncate" },
      axisTick: { show: false },
      axisLine: { lineStyle: { color: palette.grid } }
    },
    series: [
      {
        name: "CPU使用率%",
        type: "bar",
        data: sorted.map((row) => row.cpu_usage),
        color: palette.orange,
        barMaxWidth: 18,
        label: {
          show: true,
          position: "right",
          color: palette.text,
          formatter: "{c}%"
        }
      }
    ]
  }, true);
}

function appendText(parent, className, text) {
  const node = document.createElement("span");
  node.className = className;
  node.textContent = text;
  parent.appendChild(node);
}

function createHostCell(hostname) {
  const cell = document.createElement("span");
  cell.className = "myui-host-cell";
  const text = String(hostname || "--");
  const [name, ...domainParts] = text.split(".");
  appendText(cell, "myui-host-name", name || text);
  if (domainParts.length) {
    appendText(cell, "myui-host-sub", domainParts.join("."));
  }
  return cell;
}

function createMetricCell(name, code) {
  const cell = document.createElement("span");
  cell.className = "myui-metric-cell";
  appendText(cell, "myui-metric-name", name || "--");
  if (code) {
    appendText(cell, "myui-metric-code", code);
  }
  return cell;
}

function createValuePill(value, unit) {
  const pill = document.createElement("span");
  pill.className = "myui-value-pill";
  const valueText = document.createElement("span");
  valueText.textContent = fmt(value, metricValueDigits(unit));
  pill.appendChild(valueText);
  if (unit) {
    appendText(pill, "myui-value-unit", unit);
  }
  return pill;
}

function createBarCell(value, maxValue, unit = "", fillClass = "") {
  const cell = document.createElement("span");
  cell.className = "myui-bar-cell";
  const numericValue = Number(value) || 0;
  const numericMax = Math.max(Number(maxValue) || 0, numericValue, 1);
  const percent = Math.max(0, Math.min(100, (numericValue / numericMax) * 100));

  const meta = document.createElement("span");
  meta.className = "myui-bar-meta";
  appendText(meta, "myui-bar-value", `${fmt(numericValue, unit === "台" ? 0 : 2)}${unit ? ` ${unit}` : ""}`);
  cell.appendChild(meta);

  const track = document.createElement("span");
  track.className = "myui-bar-track";
  const fill = document.createElement("span");
  fill.className = ["myui-bar-fill", fillClass].filter(Boolean).join(" ");
  fill.style.width = `${percent}%`;
  fill.style.minWidth = numericValue > 0 ? "10px" : "0";
  track.appendChild(fill);
  cell.appendChild(track);

  return cell;
}

function getAlertLevel(row) {
  const reason = row.reason || "";
  if (reason.includes("内存") || reason.includes("利用率")) return "critical";
  if (reason.includes("CPU") || reason.includes("IO") || reason.includes("延迟")) return "warning";
  return "info";
}

function renderCellContent(td, column, row) {
  const content = column.render(row);
  if (column.tag) {
    const span = document.createElement("span");
    span.className = ["myui-tag", column.tagClass?.(row)].filter(Boolean).join(" ");
    appendText(span, "myui-tag-text", content);
    td.appendChild(span);
  } else if (content && typeof content === "object" && "nodeType" in content) {
    td.appendChild(content);
  } else {
    td.textContent = content;
  }
}

function renderTable(tbodyId, rows, columns, emptyText, options = {}) {
  const tbody = $(tbodyId);
  const fragment = document.createDocumentFragment();
  if (!rows.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.className = "myui-cell-empty";
    td.colSpan = columns.length;
    td.textContent = emptyText;
    tr.appendChild(td);
    fragment.appendChild(tr);
  } else {
    for (const row of rows) {
      const tr = document.createElement("tr");
      if (options.rowClass) {
        tr.className = options.rowClass(row);
      }
      for (const column of columns) {
        const td = document.createElement("td");
        if (column.className) {
          td.className = column.className;
        }
        if (column.label) {
          td.dataset.label = column.label;
        }
        if (column.title) {
          td.title = column.title(row);
        }
        renderCellContent(td, column, row);
        tr.appendChild(td);
      }
      fragment.appendChild(tr);
    }
  }
  tbody.replaceChildren(fragment);
}

function renderRoomSummary(rows) {
  const maxCpu = Math.max(...rows.map((row) => Number(row.cpu_usage) || 0), 1);
  const maxWait = Math.max(...rows.map((row) => Number(row.cpu_wait) || 0), 1);
  renderTable("roomSummaryBody", rows, [
    { label: "机房", className: "myui-cell-room", render: (row) => row.room },
    { label: "主机", className: "myui-cell-bar", render: (row) => createBarCell(row.host_count, 8, "台", "myui-bar-fill-blue") },
    { label: "CPU", className: "myui-cell-bar", render: (row) => createBarCell(row.cpu_usage, maxCpu, "%") },
    { label: "IO wait", className: "myui-cell-bar", render: (row) => createBarCell(row.cpu_wait, maxWait, "%", "myui-bar-fill-purple") }
  ], "暂无机房汇总数据");
}

function renderHostPressure(rows) {
  const maxCpu = Math.max(...rows.map((row) => Number(row.cpu_usage) || 0), 1);
  const maxLoad = Math.max(...rows.map((row) => Number(row.load1) || 0), 1);
  renderTable("hostPressureBody", rows.slice(0, 8), [
    { label: "主机", className: "myui-cell-host", render: (row) => createHostCell(row.hostname), title: (row) => row.hostname },
    { label: "机房", className: "myui-cell-room", render: (row) => row.room },
    { label: "CPU", className: "myui-cell-bar", render: (row) => createBarCell(row.cpu_usage, maxCpu, "%") },
    { label: "Load", className: "myui-cell-bar", render: (row) => createBarCell(row.load1, maxLoad, "", "myui-bar-fill-red") }
  ], "暂无主机排行数据");
}

function renderAlertSummary(rows) {
  const summary = Array.from(rows.reduce((map, row) => {
    const key = row.reason || "其他异常";
    const item = map.get(key) || { reason: key, count: 0, max_value: 0, unit: row.unit || "" };
    item.count += 1;
    item.max_value = Math.max(item.max_value, Number(row.value) || 0);
    item.unit = item.unit || row.unit || "";
    map.set(key, item);
    return map;
  }, new Map()).values()).sort((a, b) => b.count - a.count);
  const maxCount = Math.max(...summary.map((row) => row.count), 1);
  renderTable("alertSummaryBody", summary, [
    {
      label: "类型",
      className: "myui-cell-reason",
      render: (row) => row.reason,
      tag: true,
      tagClass: (row) => `myui-tag-${getAlertLevel(row)}`
    },
    { label: "数量", className: "myui-cell-bar", render: (row) => createBarCell(row.count, maxCount, "条", "myui-bar-fill-red") },
    { label: "峰值", className: "myui-cell-value", render: (row) => createValuePill(row.max_value, row.unit) }
  ], "暂无告警统计数据");
}

function renderAlerts(rows) {
  renderTable("alertsBody", rows, [
    { label: "时间", className: "myui-cell-time", render: (row) => row.event_hour },
    { label: "机房", className: "myui-cell-room", render: (row) => row.room },
    { label: "主机", className: "myui-cell-host", render: (row) => createHostCell(row.hostname), title: (row) => row.hostname },
    {
      label: "指标",
      className: "myui-cell-metric",
      render: (row) => createMetricCell(row.metric_desc),
      title: (row) => row.metric_desc
    },
    { label: "数值", className: "myui-cell-value", render: (row) => createValuePill(row.value, row.unit) },
    {
      label: "原因",
      className: "myui-cell-reason",
      render: (row) => row.reason,
      title: (row) => row.reason,
      tag: true,
      tagClass: (row) => `myui-tag-${getAlertLevel(row)}`
    }
  ], "暂无异常记录", {
    rowClass: (row) => `myui-row-${getAlertLevel(row)}`
  });
}

function renderLatestMetrics(rows) {
  renderTable("latestBody", rows, [
    { label: "机房", className: "myui-cell-room", render: (row) => row.room },
    { label: "主机", className: "myui-cell-host", render: (row) => createHostCell(row.hostname), title: (row) => row.hostname },
    {
      label: "指标",
      className: "myui-cell-metric",
      render: (row) => createMetricCell(row.metric_desc, row.mod),
      title: (row) => `${row.metric_desc || "--"}${row.mod ? ` / ${row.mod}` : ""}`
    },
    { label: "数值", className: "myui-cell-value", render: (row) => createValuePill(row.avg_value, row.unit) }
  ], "暂无最新采样数据");
}

async function loadOptions() {
  const options = await api("/api/options");
  const select = $("roomSelect");
  const fragment = document.createDocumentFragment();
  const allOption = document.createElement("option");
  allOption.value = "all";
  allOption.textContent = "全部机房";
  fragment.appendChild(allOption);
  for (const room of options.rooms) {
    const option = document.createElement("option");
    option.value = room.room;
    option.textContent = `${room.room} (${room.host_count})`;
    fragment.appendChild(option);
  }
  select.replaceChildren(fragment);
}

async function refreshDashboard() {
  clearError();
  const query = new URLSearchParams({ room: state.room }).toString();
  try {
    const [overview, trends, diskTrends, rooms, topHosts, alerts, latest] = await Promise.all([
      api(`/api/overview?${query}`),
      api(`/api/trends?hours=168&${query}`),
      api(`/api/disk-trends?hours=240&${query}`),
      api("/api/rooms"),
      api(`/api/top-hosts?limit=10&${query}`),
      api(`/api/alerts?limit=30&${query}`),
      api(`/api/latest-metrics?limit=80&${query}`)
    ]);
    renderOverview(overview);
    renderTrendChart(trends);
    renderDiskChart(diskTrends);
    renderRoomChart(rooms);
    renderTopHosts(topHosts);
    renderRoomSummary(rooms);
    renderHostPressure(topHosts);
    renderAlertSummary(alerts);
    renderAlerts(alerts);
    renderLatestMetrics(latest);
  } catch (error) {
    showError(`数据加载失败：${error.message}。请先确认 MySQL 已启动，并执行 npm run db:import。`);
  }
}

async function bootstrap() {
  initCharts();
  $("roomSelect").addEventListener("change", (event) => {
    state.room = event.target.value;
    refreshDashboard();
  });
  $("refreshBtn").addEventListener("click", refreshDashboard);
  try {
    await loadOptions();
    await refreshDashboard();
  } catch (error) {
    showError(`初始化失败：${error.message}。请先导入 MySQL 数据。`);
  }
  setInterval(refreshDashboard, 60000);
}

bootstrap();
