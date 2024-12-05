import * as vscode from 'vscode';
import axios from 'axios';
import WebSocket from 'ws';

interface PriceData {
    price: string;
    timestamp: number;
}

// 添加类型定义
interface WebSocketMessage {
    event?: string;
    arg?: {
        channel: string;
        instId: string;
    };
    data?: string[][];
}

let statusBarStartButton: vscode.StatusBarItem;
let isMonitoring = false;
let statusBarItems: Map<string, vscode.StatusBarItem> = new Map();
let priceData: Map<string, PriceData> = new Map();
let abbrLib: Map<string, string> = new Map();
let priceTickSz: Map<string, number> = new Map();
let ws: WebSocket | null = null;
let carouselIntervalId: NodeJS.Timeout | null = null;
let reconnectAttempts = 0;
let pingInterval: NodeJS.Timeout | null = null;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_INTERVAL = 1000;

let currentCarouselIndex = 0;
let currentPair = "";

export function activate(context: vscode.ExtensionContext) {
    console.log('OKX Tradingview Extension is now active!');

    // 只创建状态栏按钮
    statusBarStartButton = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Right,
        100
    );
    statusBarStartButton.text = "$(play) OKX";
    statusBarStartButton.tooltip = "点击开始监控 OKX 价格";
    statusBarStartButton.command = 'okx-tradingview.toggleMonitoring';
    statusBarStartButton.show();

    // 注册命令
    let toggleCommand = vscode.commands.registerCommand('okx-tradingview.toggleMonitoring', () => {
        if (isMonitoring) {
            stopMonitoring();
        } else {
            startMonitoring();
        }
    });
    context.subscriptions.push(statusBarStartButton, toggleCommand);
}

async function startMonitoring() {
    console.log('OKX Tradingview startMonitoring!');
    if (isMonitoring) { return; }

    isMonitoring = true;
    statusBarStartButton.text = "$(stop) OKX";
    statusBarStartButton.tooltip = "点击停止监控";

    // 初始化WebSocket连接和其他监控逻辑
    initializeExtension();
}

function stopMonitoring() {
    if (!isMonitoring) { return; }

    isMonitoring = false;
    statusBarStartButton.text = "$(play) OKX";
    statusBarStartButton.tooltip = "点击开始监控 OKX 价格";

    clearExistingSetup();
}

async function initializeExtension() {
    clearExistingSetup();
    const config = getConfig();
    abbrLib = makeAbbrLib(config);
    await getPricePrecision(config);
    await setupStatusBarItems(config);
    await refreshPrices();
    setupWebSocket();
}

interface OkxInstrument {
    instId: string;
    tickSz: string;
    instType: string;
}

/**
 * Get price precision for specified instruments from OKX
 * @param instIds Array of instrument IDs to check
 * @returns Map of instId to price precision (number of decimal places)
 */
async function getPricePrecision(config: { pairs: string[] }) {
    const baseUrl = 'https://www.okx.com';
    const endpoint = '/api/v5/public/instruments';
    const result = new Map<string, number>();

    try {
        // Process instruments in batches to handle possible rate limits
        for (const instId of config.pairs) {
            const instType = instId.endsWith('-SWAP') ? 'SWAP' : 'SPOT';

            const response = await axios.get(baseUrl + endpoint, {
                params: {
                    instType,
                    instId
                }
            });

            if (response.data?.data?.[0]) {
                const instrument = response.data.data[0] as OkxInstrument;
                // Calculate decimal places from tickSz (e.g., "0.1" => 1, "0.01" => 2)
                const precision = -Math.log10(parseFloat(instrument.tickSz));
                result.set(instId, precision);
            }
        }

        priceTickSz = result;
    } catch (error) {
        console.error('Error fetching instrument data:', error);
        throw error;
    }
}

function makeAbbrLib(config: { pairs: string[], abbreviation: string }): Map<string, string> {
    // 创建一个新的Map而不是修改全局变量
    let resultAbbrLib = new Map<string, string>();

    // 提前返回空Map如果abbreviation不是enable
    if (config.abbreviation !== 'enable') {
        return resultAbbrLib;
    }

    // 创建初始缩写Map
    const createInitialAbbrs = (pairs: string[]): Map<string, string> => {
        return new Map(
            pairs.map(pair => [pair, pair.split('-')[0]])
        );
    };

    // 检查缩写是否有重复
    const hasUniqueAbbrs = (abbrMap: Map<string, string>): boolean => {
        const abbrs = [...abbrMap.values()];
        return new Set(abbrs).size === abbrs.length;
    };

    // 第一次尝试：使用简单的首段缩写
    const firstAttemptAbbrs = createInitialAbbrs(config.pairs);
    if (hasUniqueAbbrs(firstAttemptAbbrs)) {
        return firstAttemptAbbrs;
    }

    // 第二次尝试：为SWAP结尾的添加-S后缀
    const secondAttemptAbbrs = new Map(
        [...firstAttemptAbbrs].map(([pair, abbr]) => {
            const hasConflict = [...firstAttemptAbbrs].some(
                ([otherPair, otherAbbr]) =>
                    otherPair !== pair &&
                    otherAbbr === abbr
            );

            if (hasConflict && pair.endsWith('-SWAP')) {
                return [pair, `${abbr}-S`];
            }
            return [pair, abbr];
        })
    );

    if (hasUniqueAbbrs(secondAttemptAbbrs)) {
        return secondAttemptAbbrs;
    }

    // 如果所有尝试都失败，记录错误并返回空Map
    console.error('Error cannot abbreviate:', config.pairs);
    return resultAbbrLib;
}

function getConfig() {
    const config = vscode.workspace.getConfiguration('okxTradingview');
    return {
        pairs: config.get<string[]>('pairs', ["BTC-USDT-SWAP", "ETH-USDT-SWAP"]),
        displayMode: config.get<'row' | 'carousel'>('displayMode', 'row'),
        carouselInterval: config.get<number>('carouselInterval', 5000),
        abbreviation: config.get<'enable' | 'disable'>('abbreviation', 'disable')
    };
}

function clearExistingSetup() {
    if (carouselIntervalId) {
        clearInterval(carouselIntervalId);
        carouselIntervalId = null;
    }
    if (pingInterval) {
        clearInterval(pingInterval);
        pingInterval = null;
    }
    if (ws) {
        ws.close();
        ws = null;
    }
    statusBarItems.forEach(item => item.dispose());
    statusBarItems.clear();
    priceData.clear();
}

async function setupStatusBarItems(config: { pairs: string[], displayMode: string, carouselInterval: number }) {
    if (config.displayMode === 'row') {
        config.pairs.forEach((pair) => {
            const item = createStatusBarItem(pair);
            statusBarItems.set(pair, item);
        });
    } else {
        currentCarouselIndex = 0;
        currentPair = config.pairs[0];
        const item = createStatusBarItem(currentPair);
        statusBarItems.set(currentPair, item);

        carouselIntervalId = setInterval(() => {
            rotateCarousel(config.pairs);
        }, config.carouselInterval);
    }
}

function createStatusBarItem(pair: string): vscode.StatusBarItem {
    const abbrPair = abbrLib.get(pair)
    if (abbrPair) {
        pair = abbrPair;
    }

    const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right);
    item.text = `$(sync~spin) ${pair}`;
    item.show();
    return item;
}

function rotateCarousel(pairs: string[]) {
    if (pairs.length === 0) {
        return;
    }

    const oldPair = currentPair;
    currentCarouselIndex = (currentCarouselIndex + 1) % pairs.length;
    currentPair = pairs[currentCarouselIndex];


    let item = statusBarItems.get(oldPair);
    if (!item) {
        item = createStatusBarItem(currentPair);
        return;
    }

    statusBarItems.clear();
    statusBarItems.set(currentPair, item);
    updateStatusBarItem(currentPair);
}

async function refreshPrices() {
    const config = getConfig();
    try {
        const responses = await Promise.all(
            config.pairs.map(pair =>
                axios.get(`https://www.okx.com/api/v5/market/ticker?instId=${pair}`)
            )
        );

        responses.forEach(response => {
            const data = response.data.data[0];
            priceData.set(data.instId, {
                price: data.last,
                timestamp: parseInt(data.ts),
            });
            updateStatusBarItem(data.instId);
        });
    } catch (error) {
        console.error('Error fetching prices:', error);
    }
}

function formatPrice(priceStr: string, pair: string): string {
    // 如果无法获取精度信息，返回原始字符串
    if (!priceTickSz.has(pair)) {
        return priceStr;
    }

    // 将字符串转换为数字
    const price = parseFloat(priceStr);
    if (isNaN(price)) {
        return priceStr;
    }
    1
    // 获取精度并格式化
    const precision = priceTickSz.get(pair)!;
    return price.toFixed(precision);
}

function updateStatusBarItem(pair: string) {
    const data = priceData.get(pair);
    const item = statusBarItems.get(pair);
    if (!data || !item) {
        return;
    }

    let abbrPair = abbrLib.get(pair)
    if (!abbrPair) {
        abbrPair = pair;
    }

    const priceStr = data.price;
    item.text = `${abbrPair}: ${formatPrice(priceStr, pair)}`;
    item.tooltip = `Last updated: ${new Date(data.timestamp).toLocaleTimeString()}`;
}

function setupWebSocket() {
    if (ws) {
        ws.close();
    }

    ws = new WebSocket('wss://ws.okx.com:8443/ws/v5/business');

    ws.on('open', () => {
        console.log('WebSocket connected');
        reconnectAttempts = 0;
        subscribeToChannels();
    });

    ws.on('message', handleWebSocketMessage);
    ws.on('error', handleWebSocketError);
    ws.on('close', handleWebSocketClose);

    // Clear existing ping interval if any
    if (pingInterval) {
        clearInterval(pingInterval);
    }

    // Setup new ping interval
    pingInterval = setInterval(() => {
        if (ws?.readyState === WebSocket.OPEN) {
            ws.send('ping');
        }
    }, 30000);
}

function subscribeToChannels() {
    if (!ws || ws.readyState !== WebSocket.OPEN) { return; }

    const config = getConfig();
    const subscribeMsg = {
        op: 'subscribe',
        args: config.pairs.map(pair => ({
            channel: 'candle1s',
            instId: pair
        }))
    };

    ws.send(JSON.stringify(subscribeMsg));
}

function handleWebSocketMessage(data: WebSocket.Data) {
    const dataStr = data.toString();
    // 先检查是否是 pong 消息
    if (dataStr === 'pong') {
        console.debug('Received pong message');
        return;
    }

    try {
        const message: WebSocketMessage = JSON.parse(dataStr);
        if (message.event === 'subscribe') {
            return;
        } else if (message.arg && message.data && Array.isArray(message.data)) {
            const pair = message.arg.instId;
            message.data.forEach(item => {
                priceData.set(pair, {
                    price: item[4],
                    timestamp: parseInt(item[0]),
                });
                updateStatusBarItem(pair);
            });
        } else { 
            console.error('Error unknown WebSocket message:', dataStr);
        }
    } catch (error) {
        console.error('Error handling WebSocket message:', error, ', message:', dataStr);
    }
}

function handleWebSocketError(error: Error) {
    console.error('WebSocket error:', error);
}

function handleWebSocketClose() {
    console.log('WebSocket closed');
    if (!isMonitoring) {
        return;
    }

    if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        reconnectAttempts++;
        const delay = RECONNECT_INTERVAL * Math.pow(2, reconnectAttempts - 1);
        setTimeout(() => setupWebSocket(), delay);
    } else {
        console.error('Failed to maintain WebSocket connection after multiple attempts');
    }
}

export function deactivate() {
    stopMonitoring();
    if (statusBarStartButton) {
        statusBarStartButton.dispose();
    }
}