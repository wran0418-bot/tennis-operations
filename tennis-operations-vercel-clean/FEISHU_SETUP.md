# 飞书多维表格云同步配置

当前实现使用一张飞书多维表格保存整份应用状态。这样结构稳定，适合先实现电脑和手机访问同一份数据。

## 需要创建的飞书多维表格

创建一张数据表，例如：`app_state`

字段：

- `key`：文本
- `value`：多行文本

字段名可以自定义；如果自定义，需要同步配置环境变量 `FEISHU_KEY_FIELD` 和 `FEISHU_VALUE_FIELD`。

## 需要的 Sites 环境变量

- `FEISHU_APP_ID`
- `FEISHU_APP_SECRET`
- `FEISHU_BITABLE_APP_TOKEN`
- `FEISHU_STATE_TABLE_ID`
- `FEISHU_KEY_FIELD`，可选，默认 `key`
- `FEISHU_VALUE_FIELD`，可选，默认 `value`

## 飞书权限

飞书开放平台自建应用需要开通多维表格读写权限，并将应用添加到对应多维表格。

## 同步规则

- 页面打开时优先从飞书读取数据。
- 飞书没有数据时，使用内置初始数据，并自动写入飞书。
- 每次新增、修改、删除、批量取消后，会写回飞书。
- 如果飞书未配置或临时不可用，页面继续使用浏览器本地存储。
