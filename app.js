'use strict';

const http = require('http');
const fs = require('fs');
const querystring = require('querystring');
const readline = require('readline');
const util = require('util');
const assert = require('assert');
const url = require('url');
const ua_list = require('./user-agents.json')

var Socks = require('socks');

const input_file = 'dianping_id_shuf.txt';
const data_file = 'dianping_data.txt';
const log_file = 'dianping_log.txt';
const LOG_FILE = 'prog_log.txt';

const prog_log = fs.createWriteStream(LOG_FILE, { flags: 'a' });

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
		}).on('error', err => reject(err));
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

	let tmp_option = Object.assign({}, option);

	option['path'] = 'http://' + option.host + option.path
	option.host = proxy_host;
	option.port = proxy_port;
	option.headers['Host'] = url.parse(option.path).hostname;
	option.headers['Proxy-Authorization'] = 'Basic ' + proxy_pass_base64;

	option.headers['User-Agent'] = random_user_agent();
	//LOG(option);

	let req = http.get(option);
	req.setTimeout(REQ_TIMEOUT, () => {
		LOG('socket \x1b[31mtimeout\x1b[0m', option.path);
		req.abort();
	});
	let text;
	try {
		text = await read_content(req);
	} catch (_) {
		LOG('resending request', tmp_option.path);
		return await send_request(tmp_option); 
	}
	return text;
}

function handle_default_review(text) {
	let st, en;
	let reviews = [];
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

function sub_save_reviews(option, shop_id, page_no, subpath, handler) {
	return new Promise(async (resolve, reject) => {
		let reviews = [];
		let params = querystring.stringify({
			pageno: page_no
		});
		option.host = 'www.dianping.com';
		option.path = '/shop/' + shop_id + '/' + subpath + '?' + params;

		let text, fail_times = 0;
		while (1) {
			text = await send_request(option);

			if (text.length < 10 || text.indexOf('为了您的正常访问，请先输入验证码') >= 0 || text.indexOf('请输入下方图形验证码') >= 0) {
				LOG(shop_id, 'request 3/4 \x1b[31mblocked\x1b[0m.');
				if (++fail_times > 10)
					return 'blocked';
			} else {
				break;
			}
		}

		reviews = handler(text);
		resolve(reviews);
	});
}

async function save_review(shop_id, option, review_type, subpath, handler, shop_config) {
	option.host = 'www.dianping.com';
	option.path = '/shop/' + shop_id + '/' + subpath;
	option.headers['Accept'] = 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8';
	option.headers['Host'] = 'www.dianping.com';
	option.headers['Referer'] = 'http://www.dianping.com/shop/' + shop_id + '/' + subpath;
	option.headers['Upgrade-insecure-Requests'] = 1;

	let text, fail_times = 0;
	while (1) {
		text = await send_request(option);

		if (text.indexOf('商户不存在-大众点评网') >= 0) {
			return;
		}
		if (text.lengh < 10 || text.indexOf('为了您的正常访问，请先输入验证码') >= 0 || text.indexOf('请输入下方图形验证码') >= 0) {
			LOG(shop_id, 'request 3/4 \x1b[31mblocked\x1b[0m.');
			if (++fail_times > 10)
				return 'blocked';
		} else {
			break;
		}
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
	
	let promises = [];
	for (let i = 2; i <= max_no; i++) {
		LOG('pageno = ', i);

		let tmp_option = Object.assign({}, option);
		promises.push(sub_save_reviews(tmp_option, shop_id, i, subpath, handler));

		if (i % CONCURRENCY_NUM === 0) {
			let tmp_reviews = await Promise.all(promises);

			for (let review_arr of tmp_reviews) {
				shop_config[review_type]['review_info'] = shop_config[review_type]['review_info'].concat(review_arr);
				shop_config[review_type]['review_number'] = shop_config[review_type]['review_info'].length;
			}

			promises = [];
		}
	}

	let tmp_reviews = await Promise.all(promises);
	for (let review_arr of tmp_reviews) {
		shop_config[review_type]['review_info'] = shop_config[review_type]['review_info'].concat(review_arr);
		shop_config[review_type]['review_number'] = shop_config[review_type]['review_info'].length;
	}
}

/* TODO 增加不同的UA，每次随机选UA发送请求 */
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
				//'Accept-Encoding': 'gzip, deflate, sdch', //Nodejs http server only accept gzip and deflate
				'Accept-Language': 'zh-CN,zh;q=0.8'
			}
		};
		option.path = option.path + '/' + shop_id;

		let text, fail_times = 0;
		while (1) {
			text = await send_request(option);
			//console.log(shop_id);

			if (text.indexOf('为了您的正常访问，请先输入验证码') >= 0) {
				LOG(shop_id, 'request 1 \x1b[31mblocked\x1b[0m.');
				if (++fail_times > 5)
					return reject('blocked');
			} else {
				break;
			}
		}

		let st = text.indexOf('window.shop_config=') + 19;
		let en = text.substring(st).indexOf('</script>') + st;
		//console.log(text.substring(st, en));

		/* dangerous code */
		//console.log(text);
		let tmp_conf;
		try {
			tmp_conf = eval('(' + text.substring(st, en) + ')');
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
			shop_power: tmp_conf['shopPower'],
			shop_group_id: tmp_conf['shopGroupId'],
			district: tmp_conf['district']
		});

		LOG(shop_id, 'request 1 finished.');
		//console.log(shop_config);

		await timer(Math.random() * (UPPER_BOUND - LOWER_BOUND) + LOWER_BOUND);
		/* request 2 */
		LOG(shop_id, 'sending request 2...');
		option.host = 'www.dianping.com';
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

		fail_times = 0;
		while (1) {
			text = await send_request(option);

			if (text.indexOf('为了您的正常访问，请先输入验证码') >= 0) {
				LOG(shop_id, 'request 2 \x1b[31mblocked\x1b[0m.');
				if (++fail_times > 10)
					return reject('blocked');
			} else {
				break;
			}
		}

		try {
			tmp_conf = JSON.parse(text);
		} catch (e) {
			return reject(e);
		}
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

			await timer(Math.random() * (UPPER_BOUND - LOWER_BOUND) + LOWER_BOUND);
		}
	});
})();

process.on('uncaughtException', (err) => LOG(`Caught exception: ${err}`));
process.on('unhandledRejection', (reason, p) => LOG('Unhandled Rejection at: Promise ', p, 'reason: ', reason));
