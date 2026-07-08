const fs = require("fs");
const path = require("path");
const { DB_CONFIG, createServerConnection, createPool } = require("../src/db");

const ROOT = path.resolve(__dirname, "..");
const DATA_FILES = {
  host_detail: "host_detail.dat",
  mod_detail: "mod_detail.dat",
  disk_tsar: "disk_tsar.dat",
  pref_tsar: "pref_tsar.dat"
};

const EXPECTED_ROWS = {
  host_detail: 20,
  mod_detail: 55,
  disk_tsar: 12000,
  pref_tsar: 67200
};

function resolveDataFile(fileName) {
  const candidates = [
    path.join(ROOT, "data", fileName),
    path.join(ROOT, fileName)
  ];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) {
    throw new Error(`找不到数据文件：${fileName}`);
  }
  return found;
}

function readTsv(fileName) {
  const filePath = resolveDataFile(fileName);
  const raw = fs.readFileSync(filePath, "utf8").trim();
  const [headerLine, ...lines] = raw.split(/\r?\n/);
  const headers = headerLine.split("\t");
  return lines
    .filter(Boolean)
    .map((line) => {
      const values = line.split("\t");
      return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
    });
}

async function createDatabase() {
  const connection = await createServerConnection();
  try {
    await connection.query(
      `CREATE DATABASE IF NOT EXISTS \`${DB_CONFIG.database}\`
       CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`
    );
  } finally {
    await connection.end();
  }
}

async function recreateSchema(pool) {
  const statements = [
    "DROP VIEW IF EXISTS v_pref_hourly_readable",
    "DROP VIEW IF EXISTS v_disk_hourly_readable",
    "DROP TABLE IF EXISTS pref_hourly_summary",
    "DROP TABLE IF EXISTS disk_hourly_summary",
    "DROP TABLE IF EXISTS pref_tsar",
    "DROP TABLE IF EXISTS disk_tsar",
    "DROP TABLE IF EXISTS mod_detail",
    "DROP TABLE IF EXISTS host_detail",
    `CREATE TABLE host_detail (
      hostid VARCHAR(32) PRIMARY KEY,
      hostname VARCHAR(128) NOT NULL,
      owner VARCHAR(64) NOT NULL,
      model VARCHAR(64) NOT NULL,
      location1 VARCHAR(64) NOT NULL,
      location2 VARCHAR(64) NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE mod_detail (
      \`mod\` VARCHAR(64) NOT NULL,
      type VARCHAR(32) NOT NULL,
      \`desc\` VARCHAR(128) NOT NULL,
      unit VARCHAR(32) NULL,
      tag VARCHAR(64) NOT NULL,
      PRIMARY KEY (type, \`mod\`, tag),
      KEY idx_mod_detail_mod (\`mod\`),
      KEY idx_mod_detail_tag (tag)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE disk_tsar (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      ts BIGINT NOT NULL,
      hostid VARCHAR(32) NOT NULL,
      type VARCHAR(32) NOT NULL,
      \`mod\` VARCHAR(64) NOT NULL,
      value DECIMAL(18,2) NOT NULL,
      tag VARCHAR(64) NOT NULL,
      KEY idx_disk_ts (ts),
      KEY idx_disk_host_ts (hostid, ts),
      KEY idx_disk_metric (type, \`mod\`, tag),
      CONSTRAINT fk_disk_host FOREIGN KEY (hostid) REFERENCES host_detail(hostid),
      CONSTRAINT fk_disk_metric FOREIGN KEY (type, \`mod\`, tag) REFERENCES mod_detail(type, \`mod\`, tag)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE pref_tsar (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      ts BIGINT NOT NULL,
      hostid VARCHAR(32) NOT NULL,
      type VARCHAR(32) NOT NULL,
      \`mod\` VARCHAR(64) NOT NULL,
      value DECIMAL(18,2) NOT NULL,
      tag VARCHAR(64) NOT NULL,
      KEY idx_pref_ts (ts),
      KEY idx_pref_host_ts (hostid, ts),
      KEY idx_pref_metric (type, \`mod\`, tag),
      CONSTRAINT fk_pref_host FOREIGN KEY (hostid) REFERENCES host_detail(hostid),
      CONSTRAINT fk_pref_metric FOREIGN KEY (type, \`mod\`, tag) REFERENCES mod_detail(type, \`mod\`, tag)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  ];

  for (const statement of statements) {
    await pool.query(statement);
  }
}

async function insertRows(pool, table, columns, rows, mapper) {
  const batchSize = 1000;
  const placeholders = `(${columns.map(() => "?").join(",")})`;
  const sql = `INSERT INTO ${table} (${columns.map((column) => `\`${column}\``).join(",")}) VALUES `;
  for (let start = 0; start < rows.length; start += batchSize) {
    const batch = rows.slice(start, start + batchSize);
    const values = [];
    const valueSql = batch
      .map((row) => {
        values.push(...mapper(row));
        return placeholders;
      })
      .join(",");
    await pool.query(sql + valueSql, values);
  }
}

function eventTimeExpr(alias) {
  return `TIMESTAMPADD(SECOND, FLOOR(${alias}.ts / 1000) + 28800, '1970-01-01 00:00:00')`;
}

function hourExpr(alias) {
  const eventTime = eventTimeExpr(alias);
  return `STR_TO_DATE(DATE_FORMAT(${eventTime}, '%Y-%m-%d %H:00:00'), '%Y-%m-%d %H:%i:%s')`;
}

async function createSummaryTables(pool) {
  await pool.query(`
    CREATE TABLE pref_hourly_summary AS
    SELECT
      DATE(${eventTimeExpr("p")}) AS dt,
      HOUR(${eventTimeExpr("p")}) AS hour_num,
      ${hourExpr("p")} AS event_hour,
      p.hostid,
      p.type,
      p.\`mod\`,
      p.tag,
      ROUND(AVG(p.value), 2) AS avg_value,
      ROUND(MAX(p.value), 2) AS max_value,
      ROUND(MIN(p.value), 2) AS min_value,
      COUNT(*) AS sample_cnt
    FROM pref_tsar p
    GROUP BY dt, hour_num, event_hour, p.hostid, p.type, p.\`mod\`, p.tag
  `);
  await pool.query("ALTER TABLE pref_hourly_summary ADD INDEX idx_pref_hour (event_hour)");
  await pool.query("ALTER TABLE pref_hourly_summary ADD INDEX idx_pref_hour_host (hostid, event_hour)");
  await pool.query("ALTER TABLE pref_hourly_summary ADD INDEX idx_pref_hour_metric (`mod`, event_hour)");

  await pool.query(`
    CREATE TABLE disk_hourly_summary AS
    SELECT
      DATE(${eventTimeExpr("d")}) AS dt,
      HOUR(${eventTimeExpr("d")}) AS hour_num,
      ${hourExpr("d")} AS event_hour,
      d.hostid,
      d.type,
      d.\`mod\`,
      d.tag,
      ROUND(AVG(d.value), 2) AS avg_value,
      ROUND(MAX(d.value), 2) AS max_value,
      ROUND(MIN(d.value), 2) AS min_value,
      COUNT(*) AS sample_cnt,
      COUNT(DISTINCT DATE_FORMAT(${eventTimeExpr("d")}, '%Y-%m-%d %H:%i')) AS minute_sample_cnt
    FROM disk_tsar d
    GROUP BY dt, hour_num, event_hour, d.hostid, d.type, d.\`mod\`, d.tag
  `);
  await pool.query("ALTER TABLE disk_hourly_summary ADD INDEX idx_disk_hour (event_hour)");
  await pool.query("ALTER TABLE disk_hourly_summary ADD INDEX idx_disk_hour_host (hostid, event_hour)");
  await pool.query("ALTER TABLE disk_hourly_summary ADD INDEX idx_disk_hour_metric (`mod`, event_hour)");

  await pool.query(`
    CREATE VIEW v_pref_hourly_readable AS
    SELECT
      s.dt,
      s.hour_num,
      s.event_hour,
      h.location1 AS idc_name,
      h.location2 AS rack_name,
      h.hostname,
      h.owner,
      h.model,
      s.hostid,
      s.\`mod\`,
      m.\`desc\` AS metric_desc,
      COALESCE(m.unit, '') AS unit,
      s.tag,
      s.avg_value,
      s.max_value,
      s.min_value,
      s.sample_cnt
    FROM pref_hourly_summary s
    LEFT JOIN host_detail h ON s.hostid = h.hostid
    LEFT JOIN mod_detail m ON s.type = m.type AND s.\`mod\` = m.\`mod\` AND s.tag = m.tag
  `);

  await pool.query(`
    CREATE VIEW v_disk_hourly_readable AS
    SELECT
      s.dt,
      s.hour_num,
      s.event_hour,
      h.location1 AS idc_name,
      h.location2 AS rack_name,
      h.hostname,
      h.owner,
      h.model,
      s.hostid,
      s.\`mod\`,
      m.\`desc\` AS metric_desc,
      COALESCE(m.unit, '') AS unit,
      s.tag,
      s.avg_value,
      s.max_value,
      s.min_value,
      s.sample_cnt,
      s.minute_sample_cnt
    FROM disk_hourly_summary s
    LEFT JOIN host_detail h ON s.hostid = h.hostid
    LEFT JOIN mod_detail m ON s.type = m.type AND s.\`mod\` = m.\`mod\` AND s.tag = m.tag
  `);
}

async function importData(pool) {
  const hostRows = readTsv(DATA_FILES.host_detail);
  const modRows = readTsv(DATA_FILES.mod_detail);
  const diskRows = readTsv(DATA_FILES.disk_tsar);
  const prefRows = readTsv(DATA_FILES.pref_tsar);

  await insertRows(
    pool,
    "host_detail",
    ["hostid", "hostname", "owner", "model", "location1", "location2"],
    hostRows,
    (row) => [row.hostid, row.hostname, row.owner, row.model, row.location1, row.location2]
  );
  console.log(`导入 host_detail: ${hostRows.length}`);

  await insertRows(
    pool,
    "mod_detail",
    ["mod", "type", "desc", "unit", "tag"],
    modRows,
    (row) => [row.mod, row.type, row.desc, row.unit || null, row.tag]
  );
  console.log(`导入 mod_detail: ${modRows.length}`);

  await insertRows(
    pool,
    "disk_tsar",
    ["ts", "hostid", "type", "mod", "value", "tag"],
    diskRows,
    (row) => [Number(row.ts), row.hostid, row.type, row.mod, Number(row.value), row.tag]
  );
  console.log(`导入 disk_tsar: ${diskRows.length}`);

  await insertRows(
    pool,
    "pref_tsar",
    ["ts", "hostid", "type", "mod", "value", "tag"],
    prefRows,
    (row) => [Number(row.ts), row.hostid, row.type, row.mod, Number(row.value), row.tag]
  );
  console.log(`导入 pref_tsar: ${prefRows.length}`);
}

async function printValidation(pool) {
  const [rows] = await pool.query(`
    SELECT 'host_detail' AS table_name, COUNT(*) AS actual_rows, ? AS expected_rows FROM host_detail
    UNION ALL
    SELECT 'mod_detail', COUNT(*), ? FROM mod_detail
    UNION ALL
    SELECT 'disk_tsar', COUNT(*), ? FROM disk_tsar
    UNION ALL
    SELECT 'pref_tsar', COUNT(*), ? FROM pref_tsar
  `, [EXPECTED_ROWS.host_detail, EXPECTED_ROWS.mod_detail, EXPECTED_ROWS.disk_tsar, EXPECTED_ROWS.pref_tsar]);

  console.log("\n行数校验：");
  for (const row of rows) {
    const ok = Number(row.actual_rows) === Number(row.expected_rows) ? "OK" : "FAIL";
    console.log(`${row.table_name.padEnd(14)} 实际=${row.actual_rows} 期望=${row.expected_rows}  ${ok}`);
  }

  const [summaryRows] = await pool.query(`
    SELECT 'pref_hourly_summary' AS table_name, COUNT(*) AS rows_count FROM pref_hourly_summary
    UNION ALL
    SELECT 'disk_hourly_summary', COUNT(*) FROM disk_hourly_summary
  `);
  console.log("\n汇总表：");
  for (const row of summaryRows) {
    console.log(`${row.table_name.padEnd(22)} ${row.rows_count}`);
  }
}

async function main() {
  await createDatabase();
  const pool = createPool({ multipleStatements: true });
  try {
    console.log(`连接 MySQL: ${DB_CONFIG.host}:${DB_CONFIG.port}/${DB_CONFIG.database}`);
    await recreateSchema(pool);
    await importData(pool);
    await createSummaryTables(pool);
    await printValidation(pool);
    console.log("\n完成：四张明细表和两个小时汇总表已写入 MySQL。");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("\n导入失败：", error.message);
  console.error("请确认 MySQL 已启动，账号密码与 .env 配置一致。");
  process.exitCode = 1;
});
