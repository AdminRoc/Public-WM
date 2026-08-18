# Public-WM

一个给国内访问 warframe.market 太慢的朋友准备的交易辅助工具（公版）。

WM 主站和它的接口在国内直连都比较吃力，这项目把常用的东西搬到了国内能直连的边缘上：登录、订单、均价、拍卖、在线状态，点开就能用，不用绕路。

## 能干嘛

- 订单：看/改/删出售和求购订单，筛选、排序、搜索都有
- 均价：物品均价 + 按倍率算目标价，稀缺/价格警报一眼看出
- 拍卖：裂罅 Mod / 玄骸 / 姐妹 的搜索、我的拍卖、上架、下架、改价
- 在线状态：设 online / ingame / invisible，可选定时维持

## 登录

用自己的 Warframe.market 账号密码登录（或贴 JWT）。登录信息只用来验证，不存服务器。

## 技术栈

- 前端：纯静态 HTML/JS/CSS，托管在 EdgeOne Pages
- 后端：边缘函数（Cloudflare Workers / 腾讯 EdgeOne 都能跑），只处理 /api/*
- 数据：均价/物品表/拍卖字典走 jsDelivr + EdgeOne KV，国内可直连

## 部署

1. 推到 EdgeOne Pages（或任意静态托管），根目录直接部署
2. `src/worker.js` 作为边缘函数，绑到 `/api/*`
3. 数据产物由 `.github/workflows/` 的定时任务自动生成（均价、物品表、拍卖字典）

## 说明

- 非官方工具，和 Digital Extremes / Warframe 官方没关系
- 数据来自 warframe.market 公开接口
