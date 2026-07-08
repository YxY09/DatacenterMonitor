const mysql = require("mysql2/promise");
const path = require("path");
require("dotenv").config({ path: path.resolve(process.cwd(), ".env") });

const DB_CONFIG = {
  host: process.env.DB_HOST || "127.0.0.1",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "123456",
  database: process.env.DB_NAME || "datacenter_monitor",
  waitForConnections: true,
  connectionLimit: 10,
  connectTimeout: 2000,
  decimalNumbers: true,
  dateStrings: true,
  charset: "utf8mb4"
};

function createPool(overrides = {}) {
  return mysql.createPool({ ...DB_CONFIG, ...overrides });
}

async function createServerConnection() {
  return mysql.createConnection({
    host: DB_CONFIG.host,
    port: DB_CONFIG.port,
    user: DB_CONFIG.user,
    password: DB_CONFIG.password,
    decimalNumbers: true,
    dateStrings: true,
    charset: "utf8mb4",
    multipleStatements: true
  });
}

module.exports = {
  DB_CONFIG,
  createPool,
  createServerConnection
};
