'use strict';

const http = require('http');
const fs = require('fs');
const querystring = require('querystring');
const readline = require('readline');

const dataFile = 'data.txt';
const logFile = 'log.txt';

function getParams(id) {
	return querystring.stringify({
		'digitalId': id,
		'DigitalId': id
	});
}

function queryOptions(id) {
	options.path = '/4.0/profile' + '?' + getParams(id);
	return options;
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

function initLog(logFile) {
	return new Promise((resolve, reject) => {
		let vis = new Set();
		let rd = readline.createInterface({
			input: fs.createReadStream(logFile)
		});
		rd.on('line', (line) => {
			if (line.startsWith('done '))
				vis.add(line.substring(5, line.length));
			/* 如果某id只有writing开头，需要在dataFile中找到对应的记录，将其删去，讲道理，这部分操作用数据库更简单一点 */
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
	while ((st = text.indexOf('<li id="rev')) >= 0) {
		let review = {};
		text = text.substring(st, text.length);
		st = text.indexOf('user-id="') + 9;
		text = text.substring(st, text.length);
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
		text = text.substring(st, text.length);
		en = text.indexOf('</div>');
		review['content'] = text.substring(0, en).trim();

		st = text.indexOf('<span class="time">') + '<span class="time">'.length;
		en = text.substring(st, text.length).indexOf('</span>') + st;
		review['date'] = text.substring(st, en);

		st = text.indexOf('<div class="shop-photo">') + '<div class="shop-photo">'.length;
		if (st > en) {
			review['photo_number'] = 0;
		} else {
			text = text.substring(st, text.length);
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
		text = text.substring(st, text.length);
		st = text.indexOf('/member/') + '/member/'.length;
		text = text.substring(st, text.length);
		en = text.indexOf('"');
		review['user_id'] = text.substring(0, en);

		st = text.indexOf('<span class="time">') + '<span class="time">'.length;
		text = text.substring(st, text.length);
		en = text.indexOf('</span>');
		review['check_in'] = text.substring(0, en);
		
		st = text.indexOf('<p>') + '<p>'.length;
		text = text.substring(st, text.length);
		en = text.indexOf('</p>');
		review['content'] = text.substring(0, en).trim();

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
			text = text.substring(st, text.length);
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

async function save_review(shop_id, option, review_type, subpath, handler, shop_config) {
	option.path = '/shop/' + shop_id + '/' + subpath;
	option.headers['Accept'] = 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8';
	option.headers['Host'] = 'www.dianping.com';
	option.headers['Referer'] = 'http://www.dianping.com/shop/' + shop_id + '/' + subpath;
	option.headers['Upgrade-insecure-Requests'] = 1;

	let res = http.get(option);
	let text = await readContent(res);
	let st, en;
	st = text.indexOf('<div class="Pages">');

	shop_config[review_type] = {
		review_number: 0,
		review_info: []
	};

	shop_config[review_type]['review_info'] = handler(text);
	shop_config[review_type]['review_number'] = shop_config[review_type]['review_info'].length;

	en = text.substring(st, text.length).indexOf('</div>') + 6;
	text = text.substring(st, st + en);
	let re = /data-pg="(\d+)"/g;
	let max_no = 1, page_no;
	if (st >= 0) {
		while ((page_no = re.exec(text)) !== null) {
			if (max_no < Number(page_no[1]))
				max_no = Number(page_no[1]);
		}
	}
	//console.log(max_no);
	
	for (let i = 1; i <= max_no; i++) {
		let params = querystring.stringify({
			pageno: i
		});
		option.path = '/shop/' + shop_id + '/' + subpath + '?' + params;

		res = http.get(option);
		text = await readContent(res);

		shop_config[review_type]['review_info'] = shop_config[review_type]['review_info'].concat(handler(text));
		shop_config[review_type]['review_number'] = shop_config[review_type]['review_info'].length;
	}
}

async function work(vis, shop_id) {
	let shop_config = {};

	console.log(shop_id);

	/* request 1 */
	/* 模仿浏览器请求 */
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
	let text = await readContent(res);
	//console.log(shop_id);

	vis.add(shop_id);

	let st = text.indexOf('window.shop_config=') + 19;
	let en = text.substring(st, text.length).indexOf('</script>') + st;
	//console.log(text.substring(st, en));

	/* dangerous code */
	let tmp_conf = eval('(' + text.substring(st, en) + ')');
	//console.log(tmp_conf);

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

	//console.log(shop_config);

	/* request 2 */
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
	text = await readContent(res);
	tmp_conf = JSON.parse(text);
	//console.log(tmp_conf);

	Object.assign(shop_config, {
		avg_price: tmp_conf['avgPrice'],
		default_review_count: tmp_conf['defaultReviewCount'],
		total_review_count: tmp_conf['totalReviewCount'],
		rating: {
			'口味': tmp_conf['shopRefinedScoreValueList'][0],
			'环境': tmp_conf['shopRefinedScoreValueList'][1],
			'服务': tmp_conf['shopRefinedScoreValueList'][2]
		},

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

	/* request 3 */
	/* 默认点评 review_all */

	await save_review(shop_id, option, 'default_reviews', 'review_all', handle_default_review, shop_config);

	//console.log(shop_config);
	/* request 4 review_short */
	await save_review(shop_id, option, 'checkin_reviews', 'review_short', handle_checkin_review, shop_config);

	//console.log(JSON.stringify(shop_config));
	/* alike atom write */
	{
		fs.appendFileSync(logFile, 'writing ' + shop_id + '\n');
		fs.appendFileSync(dataFile, JSON.stringify(shop_config) + '\n');
		fs.appendFileSync(logFile, 'done ' + shop_id + '\n');
	}
}

(async function() {

	let logWriter = fs.createWriteStream(logFile, { flags: 'a' });
	let vis = await initLog(logFile);
	logWriter.end();

	let rd = readline.createInterface({
		input: fs.createReadStream('dianping_id_shuf.txt')
	});

	let cnt = 0;
	rd.on('line', async (line) => {
		if (++cnt > 2)
			return;
		if (!vis.has(line)) {
			work(vis, line);
		}
	});
})();
