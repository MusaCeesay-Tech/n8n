/** @type {import('electron-builder').Configuration} */
const config = {
	appId: 'ai.gridwork.desktop',
	productName: 'Gridwork',
	directories: { output: 'out', buildResources: 'assets' },
	files: ['dist/**', 'package.json'],
	extraResources: [{ from: '../../..', to: 'gridwork', filter: ['**/*'] }],
	win: {
		target: [{ target: 'nsis', arch: ['x64'] }],
		icon: 'assets/icon.ico',
	},
	nsis: {
		oneClick: false,
		allowToChangeInstallationDirectory: true,
	},
};
module.exports = config;
