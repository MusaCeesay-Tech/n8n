import {
	app,
	BrowserWindow,
	Menu,
	nativeImage,
	powerSaveBlocker,
	shell,
	Tray,
} from 'electron';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';

// Gridwork desktop shell.
// It starts the bundled n8n server, waits for the health endpoint, and shows the
// editor in a window. The server runs as a child process with the Electron binary
// in Node mode, so no separate Node runtime is needed.

const HOST = '127.0.0.1';
const PORT = Number(process.env.GRIDWORK_PORT ?? 5678);
const BASE_URL = `http://${HOST}:${PORT}`;
const READY_TIMEOUT_MS = 300_000;

// Shown while the local server warms up, so the user never sees a blank window
// or a raw connection error page.
const LOADING_HTML = `data:text/html;charset=utf-8,${encodeURIComponent(
	'<!doctype html><html><head><meta charset="utf-8"><title>Gridwork</title>' +
		'<style>html,body{height:100%;margin:0}body{font-family:system-ui,Segoe UI,sans-serif;' +
		'display:flex;align-items:center;justify-content:center;background:#fff;color:#222}' +
		'.box{text-align:center}.sp{width:28px;height:28px;margin:0 auto 16px;border:3px solid #eee;' +
		'border-top-color:#e94ba0;border-radius:50%;animation:s 1s linear infinite}' +
		'@keyframes s{to{transform:rotate(360deg)}}</style></head><body><div class="box">' +
		'<div class="sp"></div><h1>Starting Gridwork</h1>' +
		'<p>Your local server is warming up. The first start can take a minute.</p></div></body></html>',
)}`;

let server: ChildProcess | null = null;
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let powerBlockerId: number | null = null;
let loadRetries = 0;

// Walk up from a directory until the repo root is found.
function findRepoRoot(start: string): string {
	let dir = start;
	for (let i = 0; i < 10; i++) {
		if (fs.existsSync(path.join(dir, 'packages', 'cli', 'bin', 'n8n'))) {
			return dir;
		}
		const parent = path.dirname(dir);
		if (parent === dir) {
			break;
		}
		dir = parent;
	}
	throw new Error('Could not find the Gridwork repo root (packages/cli/bin/n8n)');
}

// The n8n CLI script and the directory to run it from.
function resolveCli(): { script: string; cwd: string } {
	const base = app.isPackaged
		? path.join(process.resourcesPath, 'gridwork')
		: findRepoRoot(__dirname);
	return {
		script: path.join(base, 'packages', 'cli', 'bin', 'n8n'),
		cwd: path.join(base, 'packages', 'cli'),
	};
}

// Per-user data directory for the local instance.
function dataDir(): string {
	return path.join(app.getPath('userData'), 'n8n-data');
}

// The Node.js runtime that runs the n8n server. Electron uses a different V8
// build, so native modules such as isolated-vm do not load inside Electron.
// Use a real Node binary instead: the system Node in development, a bundled
// Node in the packaged app.
function resolveNode(): string {
	if (process.env.GRIDWORK_NODE) {
		return process.env.GRIDWORK_NODE;
	}
	if (app.isPackaged) {
		const exe = process.platform === 'win32' ? 'node.exe' : 'node';
		return path.join(process.resourcesPath, 'node', exe);
	}
	return process.platform === 'win32' ? 'node.exe' : 'node';
}

function iconPath(): string {
	return path.join(__dirname, '..', '..', 'assets', 'icon.png');
}

function startServer(): void {
	const { script, cwd } = resolveCli();
	fs.mkdirSync(dataDir(), { recursive: true });

	const env: NodeJS.ProcessEnv = {
		...process.env,
		N8N_USER_FOLDER: dataDir(),
		N8N_PORT: String(PORT),
		N8N_HOST: HOST,
		N8N_LISTEN_ADDRESS: HOST,
		N8N_PROTOCOL: 'http',
		N8N_SECURE_COOKIE: 'false',
		N8N_DIAGNOSTICS_ENABLED: 'false',
	};

	server = spawn(resolveNode(), [script], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
	server.stdout?.on('data', (chunk: Buffer) => process.stdout.write(`[n8n] ${chunk.toString()}`));
	server.stderr?.on('data', (chunk: Buffer) => process.stderr.write(`[n8n] ${chunk.toString()}`));
	server.on('exit', (code) => {
		console.log(`[gridwork] n8n exited with code ${String(code)}`);
		server = null;
	});
}

function isReady(): Promise<boolean> {
	return new Promise((resolve) => {
		// The editor root serves the app HTML once the server is fully warmed up.
		// A 503/404 here means the server is listening but not ready yet.
		const req = http.get({ host: HOST, port: PORT, path: '/', timeout: 8000 }, (res) => {
			const ok =
				res.statusCode === 200 &&
				String(res.headers['content-type'] ?? '').includes('text/html');
			res.resume();
			resolve(ok);
		});
		req.on('error', () => resolve(false));
		req.on('timeout', () => {
			req.destroy();
			resolve(false);
		});
	});
}

async function waitForReady(): Promise<void> {
	const deadline = Date.now() + READY_TIMEOUT_MS;
	while (Date.now() < deadline) {
		if (await isReady()) {
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, 1000));
	}
	throw new Error('The n8n server did not become ready in time');
}

// Point the window at the app once the server is ready.
function loadApp(): void {
	if (mainWindow && !mainWindow.isDestroyed()) {
		void mainWindow.loadURL(BASE_URL);
	}
}

function createWindow(): void {
	if (mainWindow && !mainWindow.isDestroyed()) {
		if (mainWindow.isMinimized()) {
			mainWindow.restore();
		}
		mainWindow.focus();
		return;
	}
	mainWindow = new BrowserWindow({
		width: 1280,
		height: 860,
		title: 'Gridwork',
		backgroundColor: '#ffffff',
		icon: iconPath(),
		webPreferences: {
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
		},
	});
	loadRetries = 0;
	void mainWindow.loadURL(LOADING_HTML);
	mainWindow.webContents.on('did-fail-load', () => {
		if (loadRetries++ < 30 && mainWindow && !mainWindow.isDestroyed()) {
			setTimeout(() => {
				if (mainWindow && !mainWindow.isDestroyed()) {
					void mainWindow.loadURL(BASE_URL);
				}
			}, 2000);
		}
	});
	mainWindow.webContents.setWindowOpenHandler(({ url }) => {
		void shell.openExternal(url);
		return { action: 'deny' };
	});
	mainWindow.on('closed', () => {
		mainWindow = null;
	});
}

function createTray(): void {
	const image = nativeImage.createFromPath(iconPath());
	if (image.isEmpty()) {
		console.warn('[gridwork] tray icon not found, skipping tray');
		return;
	}
	tray = new Tray(image.resize({ width: 16, height: 16 }));
	const menu = Menu.buildFromTemplate([
		{ label: 'Open Gridwork', click: () => createWindow() },
		{
			label: 'Open data folder',
			click: () => {
				void shell.openPath(dataDir());
			},
		},
		{ type: 'separator' },
		{
			label: 'Start Gridwork when I log in',
			type: 'checkbox',
			checked: app.getLoginItemSettings().openAtLogin,
			click: (item) => {
				app.setLoginItemSettings({ openAtLogin: item.checked });
			},
		},
		{ type: 'separator' },
		{
			label: 'Quit Gridwork',
			click: () => {
				app.quit();
			},
		},
	]);
	tray.setToolTip('Gridwork');
	tray.setContextMenu(menu);
	tray.on('double-click', () => createWindow());
}

function stopServer(): void {
	if (!server || server.pid === undefined) {
		return;
	}
	const pid = server.pid;
	try {
		if (process.platform === 'win32') {
			spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
		} else {
			process.kill(-pid, 'SIGTERM');
		}
	} catch {
		// Best effort. The process may already be gone.
	}
	server = null;
}

if (process.platform === 'win32') {
	app.setAppUserModelId('ai.gridwork.desktop');
}

if (!app.requestSingleInstanceLock()) {
	app.quit();
} else {
	app.on('second-instance', () => createWindow());

	void app
		.whenReady()
		.then(async () => {
			startServer();
			powerBlockerId = powerSaveBlocker.start('prevent-app-suspension');
			createWindow();
			createTray();
			app.on('activate', () => createWindow());
			try {
				await waitForReady();
			} catch (error: unknown) {
				console.error('[gridwork]', error instanceof Error ? error.message : String(error));
			}
			loadApp();
		})
		.catch((error: unknown) => {
			console.error('[gridwork] init failed', error);
			app.quit();
		});

	// Keep running in the tray when the window closes so the host stays online.
	app.on('window-all-closed', () => {
		// Intentionally do nothing.
	});

	app.on('before-quit', () => {
		if (powerBlockerId !== null && powerSaveBlocker.isStarted(powerBlockerId)) {
			powerSaveBlocker.stop(powerBlockerId);
		}
		stopServer();
	});
}
