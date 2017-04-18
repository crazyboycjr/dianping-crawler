'use strict';

var Util = require('./util');
const querystring = require('querystring');
var LOG = require('./log').LOG;

function move(text, str) {
	return text.indexOf(str) + str.length;
}

class DH {

	constructor() {
	}

	handle_default_review(text) {
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
			st = move(text, '<span class="rst">口味');
			review['rating'].push(Number(text[st]));
			st = move(text, '<span class="rst">环境');
			review['rating'].push(Number(text[st]));
			st = move(text, '<span class="rst">服务');
			review['rating'].push(Number(text[st]));

			st = move(text, '<div class="J_brief-cont">');
			text = text.substring(st);
			en = text.indexOf('</div>');
			review['content'] = text.substring(0, en).trim();

			st = move(text, '<span class="time">');
			en = text.substring(st).indexOf('</span>') + st;
			review['date'] = text.substring(st, en);

			st = move(text, '<div class="shop-photo">');
			if (st > en) {
				review['photo_number'] = 0;
			} else {
				text = text.substring(st);
				en = text.indexOf('</div>');
				let count = 0;
				for (let tmp_text = text.substring(0, en),
						i = tmp_text.indexOf('<img');
						i >= 0; i = tmp_text.indexOf('<img', i + 1))
					count++;
				review['photo_number'] = count;
			}

			//console.log(review);
			reviews.push(review);
		}
		return reviews;
	}

	/* 这特么默认评论和签到短评前端就不是一个人写得 */
	handle_checkin_review(text) {
		let st, en;
		let reviews = [];
		while ((st = text.indexOf('<li id="review')) >= 0) {
			let review = {};
			text = text.substring(st);
			st = move(text, '/member/');
			text = text.substring(st);
			en = text.indexOf('"');
			review['user_id'] = text.substring(0, en);


			st = move(text, '<span class="time">');
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

			st = move(text, '<span class="item-rank-rst irr-star');
			if (st > en) {
				review['star'] = -1;
			} else {
				review['star'] = Number(text[st]);
			}

			en = text.indexOf('</li>');

			st = move(text, '<div class="shop-photo">');
			if (st > en) {
				review['photo_number'] = 0;
			} else {
				text = text.substring(st);
				en = text.indexOf('</div>');
				let count = 0;
				for (let tmp_text = text.substring(0, en),
						i = tmp_text.indexOf('<img');
						i >= 0; i = tmp_text.indexOf('<img', i + 1))
					count++;
				review['photo_number'] = count;
			}

			//console.log(review);
			reviews.push(review);
		}
		return reviews;
	}



	sub_save_reviews(option, shop_id, page_no, subpath, handler) {
		return new Promise(async (resolve, reject) => {
			LOG(shop_id, 'pageno = ', page_no);
			let reviews = [];
			let params = querystring.stringify({
				pageno: page_no
			});
			option.host = 'www.dianping.com';
			option.path = '/shop/' + shop_id + '/' + subpath + '?' + params;

			let text;
			try {
				text = await Util.send_request('request 3/4', option);
			} catch (e) {
				return reject(e);
			}

			reviews = handler(text);
			resolve(reviews);
		});
	}

	req3_modify_fn(data) {
		let shop_id = data.shift(),
			subpath = data.shift();

		return function (option) {
			let opt = Object.assign({}, option);
			opt.path += '/' + shop_id + '/' + subpath;
			opt.headers['Referer'] += shop_id + '/' + subpath;
			return opt;
		}
	}

	req3_handle_fn2(text, handler) {
		let st, en;
		st = text.indexOf('<div class="Pages">');

		let conf = {
			review_number: 0,
			review_info: []
		};

		conf['review_info'] = handler(text);
		conf['review_number'] = conf['review_info'].length;

		en = text.substring(st).indexOf('</div>') + 6;
		text = text.substring(st, st + en);
		let re = /data-pg="(\d+)"/g;
		let max_no = 1, page_no;

		if (st >= 0) {
			while ((page_no = re.exec(text)) !== null) {
				if (max_no < Number(page_no[1]))
					max_no = Number(page_no[1]);
			}
		}

		return [conf, max_no];
	}

	async save_review(shop_id, option, review_type,
						subpath, handler, shop_config) {

		let opt = this.req3_modify_fn([shop_id, subpath])(option);
		let text;
		try {
			text = await Util.send_request('request 3/4', opt);
		} catch (e) {
			return e;
		}

		if (text.indexOf('商户不存在-大众点评网') >= 0)
			return;

		let [conf, max_no] = this.req3_handle_fn2(text, handler);
		//shop_config[review_type] = conf;
		LOG(shop_id, 'page max_no = ', max_no);


		let promises = [];
		for (let i = 2; i <= max_no; i++) {
			/*
			LOG(shop_id, 'pageno = ', i);
			let tmp_opt = Object.assign({}, option);
			let tmp_reviews = await this
					.sub_save_reviews(tmp_opt, shop_id, i, subpath, handler);

			for (let review_arr of tmp_reviews) {
				//conf['review_info'] = conf['review_info'].concat(review_arr);
				conf['review_info'].push(review_arr);
				conf['review_number'] = conf['review_info'].length;
			}
			*/
			let tmp_opt = Object.assign({}, option);
			promises.push(this.sub_save_reviews(
				tmp_opt, shop_id, i, subpath, handler));
		}
		
		let tmp_reviews = await Promise.all(promises);
		for (let review_arr of tmp_reviews) {
			conf['review_info'] = conf['review_info'].concat(review_arr);
			conf['review_number'] = conf['review_info'].length;
		}

		shop_config[review_type] = conf;
	}


	req1_modify_fn(data) {
		let shop_id = data.shift();
		return function (option) {
			let opt = Object.assign({}, option);
			opt.path = opt.path + '/' + shop_id;
			return opt;
		}
	}

	req1_handle_fn(text) {

		let st = text.indexOf('window.shop_config=') + 19;
		let en = text.substring(st).indexOf('</script>') + st;
		//console.log(text.substring(st, en));

		/* dangerous code */
		//console.log(text);
		let conf;
		try {
			conf = eval('(' + text.substring(st, en) + ')');
		} catch (e) {
			throw e;
		}

		return Object.assign({}, {
			shop_id: conf['shopId'],
			shop_name: conf['shopName'],
			address: conf['address'],
			lat: conf['shopGlat'],
			lng: conf['shopGlng'],
			city_id: conf['cityId'],
			city_name: conf['cityName'],
			main_category_name: conf['mainCategoryName'],
			main_category_id: conf['mainCategoryId'],
			category_name: conf['categoryName'],
			main_region_id: conf['mainRegionId'],
			shop_power: conf['shopPower'],
			shop_group_id: conf['shopGroupId'],
			district: conf['district']
		});
	}

	req2_modify_fn(data) {
		let shop_id = data.shift(),
			city_id = data.shift(),
			main_category_id = data.shift();

		return function (option) {
			let opt = Object.assign({}, option);

			let params = querystring.stringify({
				shopId: shop_id,
				cityId: city_id,
				mainCategoryId: main_category_id
			});
			opt.path += '?' + params;
			//opt.headers['Pragma'] += shop_id;

			return opt;
		}
	}

	req2_handle_fn(text) {
		let conf = {};
		try {
			conf = JSON.parse(text);
		} catch (e) {
			throw e;
		}

		return Object.assign({}, {
			avg_price: conf['avgPrice'],
			default_review_count: conf['defaultReviewCount'],
			total_review_count: conf['totalReviewCount'],
			rating: conf['shopRefinedScoreValueList'] ? {
				'口味': conf['shopRefinedScoreValueList'][0],
				'环境': conf['shopRefinedScoreValueList'][1],
				'服务': conf['shopRefinedScoreValueList'][2]
			} : null,

			all_reviews: {
				default_numbers: conf['defaultReviewCount'],
				all_stars: {
					star_1: conf['reviewCountStar1'],
					star_2: conf['reviewCountStar2'],
					star_3: conf['reviewCountStar3'],
					star_4: conf['reviewCountStar4'],
					star_5: conf['reviewCountStar5']
				}
			}
		});
	}

}

module.exports = new DH();
