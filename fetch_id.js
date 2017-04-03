'use strict';

const http = require('http');
const fs = require('fs');
const querystring = require('querystring');
const readline = require('readline');
const util = require('util');
const assert = require('assert');
const url = require('url');
const ua_list = require('./user-agents.json')

const input_file = 'dianping_url.txt';
const data_file = 'dianping_id_res.txt';
const log_file = 'dianping_id_log.txt';
const LOG_FILE = 'fetch_id_prog_log.txt';

const prog_log = fs.createWriteStream(LOG_FILE, { flags: 'a' });

const GLOBAL_RATE = 10 * 100;
var global_rate = GLOBAL_RATE; // 1.0s

const UPPER_BOUND = 2 * 100; // 0.2s
const LOWER_BOUND = 5 * 100; // 0.5s

const CONCURRENT_NUM = 10;

let timer = (timeout) => {
	return new Promise((resolve, reject) => {
		setTimeout(() => {
			resolve('timeout');
		}, timeout * 0);
	});
}

function LOG() {
	let args = Array.prototype.slice.call(arguments);
	let output = '[' + (new Date).toUTCString() + ']: '
			+ args.map(x => typeof x === 'string' ? x : util.inspect(x)).join(' ');
	console.log(output);
	prog_log.write(output + '\n');
}

function read_content(request) {
	return new Promise((resolve, reject) => {
		request.on('response', (res) => {
			let data = '';
			res.setEncoding('utf8');
			res.on('data', chunk => data += chunk);
			res.on('end', () => {
				resolve(data.toString());
			});
			res.on('error', err => reject(err));
		});
	});
}

function init_log(log_file) {
	return new Promise((resolve, reject) => {
		let vis = new Set();
		let rd = readline.createInterface({
			input: fs.createReadStream(log_file)
		});
		let now = 0;
		rd.on('line', (line) => {
			if (line.startsWith('writing '))
				now = line.substring(8);
			if (line.startsWith('done ')) {
				if (line.substring(5) !== now)
					assert(0, log_file + ' resolve failed.');
				vis.add(now);
				now = 0;
			}
		});
		rd.on('close', () => {
			if (now !== 0)
				assert(0, log_file + ' resolve failed.');
			resolve(vis);
		});
		rd.on('error', (err) => {
			reject(err);
		})
	});
}

function random_user_agent() {
	return ua_list[Math.floor(Math.random() * ua_list.length)];
}

/* abuyun.com */
const proxy_host = 'proxy.abuyun.com';
const proxy_port = '9020';

var proxy_user = 'HG8073W66E7Y04ED';
var proxy_pass = '8E2E7520FDFFB5BA';

var proxy_pass_base64 = new Buffer(proxy_user + ':' + proxy_pass).toString('base64');

function read_proxy_config() {
	let config = require('./http_proxy.json');
	proxy_user = config['proxy_user'];
	proxy_pass = config['proxy_pass'];
	proxy_pass_base64 = new Buffer(proxy_user + ':' + proxy_pass).toString('base64');
}

async function send_request(option) {

	/*
	option['path'] = 'http://' + option.host + option.path
	option.host = proxy_host;
	option.port = proxy_port;
	option.headers['Host'] = url.parse(option.path).hostname;
	option.headers['Proxy-Authorization'] = 'Basic ' + proxy_pass_base64;
	*/
	option.headers['User-Agent'] = random_user_agent();
	//LOG(option);

	let req = http.get(option);
	let text = await read_content(req);
	return text;
}

function handle_page_ids(text) {
	let ids = [];
	try {
		let st, en;
		let re = /(\d+)/;
		let pattern = 'target="_blank" href="/shop/';
		while ((st = text.indexOf(pattern)) >= 0) {
			text = text.substring(st + pattern.length);
			en = text.indexOf('"');
			ids.push(re.exec(text)[1]);
			text = text.substring(en);
		}
	} catch (e) {
		LOG(e);
		throw e;
	}
	return Array.from(new Set(ids)); //unique
}

async function save_ids(url, option, handler) {

	let text, fail_times = 0;
	while (1) {
		text = await send_request(option);

		if (text.indexOf('商户不存在-大众点评网') >= 0) {
			return;
		}
		if (text.lengh < 10 || text.indexOf('为了您的正常访问，请先输入验证码') >= 0 || text.indexOf('请输入下方图形验证码') >= 0) {
			LOG(url, 'request 1 \x1b[31mblocked\x1b[0m.');
			if (++fail_times > 10)
				return 'blocked';
		} else {
			break;
		}
	}

	let ids = [];
	try {
		ids = await handler(text);
	} catch (e) {
		throw e;
	}

	let st, en;
	st = text.indexOf('<div class="page">');

	text = text.substring(st);
	let re = /data-ga-page="(\d+)"/g;
	let max_no = 1, page_no;

	if (st >= 0) {
		while ((page_no = re.exec(text)) !== null) {
			if (max_no < Number(page_no[1]))
				max_no = Number(page_no[1]);
		}
	}
	LOG(url, 'page max_no = ', max_no);
	
	/* TODO 不严格按顺序访问 */
	for (let i = 2; i <= max_no; i++) {
		LOG('pageno = ', i);

		option.host = 'www.dianping.com';
		option.path = '/' + url.split('/').slice(1).join('/') + 'p' + String(i);
		LOG(option.path);

		fail_times = 0;
		while (1) {
			text = await send_request(option);

			if (text.length < 10 || text.indexOf('为了您的正常访问，请先输入验证码') >= 0 || text.indexOf('请输入下方图形验证码') >= 0) {
				LOG(url, 'request 1 \x1b[31mblocked\x1b[0m.');
				if (++fail_times > 10)
					return 'blocked';
			} else {
				break;
			}
		}

		ids = ids.concat(handler(text));

		await timer(Math.random() * (UPPER_BOUND - LOWER_BOUND) + LOWER_BOUND);
	}

	return Array.from(new Set(ids)); //unique
}

async function work(vis, url) {
	return new Promise(async (resolve, reject) => {

		LOG(url);

		/* request 1 */
		/* 模仿浏览器请求 */
		LOG(url, 'sending request 1...');
		let option = {
			host: 'www.dianping.com',
			path: '/',
			port: 80,
			headers: {
				'Connection': 'keep-alive',
				'Pragma': 'no-cache',
				'Cache-Control': 'no-cache',
				'Upgrade-Insecure-Requests': 1,
				'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/56.0.2924.87 Safari/537.36',
				'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
				'Referer': 'http://www.dianping.com/search/category',
				//'Accept-Encoding': 'gzip, deflate, sdch',
				'Accept-Language': 'zh-CN,zh;q=0.8'
			}
		};
		option.path = '/' + url.split('/').slice(1).join('/');

		let ids = await save_ids(url, option, handle_page_ids);

		LOG(url, 'request 1 finished.');

		/* alike atom write */
		if (!vis.has(url)) {
			vis.add(url);
			fs.appendFileSync(log_file, 'writing ' + url + '\n');
			fs.appendFileSync(data_file, url.split('/').pop() + ' ' + ids.join(' ') + '\n');
			fs.appendFileSync(log_file, 'done ' + url + '\n');
			LOG(url, 'save \x1b[32mfinished\x1b[0m.');
		}
		resolve();
	});
}

(async function() {

	read_proxy_config();

	let log_writer = fs.createWriteStream(log_file, { flags: 'a' });
	log_writer.end();
	let vis = await init_log(log_file);

	let rd = readline.createInterface({
		input: fs.createReadStream(input_file)
	});

	let lines = [];

	/* Just put all lines in memory. This makes me feel very sick */
	rd.on('line', (line) => {
		if (!vis.has(line))
			lines.push(line);
	});
	
	rd.on('close', async () => {
		let line;
		while (line = lines.shift()) {
			if (vis.has(line))
				continue;
			try {
				await work(vis, line);
			} catch (e) {
				lines.push(line);
			}
		}
	});
})();

process.on('uncaughtException', (err) => LOG(`Caught exception: ${err}`));
process.on('unhandledRejection', (reason, p) => LOG('Unhandled Rejection at: Promise ', p, 'reason: ', reason));
