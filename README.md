# Public-WM

一个给国内访问 warframe.market 完全受阻、验证缓慢、或严重卡顿的朋友们准备的特殊版WM。

本站大量使用了边缘函数作为加速访问的途径：登录、订单、均价、拍卖、在线状态等基本功能。

# 特此声明

根据WM API的使用文档，出于个人学习的目的，此Github仓库（Public-WM）可以存在，但为遵守有关条款，如WM官方完全解决了中国大陆的可用性问题之后，此子域名（即作为公开发布本项目的域名Market.wfspeed.run）将立即关闭登录权限。

从至少半年之前，一直到目前为止，大量中国大陆用户，仍然难以顺畅访问 warframe.market ，其中不乏常年赞助者、以及多年以来的忠实用户群体。在 warframe.market 完全解决大陆用户的访问问题后，我们才会关停Market.wfspeed.run的公开登录权限；届时，各位可以（出于个人学习的目的）自行部署本项目。

## 本项目基本功能

- 订单：看/改/删出售和求购订单，筛选、排序、搜索都有
- 均价：物品均价 + 按倍率算目标价，稀缺/价格警报一眼看出
- 拍卖：裂罅 Mod / 玄骸 / 姐妹 的搜索、我的拍卖、上架、下架、改价
- 在线状态：设 online / ingame / invisible，可选定时维持

## 登录

用自己的 Warframe.market 账号密码登录（或贴 JWT）。登录信息只用来验证，不存服务器。
目前中国大陆用户大概率只能使用JWT方式登录，但只要你不主动在WM网站里登出，这个JWT可以维持很长的有效期。

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
