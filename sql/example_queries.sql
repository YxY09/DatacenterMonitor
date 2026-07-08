-- 数据中心运行监控大屏参考 SQL
-- 说明：ts 为 Unix 毫秒时间戳。这里用 +28800 秒固定转换为北京时间，避免 MySQL 时区不同导致结果偏移。

USE datacenter_monitor;

-- 00. 导入后行数校验
SELECT 'host_detail' AS 表名, COUNT(*) AS 实际行数, 20 AS 期望行数 FROM host_detail
UNION ALL
SELECT 'mod_detail', COUNT(*), 55 FROM mod_detail
UNION ALL
SELECT 'disk_tsar', COUNT(*), 12000 FROM disk_tsar
UNION ALL
SELECT 'pref_tsar', COUNT(*), 67200 FROM pref_tsar;

-- 01. 时间戳解析：disk_tsar 前 10 行
SELECT
  ts,
  hostid,
  `mod`,
  CAST(value AS DECIMAL(18,2)) AS value_num,
  TIMESTAMPADD(SECOND, FLOOR(ts / 1000) + 28800, '1970-01-01 00:00:00') AS event_time,
  DATE(TIMESTAMPADD(SECOND, FLOOR(ts / 1000) + 28800, '1970-01-01 00:00:00')) AS dt,
  HOUR(TIMESTAMPADD(SECOND, FLOOR(ts / 1000) + 28800, '1970-01-01 00:00:00')) AS hour,
  MINUTE(TIMESTAMPADD(SECOND, FLOOR(ts / 1000) + 28800, '1970-01-01 00:00:00')) AS minute
FROM disk_tsar
ORDER BY ts
LIMIT 10;

-- 02. pref_tsar 全主机 x 全指标 x 每小时汇总
SELECT
  dt,
  hour_num AS hour,
  hostid,
  `mod`,
  avg_value,
  max_value,
  min_value,
  sample_cnt
FROM pref_hourly_summary
ORDER BY dt, hour_num, hostid, `mod`
LIMIT 20;

-- 03. host001 的 cpu_usage 小时走势
SELECT
  dt,
  hour_num AS hour,
  avg_value,
  max_value
FROM pref_hourly_summary
WHERE hostid = 'host001'
  AND `mod` = 'cpu_usage'
  AND dt = '2026-07-01'
ORDER BY dt, hour_num;

-- 04. JOIN 主机维度和指标维度，得到可直接展示的数据
SELECT
  dt,
  hour_num AS hour,
  idc_name,
  hostname,
  metric_desc,
  unit,
  sample_cnt,
  avg_value
FROM v_pref_hourly_readable
ORDER BY dt, hour_num, idc_name, hostname, metric_desc
LIMIT 30;
