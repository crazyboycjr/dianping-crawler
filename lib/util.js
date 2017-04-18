'use strict';

const http = require('http');
const ua_list = require('./user-agents.json');
const url = require('url');
const proxy = require('./proxy')();
const LOG = require('./log').LOG;

var rateLimit = require('./rate_limiter');

const REQ_TIMEOUT = 2 * 1000; // 2s

var __limit_send = rateLimit(10, 1000, async (option, cb) => {
	//LOG(option.path);
	let req = http.get(option);
	cb(req);
});

function limit_send(option) {
	return new Promise((resolve, reject) => {
		__limit_send(option, (req) => {
			resolve(req);
		});
	});
}

class Util {

	constructor() {
	}
	
	deep_copy(obj) {
		return JSON.parse(JSON.stringify(obj));
	}

	random_user_agent() {
		return ua_list[Math.floor(Math.random() * ua_list.length)];
	}

	read_content(request) {
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

	async send(option, dep) {
		
		if (dep > 10) return 'dep > 10';
		//let tmp_option = Object.assign({}, option);
		let tmp_option = this.deep_copy(option);

		option['path'] = 'http://' + option.host + option.path
		option.host = proxy.host;
		option.port = proxy.port;
		option.headers['Host'] = url.parse(option.path).hostname;
		option.headers['Proxy-Authorization'] = 'Basic ' + proxy.pass_base64;

		option.headers['User-Agent'] = this.random_user_agent();
		//LOG(option);

		//let req = http.get(option);
		let req = await limit_send(option);
		req.setTimeout(REQ_TIMEOUT, () => {
			LOG('socket \x1b[31mtimeout\x1b[0m', option.path);
			req.abort();
		});
		let text;
		try {
			text = await this.read_content(req);
		} catch (_) {
			LOG('resending request', tmp_option.path, 'dep = ', dep);
			return await this.send(tmp_option, dep + 1); 
		}
		return text;
	}

	async send_request(fn, option) {
		let text, fail_times = 0;
		while (1) {
			//let opt = Object.assign({}, option);
			let opt = this.deep_copy(option);

			text = await this.send(option, 0);
			if (text.length < 10
				|| text.indexOf('为了您的正常访问，请先输入验证码') >= 0
				|| text.indexOf('请输入下方图形验证码') >= 0) {

				LOG(option);
				LOG(option.path, fn + ' \x1b[31mblocked\x1b[0m.');
				if (++fail_times > 10)
					throw 'blocked';
			} else break;
			option = opt;
		}
		return text;
	}

}

module.exports = new Util();
