'use strict';

/* abuyun.com */
const proxy_host = 'proxy.abuyun.com';
const proxy_port = '9020';

/*
var proxy_user = 'HG8073W66E7Y04ED';
var proxy_pass = '8E2E7520FDFFB5BA';

var proxy_pass_base64 = new Buffer(proxy_user + ':' + proxy_pass).toString('base64');
*/

class Proxy {
	
	constructor(f) {
		if (f) this.config_file = f;
		this.host = proxy_host;
		this.port = proxy_port;
		this.read_config();
	}

	read_config() {
		this.config = require(this.config_file);
		this.user = this.config['proxy_user'];
		this.pass = this.config['proxy_pass'];
		this.pass_base64 = new Buffer(this.user + ':' + this.pass).toString('base64');
	}

}

var proxy = null;

module.exports = function(f) {
	if (!proxy)
		proxy = new Proxy(f);
	return proxy;
}
