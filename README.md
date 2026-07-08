# 数据中心运行监控大屏

这个项目对应“大数据专题作业2”。四张 `.dat` 明细数据会先导入 MySQL，再生成小时汇总表，最后通过 Web 大屏展示数据中心运行情况。

## 作业要求对应关系

- 数据入库：`scripts/import-data.js` 创建 MySQL 表并导入 `disk_tsar.dat`、`pref_tsar.dat`、`host_detail.dat`、`mod_detail.dat`
- 加工处理：导入后生成 `pref_hourly_summary`、`disk_hourly_summary` 两张小时汇总表
- 可视化大屏：`public/index.html` + `public/app.js` + `public/styles.css`
- 后端接口：`src/server.js`
- MySQL 环境：可使用本机 MySQL，也可使用 `docker-compose.yml`

## 快速运行

1. 安装依赖

```bash
npm install
```

2. 准备 MySQL

如果本机没有 MySQL，可以先启动 Docker Desktop，再执行：

```bash
npm run db:up
```

这个命令已经显式指定 Docker Compose 项目名，避免中文目录下出现 `project name must not be empty`。

如果本机已经有 MySQL，可以复制 `.env.example` 为 `.env`，按自己的账号密码修改。

3. 导入数据并生成汇总表

```bash
npm run db:import
```

导入后会校验行数：

- `host_detail`：20 行
- `mod_detail`：55 行
- `disk_tsar`：12000 行
- `pref_tsar`：67200 行

4. 启动大屏

```bash
npm run dev
```

浏览器打开：

```text
http://localhost:3000
```

## 大屏内容

- 顶部指标：主机数、机房数、指标数、异常记录数、最新采样时间
- 趋势图：CPU 使用率、CPU 等待、内存使用、网络出入站
- 磁盘图：磁盘延迟、磁盘利用率、读写扇区指标
- 机房对比：按机房统计 CPU、内存、网络和主机数量
- 主机排行：最近 24 小时 CPU 使用率较高的主机
- 异常表：CPU、内存、磁盘等超过阈值的记录

## 数据说明

四张表的关系如下：

- `disk_tsar.hostid`、`pref_tsar.hostid` 关联 `host_detail.hostid`
- `disk_tsar(type, mod, tag)`、`pref_tsar(type, mod, tag)` 关联 `mod_detail(type, mod, tag)`
- `ts` 是 Unix 毫秒时间戳，项目中统一转换为北京时间后再按小时汇总

## Git 提交

本地提交：

```bash
git init
git add .
git commit -m "实现数据中心运行监控大屏"
```

如果要提交到 GitHub 或 Gitee，创建远程仓库后再执行：

```bash
git remote add origin <你的仓库地址>
git push -u origin main
```
