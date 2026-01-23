/**
 * AnyRouter Telegram Bot - Cloudflare Worker
 *
 * Environment Variables (set in Cloudflare Dashboard):
 * - TELEGRAM_BOT_TOKEN: Telegram Bot Token
 * - TELEGRAM_CHAT_ID: Allowed Chat IDs (comma separated)
 * - GITHUB_TOKEN: GitHub Personal Access Token
 * - GITHUB_REPO: Repository name, format: owner/repo
 * - BOT_SECRET: Webhook secret key (optional)
 */

const BOT_NAME = 'AnyRouter';

const COMMANDS = {
	'/start': `<b>🤖 Welcome to ${BOT_NAME} Bot!</b>

━━━━━━━━━━━━━━━
<b>📋 Available Commands</b>
━━━━━━━━━━━━━━━

🔄 /checkin — Trigger check-in
💰 /balance — View current balance
📊 /history — View check-in history
🔍 /status — Check service status
❓ /help — Show this help

━━━━━━━━━━━━━━━
<i>⏰ Auto check-in runs every 6 hours</i>`,

	'/help': `<b>❓ Help — ${BOT_NAME} Bot</b>

━━━━━━━━━━━━━━━
<b>📋 Command List</b>
━━━━━━━━━━━━━━━

🔄 /checkin
   <i>Manually trigger check-in process</i>

💰 /balance
   <i>Quick view of current balance</i>

📊 /history
   <i>View recent check-in records</i>

🔍 /status
   <i>Check AnyRouter service status</i>

━━━━━━━━━━━━━━━
<b>💡 Tips</b>
━━━━━━━━━━━━━━━
• Bot auto check-in every 6 hours
• Notifications sent on balance change
• Use /status to check if service is up`,
};

export default {
	async fetch(request, env) {
		const url = new URL(request.url);

		// GET request - show status or setup commands
		if (request.method === 'GET') {
			if (url.pathname === '/setup') {
				return await setupBotCommands(env);
			}
			return new Response(`${BOT_NAME} Telegram Bot is running! 🚀`, { status: 200 });
		}

		if (request.method !== 'POST') {
			return new Response('Method not allowed', { status: 405 });
		}

		// Verify secret key (optional)
		if (env.BOT_SECRET && url.pathname !== `/${env.BOT_SECRET}`) {
			return new Response('Unauthorized', { status: 401 });
		}

		try {
			const update = await request.json();
			const message = update.message || update.edited_message;

			if (!message || !message.text) {
				return new Response('OK', { status: 200 });
			}

			const chatId = message.chat.id.toString();
			const text = message.text.trim();
			const allowedChats = (env.TELEGRAM_CHAT_ID || '').split(',').map(id => id.trim());

			// Verify Chat ID
			if (allowedChats.length > 0 && allowedChats[0] !== '' && !allowedChats.includes(chatId)) {
				await sendMessage(env, chatId, '⛔ <b>Unauthorized</b>\n\n<i>Your Chat ID is not allowed.</i>');
				return new Response('OK', { status: 200 });
			}

			// Handle commands
			const command = text.split(' ')[0].toLowerCase();
			let response = '';

			switch (command) {
				case '/start':
				case '/help':
					response = COMMANDS[command];
					break;

				case '/checkin':
					response = await triggerCheckin(env);
					break;

				case '/balance':
					response = await getBalance(env);
					break;

				case '/history':
					response = await getHistory(env);
					break;

				case '/status':
					await sendStatus(env, chatId);
					return new Response('OK', { status: 200 });

				default:
					if (text.startsWith('/')) {
						response = '❓ <b>Unknown Command</b>\n\n<i>Use /help to see available commands.</i>';
					}
			}

			if (response) {
				await sendMessage(env, chatId, response);
			}

			return new Response('OK', { status: 200 });
		} catch (error) {
			console.error('Error:', error);
			return new Response('Error', { status: 500 });
		}
	}
};

// Setup bot commands (call once via GET /setup)
async function setupBotCommands(env) {
	if (!env.TELEGRAM_BOT_TOKEN) {
		return new Response('TELEGRAM_BOT_TOKEN not set', { status: 400 });
	}

	const commands = [
		{ command: 'checkin', description: '🔄 Trigger check-in' },
		{ command: 'balance', description: '💰 View current balance' },
		{ command: 'history', description: '📊 View check-in history' },
		{ command: 'status', description: '🔍 Check service status' },
		{ command: 'help', description: '❓ Show help message' },
	];

	const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/setMyCommands`;
	const response = await fetch(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ commands })
	});

	const result = await response.json();
	return new Response(JSON.stringify(result, null, 2), {
		status: 200,
		headers: { 'Content-Type': 'application/json' }
	});
}

// Send Telegram message
async function sendMessage(env, chatId, text) {
	const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
	await fetch(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			chat_id: chatId,
			text: text,
			parse_mode: 'HTML',
			disable_web_page_preview: true
		})
	});
}

// Get current balance (quick view)
async function getBalance(env) {
	if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) {
		return '⚠️ <b>Configuration Error</b>\n\n<i>GitHub settings not configured.</i>';
	}

	try {
		const historyUrl = `https://api.github.com/repos/${env.GITHUB_REPO}/contents/balance_history.json`;
		const historyResponse = await fetch(historyUrl, {
			headers: {
				'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
				'User-Agent': 'AnyRouter-Bot',
				'Accept': 'application/vnd.github.v3+json'
			}
		});

		if (!historyResponse.ok) {
			return '📭 <b>No Data</b>\n\n<i>No balance records found. Try /checkin first.</i>';
		}

		const historyData = await historyResponse.json();
		if (!historyData.content) {
			return '📭 <b>No Data</b>\n\n<i>Balance history is empty.</i>';
		}

		const content = atob(historyData.content.replace(/\n/g, ''));
		const history = JSON.parse(content);

		if (history.length === 0) {
			return '📭 <b>No Data</b>\n\n<i>No check-in records yet.</i>';
		}

		// Get latest record
		const latest = history[history.length - 1];
		const time = latest.time || 'Unknown';

		let msg = `<b>💰 Current Balance</b>\n`;
		msg += `━━━━━━━━━━━━━━━\n\n`;

		let totalBalance = 0;
		let totalUsed = 0;

		for (const acc of latest.accounts || []) {
			const icon = acc.success ? '✅' : '❌';
			msg += `${icon} <b>${acc.name}</b>\n`;

			if (acc.balance) {
				const balanceNum = parseFloat(acc.balance.replace('$', '')) || 0;
				totalBalance += balanceNum;
				msg += `   💵 Balance: <code>${acc.balance}</code>\n`;
			}
			if (acc.used) {
				const usedNum = parseFloat(acc.used.replace('$', '')) || 0;
				totalUsed += usedNum;
				msg += `   📉 Used: <code>${acc.used}</code>\n`;
			}
			msg += '\n';
		}

		msg += `━━━━━━━━━━━━━━━\n`;
		if (latest.accounts && latest.accounts.length > 1) {
			msg += `📊 <b>Total:</b> <code>$${totalBalance.toFixed(2)}</code>\n`;
		}
		msg += `🕐 <i>Updated: ${time.slice(5, 16)}</i>`;

		return msg;
	} catch (error) {
		return `❌ <b>Error</b>\n\n<i>${error.message}</i>`;
	}
}

// Get check-in history
async function getHistory(env) {
	if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) {
		return '⚠️ <b>Configuration Error</b>\n\n<i>GitHub settings not configured.</i>';
	}

	try {
		const historyUrl = `https://api.github.com/repos/${env.GITHUB_REPO}/contents/balance_history.json`;
		const historyResponse = await fetch(historyUrl, {
			headers: {
				'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
				'User-Agent': 'AnyRouter-Bot',
				'Accept': 'application/vnd.github.v3+json'
			}
		});

		if (historyResponse.ok) {
			const historyData = await historyResponse.json();
			if (historyData.content) {
				const content = atob(historyData.content.replace(/\n/g, ''));
				const history = JSON.parse(content);

				if (history.length > 0) {
					let msg = `<b>📊 Check-in History</b>\n`;
					msg += `━━━━━━━━━━━━━━━\n\n`;

					const records = history.slice(-5).reverse();
					for (const record of records) {
						const icon = record.success ? '✅' : '❌';
						const shortTime = record.time.slice(5, 16);
						msg += `${icon} <b>${shortTime}</b>\n`;

						for (const acc of record.accounts || []) {
							const accIcon = acc.success ? '✓' : '✗';
							msg += `   ${accIcon} ${acc.name}`;
							if (acc.balance) {
								msg += ` · <code>${acc.balance}</code>`;
							}
							msg += '\n';
						}
						msg += '\n';
					}

					msg += `━━━━━━━━━━━━━━━\n`;
					msg += `<i>📝 Showing ${records.length} of ${history.length} records</i>`;
					return msg;
				}
			}
		}

		// Fallback to workflow runs
		const url = `https://api.github.com/repos/${env.GITHUB_REPO}/actions/runs?per_page=10`;
		const response = await fetch(url, {
			headers: {
				'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
				'User-Agent': 'AnyRouter-Bot'
			}
		});

		const data = await response.json();
		const runs = data.workflow_runs || [];

		if (runs.length === 0) {
			return '📭 <b>No Records</b>\n\n<i>No check-in history yet.</i>';
		}

		let msg = `<b>📊 Workflow History</b>\n`;
		msg += `━━━━━━━━━━━━━━━\n\n`;

		for (const run of runs.slice(0, 5)) {
			const time = formatTime(run.created_at);
			const icon = run.conclusion === 'success' ? '✅' :
			             run.conclusion === 'failure' ? '❌' :
			             run.status === 'in_progress' ? '🔄' : '⏳';
			const status = run.conclusion || run.status || 'pending';

			msg += `${icon} <code>${time}</code> ${status}\n`;
		}

		msg += `\n━━━━━━━━━━━━━━━\n`;
		msg += `<i>📝 Showing last 5 workflow runs</i>`;
		return msg;
	} catch (error) {
		return `❌ <b>Error</b>\n\n<i>${error.message}</i>`;
	}
}

// Trigger check-in (via GitHub Actions)
async function triggerCheckin(env) {
	if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) {
		return '⚠️ <b>Configuration Error</b>\n\n<i>GitHub settings not configured.</i>';
	}

	try {
		const url = `https://api.github.com/repos/${env.GITHUB_REPO}/dispatches`;
		const response = await fetch(url, {
			method: 'POST',
			headers: {
				'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
				'User-Agent': 'AnyRouter-Bot',
				'Accept': 'application/vnd.github.v3+json',
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				event_type: 'telegram_checkin',
				client_payload: { triggered_by: 'telegram' }
			})
		});

		if (response.status === 204 || response.status === 200) {
			return `<b>🚀 Check-in Triggered!</b>

━━━━━━━━━━━━━━━

✅ Process has started successfully

⏳ Please wait 1-2 minutes...
📬 You'll receive a notification when done

━━━━━━━━━━━━━━━
<i>💡 Use /history to check progress</i>`;
		} else {
			const text = await response.text();
			return `❌ <b>Trigger Failed</b>\n\n<i>Status: ${response.status}</i>\n<code>${text.slice(0, 100)}</code>`;
		}
	} catch (error) {
		return `❌ <b>Error</b>\n\n<i>${error.message}</i>`;
	}
}

// Send AnyRouter status link
async function sendStatus(env, chatId) {
	const statusUrl = 'https://check.linux.do/group/AnyRouter';
	const message = `<b>🔍 Service Status</b>

━━━━━━━━━━━━━━━

📊 <a href="${statusUrl}">View Live Dashboard</a>

━━━━━━━━━━━━━━━
<i>🔄 Real-time monitoring • Auto-refresh</i>`;

	const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
	await fetch(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			chat_id: chatId,
			text: message,
			parse_mode: 'HTML',
			disable_web_page_preview: false
		})
	});
}

// Format time to Beijing time (UTC+8)
function formatTime(isoString) {
	const date = new Date(isoString);
	const utc8 = new Date(date.getTime() + 8 * 60 * 60 * 1000);
	const month = String(utc8.getUTCMonth() + 1).padStart(2, '0');
	const day = String(utc8.getUTCDate()).padStart(2, '0');
	const hours = String(utc8.getUTCHours()).padStart(2, '0');
	const minutes = String(utc8.getUTCMinutes()).padStart(2, '0');
	return `${month}-${day} ${hours}:${minutes}`;
}
