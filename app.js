'use strict';

const http = require('http');
const fs = require('fs');
const querystring = require('querystring');
const readline = require('readline');
const util = require('util');
const assert = require('assert');
const url = require('url');
const path = require('path');
const ua_list = require('./user-agents.json');

var proxy = require('./lib/proxy')(path.join(__dirname, 'http_proxy.json'));
var dcrawl = require('./lib/dcrawl')(path.join(__dirname, 'dcrawl_config.json'));
var Util = require('./lib/util');
var dh = require('./lib/data_handle');

const input_file = 'dianping_id_shuf.txt';
const data_file = 'dianping_data.txt';
const log_file = 'dianping_log.txt';
const LOG_FILE = 'prog_log.txt';

const Logger = require('./lib/log')(LOG_FILE),
	  LOG = require('./lib/log').LOG;

const GLOBAL_RATE = 10 * 100;
var global_rate = GLOBAL_RATE; // 1.0s

const UPPER_BOUND = 2 * 100; // 0.2s
const LOWER_BOUND = 5 * 100; // 0.5s

const REQ_TIMEOUT = 2 * 1000; // 2s

const CONCURRENCY_NUM = 10;

let timer = (timeout) => {
	return new Promise((resolve, reject) => {
		setTimeout(() => {
			resolve('timeout');
		}, timeout * 0);
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


async function work(vis, shop_id) {
	return new Promise(async (resolve, reject) => {
		let shop_config = {};

		LOG(shop_id);

		/* request 1 */
		LOG(shop_id, 'sending request 1...');
		try {
			shop_config = Object.assign({},
				await dcrawl.request1(dh.req1_modify_fn([shop_id]),
									  dh.req1_handle_fn));
		} catch (e) {
			return reject(e);
		}

		LOG(shop_id, 'request 1 finished.');
		//console.log(shop_config);

		/* request 2 */
		LOG(shop_id, 'sending request 2...');

		try {
			shop_config = Object.assign(shop_config,
				await dcrawl.request2(dh.req2_modify_fn(
					[shop_id, shop_config['city_id'], shop_config['main_category_id']]),
						dh.req2_handle_fn));
		} catch (e) {
			return reject(e);
		}

		//console.log(shop_config);
		LOG(shop_id, 'request 2 finished.');

		/* request 3 */
		/* 默认点评 review_all */
		LOG(shop_id, 'sending request 3');

		let config = require('./dcrawl_config.json');
		let ret = await dh.save_review(shop_id, config.request3, 'default_reviews',
				'review_all', dh.handle_default_review, shop_config);
		if (ret === 'blocked')
			return reject('blocked');

		LOG(shop_id, 'request 3 finished.');

		//console.log(shop_config);
		/* request 4 review_short */
		LOG(shop_id, 'sending request 4');

		ret = await dh.save_review(shop_id, config.request3, 'checkin_reviews',
				'review_short', dh.handle_checkin_review, shop_config);
		if (ret === 'blocked')
			return reject('blocked');

		LOG(shop_id, 'request 4 finished.');

		//console.log(JSON.stringify(shop_config));
		/* alike atom write */
		if (!vis.has(shop_id)) {
			vis.add(shop_id);
			fs.appendFileSync(log_file, 'writing ' + shop_id + '\n');
			fs.appendFileSync(data_file, JSON.stringify(shop_config) + '\n');
			fs.appendFileSync(log_file, 'done ' + shop_id + '\n');
			LOG(shop_id, 'save \x1b[32mfinished\x1b[0m.');
		}
		resolve();
	});
}

(async function() {

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
			let ret;
			try {
				ret = await work(vis, line);
				global_rate = GLOBAL_RATE;
			} catch (e) {
				if (e === 'blocked') {
					global_rate *= 2;
				}
				LOG(e, 'global_rate = ', global_rate);
				await timer(global_rate);
			}
		}
	});
})();

process.on('uncaughtException', (err) => LOG(`Caught exception: ${err}`));
process.on('unhandledRejection', (reason, p) => LOG('Unhandled Rejection at: Promise ', p, 'reason: ', reason));
