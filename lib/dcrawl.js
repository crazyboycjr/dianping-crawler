'use strict';

var Util = require('./util');
var LOG = require('./log').LOG;

class Dcrawl {
	
	constructor(f) {
		if (f) this.config_file = f;

		this.conf = require(this.config_file);
		
		for (let fn of Object.keys(this.conf)) {
			this[fn] = this.gen(fn, this.conf[fn]);
		}
	}


	gen(fn, option) {
		return async function(req_modify_fn, data_handle_fn) {
			let text, opt, res;
			opt = req_modify_fn(option);
			try {
				text = await Util.send_request(fn, opt);
				res = data_handle_fn(text);
			} catch (e) {
				throw e;
			}
			return res;
		}
	}

	set_config_file(f) {
		this.config_file = f;
	}

}

module.exports = function (f) {
	return new Dcrawl(f);
}
