# VSCode OKX Tradingview

一个在 VSCode 状态栏显示 OKX 交易所加密货币实时价格的插件。

## 功能特点

- 实时显示 OKX 交易所的加密货币价格
- 支持多个交易对同时监控
- 提供两种显示模式：横向排列和轮播展示
- 点击状态栏可立即刷新所有价格
- 自动断线重连机制
- 支持自定义配置

## 安装方法

### ~~从 VSCode 插件市场安装~~
1. ~~打开 VSCode~~
2. ~~点击左侧扩展按钮或按 `Ctrl+Shift+X`~~
3. ~~搜索 "OKX Tradingview"~~
4. ~~点击安装~~

### 手动安装
1. 下载本项目的 `.vsix` 文件
2. 在 VSCode 中，点击左侧扩展按钮
3. 点击右上角的更多选项（...）
4. 选择"从 VSIX 安装..."
5. 选择下载的 .vsix 文件

## 配置说明

在 VSCode 的 settings.json 中添加以下配置：

```json
{
    "okxTradingview.pairs": ["BTC-USDT-SWAP", "ETH-USDT-SWAP"],  // 要监控的交易对
    "okxTradingview.displayMode": "row",                // 显示模式：row（横向排列）或 carousel（轮播）
    "okxTradingview.carouselInterval": 5000             // 轮播间隔时间（毫秒）
}
```

### 配置项说明

1. `okxTradingview.pairs`
   - 类型：字符串数组
   - 默认值：`["BTC-USDT-SWAP", "ETH-USDT-SWAP"]`
   - 说明：需要监控的交易对列表
   - 示例：`["BTC-USDT-SWAP", "ETH-USDT", "DOT-USDT"]`

2. `okxTradingview.displayMode`
   - 类型：字符串
   - 可选值：`"row"` 或 `"carousel"`
   - 默认值：`"row"`
   - 说明：
     - `row`: 所有交易对在状态栏横向排列
     - `carousel`: 在单个位置轮流显示不同交易对

3. `okxTradingview.carouselInterval`
   - 类型：数字
   - 默认值：5000
   - 单位：毫秒
   - 说明：轮播模式下切换交易对的时间间隔

## 使用说明

1. 安装插件后，会在 VSCode 底部状态栏显示配置的交易对价格
2. 价格会通过 WebSocket 实时更新
3. 点击状态栏上的任意交易对可以手动刷新所有价格
4. 当 WebSocket 连接断开时，插件会自动尝试重连

## 使用方法

1. 安装插件后，VSCode 状态栏右侧会显示一个 "OKX" 按钮
2. 点击按钮启动价格监控
   - 启动后会显示配置的交易对实时价格
   - 按钮图标会变成停止图标
3. 再次点击按钮可以停止监控
   - 停止后所有价格显示会消失
   - 按钮图标会变回播放图标

每个 VSCode 窗口都可以独立控制是否开启监控，互不影响。

## 常见问题

1. **看不到价格显示**
   - 检查网络连接
   - 确认配置的交易对是否正确
   - 重启 VSCode

2. **价格更新不及时**
   - 检查网络连接质量
   - 确认是否有防火墙阻止 WebSocket 连接

3. **状态栏显示异常**
   - 尝试切换显示模式
   - 重新加载窗口（Command Palette 中执行 "Reload Window"）

## 更新日志

### 0.0.1
- 初始版本发布
- 支持实时价格显示
- 支持多交易对监控
- 支持横向排列和轮播两种显示模式

## 贡献指南

欢迎提交 Issue 和 Pull Request 来帮助改进这个项目。

1. Fork 本仓库
2. 创建新的特性分支
3. 提交你的更改
4. 提交 Pull Request

## 许可证

MIT License

## 联系方式

如有问题或建议，请通过以下方式联系：
- 在 GitHub 上提交 Issue
- [项目地址](https://github.com/ocean2811/vscode-okx-tradingview)

## 致谢

- OKX API 提供数据支持
- VSCode Extension API 提供扩展能力

## 免责声明

本插件显示的价格数据仅供参考，交易决策请以交易所实际显示为准。作者不对因使用本插件造成的任何损失负责。