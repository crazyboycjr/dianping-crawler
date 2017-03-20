'use strict';

const http = require('http');
const fs = require('fs');
const querystring = require('querystring');
const readline = require('readline');
const util = require('util');

const data_file = 'dianping_data.txt';
const log_file = 'dianping_log.txt';
const LOG_FILE = 'prog_log.txt'

const prog_log = fs.createWriteStream(LOG_FILE, { flags: 'a' });

const GLOBAL_RATE = 10 * 1000;
var global_rate = GLOBAL_RATE; // 10s

const UPPER_BOUND = 2 * 1000; // 2s
const LOWER_BOUND = 5 * 1000; // 5s

const start_time = Date.now();
async function rate_limiter(count, interval, fn) {
	return new Promise((resolve, reject) => {
		setTimeout(() => {
			let res = fn();
			resolve(res);
		}, interval * 1.0 / count);
	});
}

let timer = (timeout) => {
	return new Promise((resolve, reject) => {
		setTimeout(() => {
			resolve('timeout');
		}, timeout);
	});
}

function LOG() {
	let args = Array.prototype.slice.call(arguments);
	let output = '[' + (new Date).toUTCString() + ']: '
			+ args.map(x => typeof x === 'string' ? x : util.inspect(x)).join(' ');
	console.log(output);
	prog_log.write(output + '\n');
}

function readContent(request) {
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

function initLog(log_file) {
	return new Promise((resolve, reject) => {
		let vis = new Set();
		let rd = readline.createInterface({
			input: fs.createReadStream(log_file)
		});
		rd.on('line', (line) => {
			if (line.startsWith('done '))
				vis.add(line.substring(5, line.length));
			/* 如果某id只有writing开头，需要在data_file中找到对应的记录，将其删去，讲道理，这部分操作用数据库更简单一点 */
		});
		rd.on('close', () => {
			resolve(vis);
		});
		rd.on('error', (err) => {
			reject(err);
		})
	});
}

function handle_default_review(text) {
	let st, en;
	let reviews = [];
	if (text.indexOf('<li id="rev') < 0) {
		console.log(text);
	}
	while ((st = text.indexOf('<li id="rev')) >= 0) {
		let review = {};
		text = text.substring(st);
		st = text.indexOf('user-id="') + 9;
		text = text.substring(st);
		en = text.indexOf('"');
		review['user_id'] = text.substring(0, en);

		review['rating'] = [];
		st = text.indexOf('<span class="rst">口味') + '<span class="rst">口味'.length;
		review['rating'].push(Number(text[st]));
		st = text.indexOf('<span class="rst">环境') + '<span class="rst">环境'.length;
		review['rating'].push(Number(text[st]));
		st = text.indexOf('<span class="rst">服务') + '<span class="rst">服务'.length;
		review['rating'].push(Number(text[st]));
		
		st = text.indexOf('<div class="J_brief-cont">') + '<div class="J_brief-cont">'.length;
		text = text.substring(st);
		en = text.indexOf('</div>');
		review['content'] = text.substring(0, en).trim();

		st = text.indexOf('<span class="time">') + '<span class="time">'.length;
		en = text.substring(st).indexOf('</span>') + st;
		review['date'] = text.substring(st, en);

		st = text.indexOf('<div class="shop-photo">') + '<div class="shop-photo">'.length;
		if (st > en) {
			review['photo_number'] = 0;
		} else {
			text = text.substring(st);
			en = text.indexOf('</div>');
			let count = 0;
			for (let tmp_text = text.substring(0, en), i = tmp_text.indexOf('<img');
				i >= 0; i = tmp_text.indexOf('<img', i + 1)) count++;
			review['photo_number'] = count;
		}

		//console.log(review);
		reviews.push(review);
	}
	return reviews;
}

/* 这特么默认评论和签到短评前端就不是一个人写得 */
function handle_checkin_review(text) {
	let st, en;
	let reviews = [];
	if (text.indexOf('<li id="review') < 0) {
		console.log(text);
	}
	while ((st = text.indexOf('<li id="review')) >= 0) {
		let review = {};
		text = text.substring(st);
		st = text.indexOf('/member/') + '/member/'.length;
		text = text.substring(st);
		en = text.indexOf('"');
		review['user_id'] = text.substring(0, en);

		st = text.indexOf('<span class="time">') + '<span class="time">'.length;
		text = text.substring(st);
		en = text.indexOf('</span>');
		review['check_in'] = text.substring(0, en);
		
		st = text.indexOf('<p>') + '<p>'.length;
		//text = text.substring(st);
		en = text.substring(st).indexOf('</p>') + st;
		if (st > text.indexOf('</div>')) {
			review['content'] = '';
		} else {
			review['content'] = text.substring(st, en).trim();
		}

		st = text.indexOf('<span class="item-rank-rst irr-star') + '<span class="item-rank-rst irr-star'.length;
		if (st > en) {
			review['star'] = -1;
		} else {
			review['star'] = Number(text[st]);
		}

		en = text.indexOf('</li>');

		st = text.indexOf('<div class="shop-photo">') + '<div class="shop-photo">'.length;
		if (st > en) {
			review['photo_number'] = 0;
		} else {
			text = text.substring(st);
			en = text.indexOf('</div>');
			let count = 0;
			for (let tmp_text = text.substring(0, en), i = tmp_text.indexOf('<img');
				i >= 0; i = tmp_text.indexOf('<img', i + 1)) count++;
			review['photo_number'] = count;
		}

		//console.log(review);
		reviews.push(review);
	}
	return reviews;
}

/* TODO 判一下这里被block的情况 */
async function save_review(shop_id, option, review_type, subpath, handler, shop_config) {
	option.path = '/shop/' + shop_id + '/' + subpath;
	option.headers['Accept'] = 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8';
	option.headers['Host'] = 'www.dianping.com';
	option.headers['Referer'] = 'http://www.dianping.com/shop/' + shop_id + '/' + subpath;
	option.headers['Upgrade-insecure-Requests'] = 1;

	//先用这个测试一下
	option.path = option.path + '?' + 'uuid=f82aad1d-4492-4903-977e-0800ff5b2d2f';

	let res = http.get(option);
	/*let res = await rate_limiter(1, 1000, () => {
		console.log('%s ms - %s', Date.now() - start_time, shop_id);
		return http.get(option);
	});*/
	let text = await readContent(res);
	if (text.length < 10) {
		LOG(shop_id, 'request 3/4 \x1b[31mblocked\x1b[0m.');
		return 'blocked';
	}
	if (text.indexOf('商户不存在-大众点评网') >= 0) {
		return;
	}
	console.log(text.indexOf('请输入下方图形验证码'));
	if (text.indexOf('为了您的正常访问，请先输入验证码') >= 0 || text.indexOf('请输入下方图形验证码') >= 0) {
		LOG(shop_id, 'request 3/4 \x1b[31mblocked\x1b[0m.');
		return 'blocked';
	}
	let st, en;
	st = text.indexOf('<div class="Pages">');

	shop_config[review_type] = {
		review_number: 0,
		review_info: []
	};

	shop_config[review_type]['review_info'] = handler(text);
	shop_config[review_type]['review_number'] = shop_config[review_type]['review_info'].length;

	en = text.substring(st).indexOf('</div>') + 6;
	text = text.substring(st, st + en);
	let re = /data-pg="(\d+)"/g;
	let max_no = 1, page_no;

	await timer(Math.random() * (UPPER_BOUND - LOWER_BOUND) + LOWER_BOUND);

	if (st >= 0) {
		while ((page_no = re.exec(text)) !== null) {
			if (max_no < Number(page_no[1]))
				max_no = Number(page_no[1]);
		}
	}
	LOG(shop_id, 'page max_no = ', max_no);
	
	for (let i = 1; i <= max_no; i++) {
		let params = querystring.stringify({
			pageno: i,
			uuid: 'f82aad1d-4492-4903-977e-0800ff5b2d2f'
		});
		option.path = '/shop/' + shop_id + '/' + subpath + '?' + params;

		LOG('pageno = ', i);
		res = http.get(option);
		/*res = await rate_limiter(1, 1000, () => {
			console.log('%s ms - %s', Date.now() - start_time, shop_id);
			return http.get(option);
		});*/
		text = await readContent(res);
		if (text.indexOf('为了您的正常访问，请先输入验证码') >= 0 || text.indexOf('请输入下方图形验证码') >= 0) {
			LOG(shop_id, 'request 3/4 \x1b[31mblocked\x1b[0m.');
			return 'blocked';
		}

		shop_config[review_type]['review_info'] = shop_config[review_type]['review_info'].concat(handler(text));
		shop_config[review_type]['review_number'] = shop_config[review_type]['review_info'].length;

		await timer(Math.random() * (UPPER_BOUND - LOWER_BOUND) + LOWER_BOUND);
	}
}

async function work(vis, shop_id) {
	return new Promise(async (resolve, reject) => {
		let shop_config = {};

		LOG(shop_id);

		/* request 1 */
		/* 模仿浏览器请求 */
		LOG(shop_id, 'sending request 1...');
		let option = {
			host: 'www.dianping.com',
			path: '/shop',
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
		option.path = option.path + '/' + shop_id;

		let res = http.get(option);
		/*let res = await rate_limiter(1, 1000, () => {
			console.log('%s ms - %s', Date.now() - start_time, shop_id);
			return http.get(option);
		});*/
		let text = await readContent(res);
		//console.log(shop_id);

		let st = text.indexOf('window.shop_config=') + 19;
		let en = text.substring(st).indexOf('</script>') + st;
		//console.log(text.substring(st, en));

		if (text.indexOf('为了您的正常访问，请先输入验证码') >= 0) {
			LOG(shop_id, 'request 1 \x1b[31mblocked\x1b[0m.');
			/* 这个resolve 是异步调用的，所以下面的东西还是可能会被执行*/
			return reject('blocked');
		}
		/* dangerous code */
		//onsole.log(text);
		let tmp_conf;
		try {
			tmp_conf = eval('(' + text.substring(st, en) + ')');
			//console.log(tmp_conf);
		} catch (e) {
			return reject(e);
		}

		Object.assign(shop_config, {
			shop_id: shop_id,
			shop_name: tmp_conf['shopName'],
			address: tmp_conf['address'],
			lat: tmp_conf['shopGlat'],
			lng: tmp_conf['shopGlng'],
			city_id: tmp_conf['cityId'],
			city_name: tmp_conf['cityName'],
			main_category_name: tmp_conf['mainCategoryName'],
			main_category_id: tmp_conf['mainCategoryId'],
			category_name: tmp_conf['categoryName'],
			main_region_id: tmp_conf['mainRegionId'],
			shop_power: tmp_conf['shopPower']
		});

		LOG(shop_id, 'request 1 finished.');
		//console.log(shop_config);

		await timer(Math.random() * (UPPER_BOUND - LOWER_BOUND) + LOWER_BOUND);
		/* request 2 */
		LOG(shop_id, 'sending request 2...');
		option.path = '/ajax/json/shopDynamic/reviewAndStar';
		let params = querystring.stringify({
			shopId: shop_id,
			cityId: tmp_conf['cityId'],
			mainCategoryId: tmp_conf['mainCategoryId']
		});
		option.path += '?' + params;
		option.headers['Accept'] = 'application/json, text/javascript, */*; q=0.01';
		option.headers['Pragma'] = 'http://www.dianping.com/shop/' + shop_id;
		option.headers['X-Requested-With'] = 'XMLHttpRequest';
		option.headers['Upgrade-Insecure-Request'] = null;

		res = http.get(option);
		/*res = await rate_limiter(1, 1000, () => {
			console.log('%s ms - %s', Date.now() - start_time, shop_id);
			return http.get(option);
		});*/
		text = await readContent(res);

		if (text.indexOf('为了您的正常访问，请先输入验证码') >= 0) {
			LOG(shop_id, 'request 2 \x1b[31mblocked\x1b[0m.');
			return reject('blocked');
		}
		tmp_conf = JSON.parse(text);
		//console.log(tmp_conf);

		Object.assign(shop_config, {
			avg_price: tmp_conf['avgPrice'],
			default_review_count: tmp_conf['defaultReviewCount'],
			total_review_count: tmp_conf['totalReviewCount'],
			rating: tmp_conf['shopRefinedScoreValueList'] ? {
				'口味': tmp_conf['shopRefinedScoreValueList'][0],
				'环境': tmp_conf['shopRefinedScoreValueList'][1],
				'服务': tmp_conf['shopRefinedScoreValueList'][2]
			} : null,

			all_reviews: {
				default_numbers: tmp_conf['defaultReviewCount'],
				all_stars: {
					star_1: tmp_conf['reviewCountStar1'],
					star_2: tmp_conf['reviewCountStar2'],
					star_3: tmp_conf['reviewCountStar3'],
					star_4: tmp_conf['reviewCountStar4'],
					star_5: tmp_conf['reviewCountStar5']
				}
			}
		});
		//console.log(shop_config);
		LOG(shop_id, 'request 2 finished.');

		await timer(Math.random() * (UPPER_BOUND - LOWER_BOUND) + LOWER_BOUND);
		/* request 3 */
		/* 默认点评 review_all */
		LOG(shop_id, 'sending request 3');

		let ret = await save_review(shop_id, option, 'default_reviews', 'review_all', handle_default_review, shop_config);
		if (ret === 'blocked')
			return reject('blocked');

		LOG(shop_id, 'request 3 finished.');

		await timer(Math.random() * (UPPER_BOUND - LOWER_BOUND) + LOWER_BOUND);
		//console.log(shop_config);
		/* request 4 review_short */
		LOG(shop_id, 'sending request 4');

		ret = await save_review(shop_id, option, 'checkin_reviews', 'review_short', handle_checkin_review, shop_config);
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

const GLOBAL_TIMEOUT_UPPER = 20 * 60 * 1000; //20min;
const GLOBAL_TIMEOUT = 60 * 1000; //60s;
var global_timeout = GLOBAL_TIMEOUT;

function go(vis, buf, buf_lim) {
	let promises = [];
	let line;
	while (line = buf.shift()) {
		if (!vis.has(line))
			promises.push(work(vis, line));
	}
	LOG(promises);
	return Promise.all(promises);
}

(async function() {

	let logWriter = fs.createWriteStream(log_file, { flags: 'a' });
	let vis = await initLog(log_file);
	logWriter.end();

	let rd = readline.createInterface({
		input: fs.createReadStream('dianping_id_shuf.txt')
	});

	let buf = [], lines = [];
	let buf_lim = 1;

	/*
	rd.on('line', (line) => {
		if (buf.length >= buf_lim) {
			rd.pause();
		} else {
			buf.push(line);
		}
	});

	rd.on('pause', async () => {
		await go(vis, buf, buf_lim);
		rd.resume();
	});

	rd.on('close', async () => {
		await go(vis, buf, buf_lim);
	});
	*/
	/* This makes me feel very sick */
	rd.on('line', (line) => {
		if (!vis.has(line))
			lines.push(line);
	});
	
	rd.on('close', async () => {
		let line;
		while (line = lines.shift()) {
			buf.push(line);
			if (buf.length >= buf_lim) {
				let ret;
				let buf_copy = buf.slice();
				try {
					ret = await go(vis, buf, buf_lim);
					global_rate = GLOBAL_RATE;
					if (ret === 'timeout' && global_timeout < GLOBAL_TIMEOUT_UPPER) {
						global_timeout *= 2;
						LOG('\x1b[33mtimeout\x1b[0m happened.', 'global_timeout = ', global_timeout);
						for (let ll of buf_copy)
							lines.splice(0, 0, ll);
					} else {
						global_timeout = GLOBAL_TIMEOUT;
					}
				} catch (e) {
					if (e === 'blocked') {
						global_rate *= 2;
					}
					LOG(e, 'global_rate = ', global_rate);
					await timer(global_rate);
				}

				await timer(Math.random() * (UPPER_BOUND - LOWER_BOUND) + LOWER_BOUND);
			}
		}

		while (buf.length > 0) {
			let ret;
			let buf_copy = buf.slice();
			try {
				ret = await go(vis, buf, buf_lim);
				global_rate = GLOBAL_RATE;
				if (ret === 'timeout' && global_timeout < GLOBAL_TIMEOUT_UPPER) {
					global_timeout *= 2;
					LOG('\x1b[33mtimeout\x1b[0m happened.', 'global_timeout = ', global_timeout);
					for (let ll of buf_copy)
						lines.splice(0, 0, ll);
				} else {
					global_timeout = GLOBAL_TIMEOUT;
				}
			} catch (e) {
				if (e === 'blocked') {
					global_rate *= 2;
				}
				LOG(e, 'global_rate = ', global_rate)
				await timer(global_rate);
			}
			
			await timer(Math.random() * (UPPER_BOUND - LOWER_BOUND) + LOWER_BOUND);
		}
	});
})();

process.on('uncaughtException', (err) => LOG(`Caught exception: ${err}`));
process.on('unhandledRejection', (reason, p) => LOG('Unhandled Rejection at: Promise ', p, 'reason: ', reason));
