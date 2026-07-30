# Vercel 部署说明

这个项目已经调整为 Vercel 可直接部署的 Next.js 项目。

## 1. 推送到 GitHub

把当前项目推送到你的 GitHub 仓库。Vercel 会从 GitHub 读取代码并自动部署。

## 2. 在 Vercel 创建项目

1. 打开 https://vercel.com
2. 使用 GitHub 登录
3. 点击 `Add New...` -> `Project`
4. 选择这个项目仓库
5. Framework Preset 选择 `Next.js`
6. Build Command 使用默认的 `npm run build`
7. Install Command 使用默认的 `npm install`

## 3. 添加环境变量

在 Vercel 项目设置里打开 `Settings` -> `Environment Variables`，添加：

- `FEISHU_APP_ID`
- `FEISHU_APP_SECRET`
- `FEISHU_BITABLE_APP_TOKEN`
- `FEISHU_STATE_TABLE_ID`
- `FEISHU_REGISTRATION_TABLE_ID`
- `FEISHU_KEY_FIELD`
- `FEISHU_VALUE_FIELD`
- `LOGIN_USERNAME`
- `LOGIN_PASSWORD`
- `SESSION_SECRET`

字段名建议：

- `FEISHU_KEY_FIELD` = `key`
- `FEISHU_VALUE_FIELD` = `value`
- `FEISHU_REGISTRATION_TABLE_ID` = `tblDstWuAzWPNwYT`
- `LOGIN_USERNAME` = 你的登录账号
- `LOGIN_PASSWORD` = 你的登录密码
- `SESSION_SECRET` = 任意一串较长的随机字符，用来保护登录状态

添加环境变量后，需要重新部署一次。

## 4. 飞书报名表同步

新的飞书报名表可以继续放在同一个多维表格里。网页打开时会自动读取报名表里 `同步状态` 不是 `已同步` 的记录，导入到网页报名记录，然后自动回填：

- `同步状态` = `已同步`
- `网页记录ID` = 网页中的记录编号

报名表字段建议保持这些名字：

- `学员姓名`
- `课程类型`
- `班级水平`
- `上课教练`
- `开课日期`
- `上课时间`
- `上课周期`
- `备注`
- `同步状态`
- `网页记录ID`

飞书应用权限需要包含读取和更新多维表格记录的权限，否则网页能打开但同步不到报名表数据。

## 5. 访问方式

部署成功后，Vercel 会生成一个 `.vercel.app` 链接。用户打开这个链接后，会直接看到系统登录页，不需要先登录 ChatGPT。
