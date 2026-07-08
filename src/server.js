const compression = require("compression");
const express = require("express");
const path = require("path");
const { createPool, DB_CONFIG } = require("./db");

const app = express();
const pool = createPool();
const PORT = Number(process.env.PORT || 3000);

app.use(compression());
app.use(express.json());
app.use(express.static(path.resolve(__dirname, "../public")));

app.get("/vendor/echarts.min.js", (_req, res) => {
  res.sendFile(require.resolve("echarts/dist/echarts.min.js"));
});

async function query(sql, params = []) {
  const [rows] = await pool.query(sql, params);
  return rows;
}

function numberOrDefault(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function roomFilterSql(room, alias = "h") {
  if (!room || room === "all") return { clause: "", params: [] };
  return { clause: ` AND ${alias}.location1 = ?`, params: [room] };
}

app.get("/api/health", async (_req, res) => {
  try {
    const rows = await query("SELECT 1 AS ok");
    res.json({ ok: rows[0].ok === 1, database: DB_CONFIG.database });
  } catch (error) {
    res.status(500).json({ ok: false, message: error.message });
  }
});

app.get("/api/options", async (_req, res) => {
  try {
    const [hosts, rooms, metrics] = await Promise.all([
      query("SELECT hostid, hostname, location1, model FROM host_detail ORDER BY hostid"),
      query("SELECT location1 AS room, COUNT(*) AS host_count FROM host_detail GROUP BY location1 ORDER BY location1"),
      query("SELECT type, `mod`, `desc` AS metric_desc, COALESCE(unit, '') AS unit, tag FROM mod_detail ORDER BY type, tag, `mod`")
    ]);
    res.json({ hosts, rooms, metrics });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.get("/api/overview", async (req, res) => {
  const { room = "all" } = req.query;
  const filter = roomFilterSql(room);
  try {
    const [overview] = await query(`
      SELECT
        (SELECT COUNT(*) FROM host_detail h WHERE 1=1 ${filter.clause}) AS host_count,
        (SELECT COUNT(DISTINCT location1) FROM host_detail) AS room_count,
        (SELECT COUNT(*) FROM mod_detail) AS metric_count,
        (SELECT COUNT(*) FROM pref_hourly_summary) AS pref_summary_rows,
        (SELECT COUNT(*) FROM disk_hourly_summary) AS disk_summary_rows,
        (SELECT DATE_FORMAT(MAX(event_hour), '%Y-%m-%d %H:%i') FROM pref_hourly_summary) AS latest_pref_hour,
        (SELECT DATE_FORMAT(MAX(event_hour), '%Y-%m-%d %H:%i') FROM disk_hourly_summary) AS latest_disk_hour
    `, filter.params);

    const [prefStats] = await query(`
      WITH latest AS (SELECT MAX(event_hour) AS max_hour FROM pref_hourly_summary)
      SELECT
        ROUND(AVG(CASE WHEN p.\`mod\` = 'cpu_usage' THEN p.avg_value END), 2) AS avg_cpu_usage,
        ROUND(AVG(CASE WHEN p.\`mod\` = 'cpu_wait' THEN p.avg_value END), 2) AS avg_cpu_wait,
        ROUND(AVG(CASE WHEN p.\`mod\` = 'mem_used' THEN p.avg_value END), 2) AS avg_mem_used,
        ROUND(AVG(CASE WHEN p.\`mod\` = 'net_in' THEN p.avg_value END), 2) AS avg_net_in,
        ROUND(AVG(CASE WHEN p.\`mod\` = 'net_out' THEN p.avg_value END), 2) AS avg_net_out
      FROM pref_hourly_summary p
      JOIN host_detail h ON p.hostid = h.hostid
      JOIN latest l ON p.event_hour >= DATE_SUB(l.max_hour, INTERVAL 24 HOUR)
      WHERE p.\`mod\` IN ('cpu_usage', 'cpu_wait', 'mem_used', 'net_in', 'net_out') ${filter.clause}
    `, filter.params);

    const [diskStats] = await query(`
      WITH latest AS (SELECT MAX(event_hour) AS max_hour FROM disk_hourly_summary)
      SELECT
        ROUND(AVG(CASE WHEN d.tag = 'disk_latency_ms' THEN d.avg_value END), 2) AS avg_disk_latency,
        ROUND(MAX(CASE WHEN d.tag = 'disk_util_percent' THEN d.max_value END), 2) AS max_disk_util
      FROM disk_hourly_summary d
      JOIN host_detail h ON d.hostid = h.hostid
      JOIN latest l ON d.event_hour >= DATE_SUB(l.max_hour, INTERVAL 24 HOUR)
      WHERE d.tag IN ('disk_latency_ms', 'disk_util_percent') ${filter.clause}
    `, filter.params);

    const [alertCount] = await query(`
      SELECT COUNT(*) AS alert_count FROM (
        SELECT p.hostid
        FROM pref_hourly_summary p
        JOIN host_detail h ON p.hostid = h.hostid
        WHERE ((p.\`mod\` = 'cpu_usage' AND p.max_value >= 75)
          OR (p.\`mod\` = 'cpu_wait' AND p.max_value >= 30)
          OR (p.\`mod\` = 'mem_used' AND p.max_value >= 110000)) ${filter.clause}
        UNION ALL
        SELECT d.hostid
        FROM disk_hourly_summary d
        JOIN host_detail h ON d.hostid = h.hostid
        WHERE ((d.tag = 'disk_latency_ms' AND d.max_value >= 25)
          OR (d.tag = 'disk_util_percent' AND d.max_value >= 90)) ${filter.clause}
      ) x
    `, [...filter.params, ...filter.params]);

    res.json({ ...overview, ...prefStats, ...diskStats, ...alertCount });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.get("/api/trends", async (req, res) => {
  const hours = Math.min(numberOrDefault(req.query.hours, 168), 1000);
  const { room = "all" } = req.query;
  const filter = roomFilterSql(room);
  try {
    const rows = await query(`
      WITH latest AS (SELECT MAX(event_hour) AS max_hour FROM pref_hourly_summary)
      SELECT
        DATE_FORMAT(p.event_hour, '%Y-%m-%d %H:%i') AS event_hour,
        ROUND(AVG(CASE WHEN p.\`mod\` = 'cpu_usage' THEN p.avg_value END), 2) AS cpu_usage,
        ROUND(AVG(CASE WHEN p.\`mod\` = 'cpu_wait' THEN p.avg_value END), 2) AS cpu_wait,
        ROUND(AVG(CASE WHEN p.\`mod\` = 'mem_used' THEN p.avg_value END), 2) AS mem_used,
        ROUND(AVG(CASE WHEN p.\`mod\` = 'net_in' THEN p.avg_value END), 2) AS net_in,
        ROUND(AVG(CASE WHEN p.\`mod\` = 'net_out' THEN p.avg_value END), 2) AS net_out
      FROM pref_hourly_summary p
      JOIN host_detail h ON p.hostid = h.hostid
      JOIN latest l ON p.event_hour >= DATE_SUB(l.max_hour, INTERVAL ? HOUR)
      WHERE p.\`mod\` IN ('cpu_usage', 'cpu_wait', 'mem_used', 'net_in', 'net_out') ${filter.clause}
      GROUP BY p.event_hour
      ORDER BY p.event_hour
    `, [hours, ...filter.params]);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.get("/api/disk-trends", async (req, res) => {
  const hours = Math.min(numberOrDefault(req.query.hours, 240), 1000);
  const { room = "all" } = req.query;
  const filter = roomFilterSql(room);
  try {
    const rows = await query(`
      WITH latest AS (SELECT MAX(event_hour) AS max_hour FROM disk_hourly_summary)
      SELECT
        DATE_FORMAT(d.event_hour, '%Y-%m-%d %H:%i') AS event_hour,
        ROUND(AVG(CASE WHEN d.tag = 'disk_latency_ms' THEN d.avg_value END), 2) AS disk_latency,
        ROUND(MAX(CASE WHEN d.tag = 'disk_util_percent' THEN d.max_value END), 2) AS disk_util,
        ROUND(AVG(CASE WHEN d.tag = 'disk_rw_sectors' THEN d.avg_value END), 2) AS disk_rw
      FROM disk_hourly_summary d
      JOIN host_detail h ON d.hostid = h.hostid
      JOIN latest l ON d.event_hour >= DATE_SUB(l.max_hour, INTERVAL ? HOUR)
      WHERE d.tag IN ('disk_latency_ms', 'disk_util_percent', 'disk_rw_sectors') ${filter.clause}
      GROUP BY d.event_hour
      ORDER BY d.event_hour
    `, [hours, ...filter.params]);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.get("/api/rooms", async (_req, res) => {
  try {
    const rows = await query(`
      WITH latest AS (SELECT MAX(event_hour) AS max_hour FROM pref_hourly_summary)
      SELECT
        h.location1 AS room,
        COUNT(DISTINCT h.hostid) AS host_count,
        ROUND(AVG(CASE WHEN p.\`mod\` = 'cpu_usage' THEN p.avg_value END), 2) AS cpu_usage,
        ROUND(AVG(CASE WHEN p.\`mod\` = 'cpu_wait' THEN p.avg_value END), 2) AS cpu_wait,
        ROUND(AVG(CASE WHEN p.\`mod\` = 'mem_used' THEN p.avg_value END), 2) AS mem_used,
        ROUND(AVG(CASE WHEN p.\`mod\` = 'net_in' THEN p.avg_value END), 2) AS net_in
      FROM host_detail h
      LEFT JOIN pref_hourly_summary p ON h.hostid = p.hostid
      JOIN latest l ON p.event_hour >= DATE_SUB(l.max_hour, INTERVAL 24 HOUR)
      WHERE p.\`mod\` IN ('cpu_usage', 'cpu_wait', 'mem_used', 'net_in')
      GROUP BY h.location1
      ORDER BY h.location1
    `);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.get("/api/top-hosts", async (req, res) => {
  const limit = Math.min(numberOrDefault(req.query.limit, 10), 20);
  const { room = "all" } = req.query;
  const filter = roomFilterSql(room);
  try {
    const rows = await query(`
      WITH latest AS (SELECT MAX(event_hour) AS max_hour FROM pref_hourly_summary)
      SELECT
        h.hostid,
        h.hostname,
        h.location1 AS room,
        h.model,
        ROUND(AVG(CASE WHEN p.\`mod\` = 'cpu_usage' THEN p.avg_value END), 2) AS cpu_usage,
        ROUND(AVG(CASE WHEN p.\`mod\` = 'cpu_wait' THEN p.avg_value END), 2) AS cpu_wait,
        ROUND(AVG(CASE WHEN p.\`mod\` = 'mem_used' THEN p.avg_value END), 2) AS mem_used,
        ROUND(AVG(CASE WHEN p.\`mod\` = 'load1' THEN p.avg_value END), 2) AS load1
      FROM pref_hourly_summary p
      JOIN host_detail h ON p.hostid = h.hostid
      JOIN latest l ON p.event_hour >= DATE_SUB(l.max_hour, INTERVAL 24 HOUR)
      WHERE p.\`mod\` IN ('cpu_usage', 'cpu_wait', 'mem_used', 'load1') ${filter.clause}
      GROUP BY h.hostid, h.hostname, h.location1, h.model
      ORDER BY cpu_usage DESC
      LIMIT ?
    `, [...filter.params, limit]);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.get("/api/alerts", async (req, res) => {
  const limit = Math.min(numberOrDefault(req.query.limit, 30), 100);
  const { room = "all" } = req.query;
  const filter = roomFilterSql(room);
  try {
    const rows = await query(`
      SELECT * FROM (
        SELECT
          DATE_FORMAT(p.event_hour, '%Y-%m-%d %H:%i') AS event_hour,
          h.location1 AS room,
          h.hostname,
          m.\`desc\` AS metric_desc,
          COALESCE(m.unit, '') AS unit,
          p.max_value AS value,
          CASE
            WHEN p.\`mod\` = 'cpu_usage' THEN 'CPU使用率偏高'
            WHEN p.\`mod\` = 'cpu_wait' THEN 'IO等待偏高'
            WHEN p.\`mod\` = 'mem_used' THEN '内存使用偏高'
            ELSE '性能指标偏高'
          END AS reason
        FROM pref_hourly_summary p
        JOIN host_detail h ON p.hostid = h.hostid
        JOIN mod_detail m ON p.type = m.type AND p.\`mod\` = m.\`mod\` AND p.tag = m.tag
        WHERE ((p.\`mod\` = 'cpu_usage' AND p.max_value >= 75)
          OR (p.\`mod\` = 'cpu_wait' AND p.max_value >= 30)
          OR (p.\`mod\` = 'mem_used' AND p.max_value >= 110000)) ${filter.clause}
        UNION ALL
        SELECT
          DATE_FORMAT(d.event_hour, '%Y-%m-%d %H:%i') AS event_hour,
          h.location1 AS room,
          h.hostname,
          m.\`desc\` AS metric_desc,
          COALESCE(m.unit, '') AS unit,
          d.max_value AS value,
          CASE
            WHEN d.tag = 'disk_latency_ms' THEN '磁盘延迟偏高'
            WHEN d.tag = 'disk_util_percent' THEN '磁盘利用率偏高'
            ELSE '磁盘指标偏高'
          END AS reason
        FROM disk_hourly_summary d
        JOIN host_detail h ON d.hostid = h.hostid
        JOIN mod_detail m ON d.type = m.type AND d.\`mod\` = m.\`mod\` AND d.tag = m.tag
        WHERE ((d.tag = 'disk_latency_ms' AND d.max_value >= 25)
          OR (d.tag = 'disk_util_percent' AND d.max_value >= 90)) ${filter.clause}
      ) alerts
      ORDER BY event_hour DESC, value DESC
      LIMIT ?
    `, [...filter.params, ...filter.params, limit]);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.get("/api/latest-metrics", async (req, res) => {
  const limit = Math.min(numberOrDefault(req.query.limit, 80), 200);
  const { room = "all" } = req.query;
  const filter = roomFilterSql(room);
  try {
    const rows = await query(`
      WITH latest AS (SELECT MAX(event_hour) AS max_hour FROM pref_hourly_summary)
      SELECT
        DATE_FORMAT(p.event_hour, '%Y-%m-%d %H:%i') AS event_hour,
        h.location1 AS room,
        h.hostname,
        p.\`mod\`,
        m.\`desc\` AS metric_desc,
        COALESCE(m.unit, '') AS unit,
        p.avg_value
      FROM pref_hourly_summary p
      JOIN latest l ON p.event_hour = l.max_hour
      JOIN host_detail h ON p.hostid = h.hostid
      JOIN mod_detail m ON p.type = m.type AND p.\`mod\` = m.\`mod\` AND p.tag = m.tag
      WHERE 1=1 ${filter.clause}
      ORDER BY h.location1, h.hostname, p.\`mod\`
      LIMIT ?
    `, [...filter.params, limit]);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.use((_req, res) => {
  res.sendFile(path.resolve(__dirname, "../public/index.html"));
});

app.listen(PORT, () => {
  console.log(`数据中心运行监控大屏已启动：http://localhost:${PORT}`);
});
