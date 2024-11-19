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
    await setupStatusBarItems(config);
    await refreshPrices();
    setupWebSocket();
}

function getConfig() {
    const config = vscode.workspace.getConfiguration('okxTradingview');
    return {
        pairs: config.get<string[]>('pairs', ["BTC-USDT-SWAP", "ETH-USDT-SWAP"]),
        displayMode: config.get<'row' | 'carousel'>('displayMode', 'row'),
        carouselInterval: config.get<number>('carouselInterval', 5000)
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

function updateStatusBarItem(pair: string) {
    const data = priceData.get(pair);
    const item = statusBarItems.get(pair);
    if (!data || !item) {
        return;
    }

    const priceStr = data.price;
    item.text = `${pair}: $${priceStr}`;
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